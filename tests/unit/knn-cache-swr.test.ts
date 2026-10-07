import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { runWithRequestCachePolicy } from "../../server/engine/request-cache-policy.js";
import {
  ageKnnCacheForTests,
  clearKnnCache,
  getKnnCacheSize,
  knnOutputPriceAtFloat,
} from "../../server/engine/knn-pricing.js";

const SKIN = "AK-47 | Redline";
const KNN_TTL_MS = 2 * 60 * 1000;
const KNN_CAP_MS = KNN_TTL_MS * 3;

function observationRows(price: number) {
  return [0.19, 0.20, 0.21, 0.22].map((floatValue) => ({
    skin_name: SKIN,
    float_value: floatValue,
    price_cents: price,
    source: "sale",
    age_days: 1,
  }));
}

interface KnnScript {
  hold: Promise<void> | null;
  fail: boolean;
  empty: boolean;
  price: number;
  queries: number;
}

function knnPool(script: KnnScript): pg.Pool {
  const query = async (sql: string) => {
    const text = String(sql);
    if (!text.includes("FROM price_observations")) {
      throw new Error(`unexpected sql: ${text.slice(0, 120)}`);
    }
    script.queries++;
    if (script.hold) await script.hold;
    if (script.fail) throw new Error("knn query failed");
    if (script.empty) return { rows: [] };
    return { rows: observationRows(script.price) };
  };
  return { query } as pg.Pool;
}

function armHold(): { promise: Promise<void>; release: () => void } {
  let release: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe("KNN cache stale-while-revalidate on the API path", () => {
  beforeEach(() => {
    clearKnnCache();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearKnnCache();
  });

  it("serves the stale KNN cache immediately inside a calculator request", async () => {
    const script: KnnScript = { hold: null, fail: false, empty: false, price: 1000, queries: 0 };
    const pool = knnPool(script);
    const first = await knnOutputPriceAtFloat(pool, SKIN, 0.2);
    expect(first).not.toBeNull();
    expect(getKnnCacheSize()).toBeGreaterThan(0);

    ageKnnCacheForTests(KNN_TTL_MS + 30_000);
    const hold = armHold();
    script.hold = hold.promise;
    script.price = 500;
    const before = script.queries;

    const started = performance.now();
    const stale = await runWithRequestCachePolicy(() => knnOutputPriceAtFloat(pool, SKIN, 0.2));
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(1500);
    expect(script.queries).toBe(before + 1);
    expect(stale?.priceCents).toBe(first?.priceCents);

    hold.release();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  it("still blocks a non-request caller when the KNN cache is stale", async () => {
    const script: KnnScript = { hold: null, fail: false, empty: false, price: 1000, queries: 0 };
    const pool = knnPool(script);
    await knnOutputPriceAtFloat(pool, SKIN, 0.2);
    ageKnnCacheForTests(KNN_TTL_MS + 30_000);
    const hold = armHold();
    script.hold = hold.promise;

    let resolved = false;
    const pending = knnOutputPriceAtFloat(pool, SKIN, 0.2).then(() => { resolved = true; });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(resolved).toBe(false);

    hold.release();
    await pending;
  });

  it("keeps the old KNN cache when a background rebuild fails and retries later", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on("unhandledRejection", onUnhandled);

    const script: KnnScript = { hold: null, fail: false, empty: false, price: 1000, queries: 0 };
    const pool = knnPool(script);
    await knnOutputPriceAtFloat(pool, SKIN, 0.2);
    const size = getKnnCacheSize();
    ageKnnCacheForTests(KNN_TTL_MS + 30_000);

    const hold = armHold();
    script.hold = hold.promise;
    script.fail = true;
    const stale = await runWithRequestCachePolicy(() => knnOutputPriceAtFloat(pool, SKIN, 0.2));
    expect(stale).not.toBeNull();
    hold.release();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(unhandled).toEqual([]);
    expect(getKnnCacheSize()).toBe(size);

    script.fail = false;
    script.hold = null;
    script.price = 800;
    const before = script.queries;
    await runWithRequestCachePolicy(() => knnOutputPriceAtFloat(pool, SKIN, 0.2));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(script.queries).toBeGreaterThan(before);

    process.off("unhandledRejection", onUnhandled);
  });

  it("returns a calculator request immediately when the KNN cache is past its cap", async () => {
    const script: KnnScript = { hold: null, fail: false, empty: false, price: 1000, queries: 0 };
    const pool = knnPool(script);
    const first = await knnOutputPriceAtFloat(pool, SKIN, 0.2);
    ageKnnCacheForTests(KNN_CAP_MS + 1_000);
    const hold = armHold();
    script.hold = hold.promise;
    script.price = 500;
    const before = script.queries;

    let price: number | undefined;
    const started = performance.now();
    const pending = runWithRequestCachePolicy(() => knnOutputPriceAtFloat(pool, SKIN, 0.2))
      .then((result) => { price = result?.priceCents; });
    const again = runWithRequestCachePolicy(() => knnOutputPriceAtFloat(pool, SKIN, 0.2));
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(performance.now() - started).toBeLessThan(1500);
    expect(price).toBe(first?.priceCents);
    expect(script.queries).toBe(before + 1);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining(
      "[knn-cache] serving stale cache",
    ));
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining("blocking until rebuild"));

    hold.release();
    await pending;
    await again;
  });

  it("still waits for a non-request caller when the KNN cache is past its cap", async () => {
    const script: KnnScript = { hold: null, fail: false, empty: false, price: 1000, queries: 0 };
    const pool = knnPool(script);
    await knnOutputPriceAtFloat(pool, SKIN, 0.2);
    ageKnnCacheForTests(KNN_CAP_MS + 1_000);
    const hold = armHold();
    script.hold = hold.promise;

    let resolved = false;
    const pending = knnOutputPriceAtFloat(pool, SKIN, 0.2).then(() => { resolved = true; });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(resolved).toBe(false);

    hold.release();
    await pending;
  });
});
