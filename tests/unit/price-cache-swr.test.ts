import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import pg from "pg";
import { runWithRequestCachePolicy } from "../../server/engine/request-cache-policy.js";
import {
  PRICE_CACHE_MAX_STALE_MS,
  PRICE_CACHE_TTL_MS,
  ageFloatCeilingForTests,
  assemblePriceCache,
  buildPriceCache,
  dmarketFloorCache,
  ensureFloatCeilingForTests,
  ensureRequestPriceCache,
  expirePriceCacheForTests,
  floatCeilingCacheSizeForTests,
  priceCache,
  priceCacheBuilt,
  priceSources,
  refPriceCache,
  resetPriceCacheForTests,
  seedFloatCeilingForTests,
  settlePriceCacheRebuildForTests,
  skinportFloorCache,
  skinportMedianCache,
} from "../../server/engine/pricing.js";
import { conditionMultiplierCache } from "../../server/engine/condition-multipliers.js";
import { curveCache } from "../../server/engine/curve-classification.js";

const REDLINE = "AK-47 | Redline:Field-Tested";
const KNIFE_FN = "★ Karambit | Fade:Factory New";
const KNIFE_MW = "★ Karambit | Fade:Minimal Wear";

interface Script {
  holdRef: Promise<void> | null;
  failRef: boolean;
  empty: boolean;
  median: number;
  refQueries: number;
  withListing: boolean;
  holdCeiling: Promise<void> | null;
  ceilingQueries: number;
}

function scriptedPool(script: Script): pg.Pool {
  const query = async (sql: string, params?: unknown[]) => {
    const text = String(sql);
    if (text.includes("source = 'csfloat_ref' AND volume")) {
      script.refQueries++;
      if (script.holdRef) await script.holdRef;
      if (script.failRef) throw new Error("ref query failed");
      if (script.empty) return { rows: [] };
      return {
        rows: [
          {
            skin_name: "AK-47 | Redline",
            condition: "Field-Tested",
            min_price_cents: script.median,
            median_price_cents: script.median,
            volume: 10,
          },
          {
            skin_name: "★ Karambit | Fade",
            condition: "Factory New",
            min_price_cents: 10000,
            median_price_cents: 10000,
            volume: 5,
          },
        ],
      };
    }
    if (text.includes("source IN ('csfloat_sales', 'csfloat_ref')")) {
      if (script.empty) return { rows: [] };
      return {
        rows: [{ skin_name: "AK-47 | Redline", condition: "Field-Tested", ref: script.median }],
      };
    }
    if (text.includes("source = 'csfloat_sales'")) return { rows: [] };
    if (text.includes("PERCENTILE_CONT")) return { rows: [{ median_ratio: null, n: 0 }] };
    if (text.includes("source = 'skinport'")) return { rows: [] };
    if (text.includes("UNION ALL")) {
      script.ceilingQueries++;
      if (script.holdCeiling) await script.holdCeiling;
      return {
        rows: [{
          skin_name: "AK-47 | Redline",
          float_value: 0.21,
          price_cents: 1100,
          source: "csfloat",
        }],
      };
    }
    if (text.includes("l.source = 'buff'")) return { rows: [] };
    if (text.includes("s.rarity = 'Extraordinary'")) return { rows: [] };
    if (text.includes("HAVING COUNT(*) >= 2")) return { rows: [] };
    if (text.includes("GROUP BY s.name, s.rarity")) {
      const min = params?.[0];
      const max = params?.[1];
      if (script.withListing && min === 0.15 && max === 0.38) {
        return {
          rows: [{
            name: "AK-47 | Redline",
            rarity: "Classified",
            lowest_price: 1200,
            cnt: 4,
          }],
        };
      }
      return { rows: [] };
    }
    if (text.includes("AVG(CASE WHEN float_value")) return { rows: [] };
    throw new Error(`unexpected sql: ${text.slice(0, 180)}`);
  };
  return { query } as pg.Pool;
}

function makeScript(overrides: Partial<Script> = {}): Script {
  return {
    holdRef: null,
    failRef: false,
    empty: false,
    median: 1500,
    refQueries: 0,
    withListing: false,
    holdCeiling: null,
    ceilingQueries: 0,
    ...overrides,
  };
}

function armHold(): { promise: Promise<void>; release: () => void } {
  let release: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function entries<V>(map: Map<string, V>): [string, V][] {
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

const measurements: string[] = [];

describe("price cache stale-while-revalidate", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetPriceCacheForTests();
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    writeFileSync("/opt/cursor/artifacts/price-cache-swr.txt", `${measurements.join("\n")}\n`);
  });

  it("returns a stale cache immediately while one rebuild starts", async () => {
    const script = makeScript();
    const pool = scriptedPool(script);
    await buildPriceCache(pool);
    expect(priceCache.get(REDLINE)).toBe(1500);
    const builtQueries = script.refQueries;

    expirePriceCacheForTests(PRICE_CACHE_TTL_MS + 60_000);
    const hold = armHold();
    script.holdRef = hold.promise;
    script.median = 900;

    const started = performance.now();
    await ensureRequestPriceCache(pool);
    const elapsed = performance.now() - started;
    measurements.push(`stale hit ${elapsed.toFixed(1)}ms`);

    expect(elapsed).toBeLessThan(1500);
    expect(script.refQueries).toBe(builtQueries + 1);
    expect(priceCache.get(REDLINE)).toBe(1500);

    hold.release();
    await settlePriceCacheRebuildForTests();
    expect(priceCache.get(REDLINE)).toBe(900);
  });

  it("runs buildPriceCache once for 10 concurrent requests across an expiry", async () => {
    const script = makeScript();
    const pool = scriptedPool(script);
    await buildPriceCache(pool);
    expirePriceCacheForTests(PRICE_CACHE_TTL_MS + 30_000);
    const hold = armHold();
    script.holdRef = hold.promise;
    script.median = 800;
    const before = script.refQueries;

    const started = performance.now();
    await Promise.all(Array.from({ length: 10 }, () => ensureRequestPriceCache(pool)));
    const elapsed = performance.now() - started;
    measurements.push(`10 concurrent stale ${elapsed.toFixed(1)}ms refQueries=${script.refQueries - before}`);

    expect(elapsed).toBeLessThan(1500);
    expect(script.refQueries - before).toBe(1);
    expect(priceCache.get(REDLINE)).toBe(1500);

    hold.release();
    await settlePriceCacheRebuildForTests();
    expect(priceCache.get(REDLINE)).toBe(800);
    for (const price of priceCache.values()) expect(Number.isInteger(price)).toBe(true);
  });

  it("keeps the old cache after a failed rebuild, clears the in-flight slot, and does not reject unhandled", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on("unhandledRejection", onUnhandled);

    const script = makeScript();
    const pool = scriptedPool(script);
    await buildPriceCache(pool);
    expirePriceCacheForTests(PRICE_CACHE_TTL_MS + 30_000);

    const hold = armHold();
    script.holdRef = hold.promise;
    script.failRef = true;
    await ensureRequestPriceCache(pool);
    const pending = settlePriceCacheRebuildForTests();
    expect(priceCache.get(REDLINE)).toBe(1500);

    hold.release();
    await expect(pending).rejects.toThrow(/ref query failed/);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(unhandled).toEqual([]);
    expect(priceCache.get(REDLINE)).toBe(1500);
    expect(priceCacheBuilt).toBe(true);
    expect(errorSpy).toHaveBeenCalled();

    script.failRef = false;
    script.median = 700;
    script.holdRef = null;
    const before = script.refQueries;
    await ensureRequestPriceCache(pool);
    await settlePriceCacheRebuildForTests();
    expect(script.refQueries).toBeGreaterThan(before);
    expect(priceCache.get(REDLINE)).toBe(700);

    process.off("unhandledRejection", onUnhandled);
  });

  it("blocks once the cache is older than three TTL periods and logs the cap", async () => {
    const script = makeScript();
    const pool = scriptedPool(script);
    await buildPriceCache(pool);
    expirePriceCacheForTests(PRICE_CACHE_MAX_STALE_MS + 1_000);
    const hold = armHold();
    script.holdRef = hold.promise;
    script.median = 600;

    let resolved = false;
    const pending = ensureRequestPriceCache(pool).then(() => { resolved = true; });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(resolved).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("[price-cache] stale for"));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("blocking until rebuild"));

    hold.release();
    await pending;
    expect(priceCache.get(REDLINE)).toBe(600);
  });

  it("awaits the first build on a cold start and never publishes an empty cache", async () => {
    const script = makeScript();
    const pool = scriptedPool(script);
    const hold = armHold();
    script.holdRef = hold.promise;

    let resolved = false;
    const pending = ensureRequestPriceCache(pool).then(() => { resolved = true; });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(resolved).toBe(false);
    expect(priceCache.size).toBe(0);

    const second = ensureRequestPriceCache(pool);
    hold.release();
    await pending;
    await second;
    expect(script.refQueries).toBe(1);
    expect(priceCache.get(REDLINE)).toBe(1500);
    expect(priceCacheBuilt).toBe(true);

    resetPriceCacheForTests();
    script.empty = true;
    script.holdRef = null;
    await expect(ensureRequestPriceCache(pool)).rejects.toThrow(/empty/);
    expect(priceCache.size).toBe(0);
    expect(priceCacheBuilt).toBe(false);
  });

  it("keeps blocking callers waiting for a fresh snapshot", async () => {
    const script = makeScript();
    const pool = scriptedPool(script);
    await buildPriceCache(pool);
    expirePriceCacheForTests(PRICE_CACHE_TTL_MS + 30_000);
    const hold = armHold();
    script.holdRef = hold.promise;
    script.median = 500;

    let resolved = false;
    const pending = buildPriceCache(pool).then(() => { resolved = true; });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(resolved).toBe(false);
    expect(priceCache.get(REDLINE)).toBe(1500);

    hold.release();
    await pending;
    expect(priceCache.get(REDLINE)).toBe(500);
  });

  it("builds the same prices in a shadow snapshot and in the committed cache", async () => {
    const script = makeScript({ withListing: true, median: 1500 });
    const pool = scriptedPool(script);
    const draft = await assemblePriceCache(pool);
    expect(priceCache.size).toBe(0);

    expect(draft.maps.prices.get(REDLINE)).toBe(1200);
    expect(draft.maps.prices.get(KNIFE_FN)).toBe(10000);
    expect(draft.maps.prices.get(KNIFE_MW)).toBe(8500);
    expect(draft.maps.sources.get(REDLINE)).toBe(
      "listing floor (4 listings, lower than csfloat_ref (10 vol))",
    );
    expect(draft.maps.sources.get(KNIFE_MW)).toBe("extrapolated from Factory New");
    for (const price of draft.maps.prices.values()) expect(Number.isInteger(price)).toBe(true);

    await buildPriceCache(pool);
    expect(entries(priceCache)).toEqual(entries(draft.maps.prices));
    expect(entries(priceSources)).toEqual(entries(draft.maps.sources));
    expect(entries(refPriceCache)).toEqual(entries(draft.maps.ref));
    expect(entries(skinportMedianCache)).toEqual(entries(draft.maps.skinportMedian));
    expect(entries(dmarketFloorCache)).toEqual(entries(draft.maps.dmarket));
    expect(entries(skinportFloorCache)).toEqual(entries(draft.maps.skinport));
    expect(entries(conditionMultiplierCache)).toEqual(entries(draft.multipliers));
    expect(entries(curveCache)).toEqual(entries(draft.curves));
  });

  it("serves a stale float ceiling immediately on the API path and blocks otherwise", async () => {
    seedFloatCeilingForTests("AK-47 | Redline", 0.2, 1000);
    ageFloatCeilingForTests(PRICE_CACHE_TTL_MS + 30_000);
    const script = makeScript();
    const hold = armHold();
    script.holdCeiling = hold.promise;
    const pool = scriptedPool(script);

    const started = performance.now();
    await runWithRequestCachePolicy(() => ensureFloatCeilingForTests(pool));
    const elapsed = performance.now() - started;
    measurements.push(`float ceiling stale ${elapsed.toFixed(1)}ms`);
    expect(elapsed).toBeLessThan(1500);
    expect(script.ceilingQueries).toBe(1);
    expect(floatCeilingCacheSizeForTests()).toBe(1);

    hold.release();
    await new Promise((resolve) => setTimeout(resolve, 20));

    resetPriceCacheForTests();
    seedFloatCeilingForTests("AK-47 | Redline", 0.2, 1000);
    ageFloatCeilingForTests(PRICE_CACHE_TTL_MS + 30_000);
    const blocking = makeScript();
    const blockHold = armHold();
    blocking.holdCeiling = blockHold.promise;
    let resolved = false;
    const pending = ensureFloatCeilingForTests(scriptedPool(blocking)).then(() => { resolved = true; });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(resolved).toBe(false);
    blockHold.release();
    await pending;
  });
});
