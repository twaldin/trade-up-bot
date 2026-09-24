import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RateLimitError,
  applyRateLimit,
  browseErrorKind,
  browseHeldUntil,
  cursorFor,
  retryDelayMs,
  fetchBrowseJson,
  holdBrowse,
  isAbortError,
  isExhausted,
  parseRetryAfter,
  peekBrowseJson,
  rateLimitWaitMs,
  readPagedJson,
  resetBrowseFetchState,
  retryAfterOf,
  startCursor,
  subscribeBrowseHold,
} from "../../src/preview/lib/page-fetch.js";

function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

function tooMany(retryAfter?: string): Response {
  return json(
    { error: "rate_limited", message: "Too many requests, please try again later." },
    { status: 429, headers: retryAfter ? { "retry-after": retryAfter } : {} },
  );
}

afterEach(() => {
  resetBrowseFetchState();
  vi.useRealTimers();
});

describe("Retry-After", () => {
  it("reads delta-seconds and HTTP dates, and ignores junk", () => {
    expect(parseRetryAfter("7")).toBe(7_000);
    expect(parseRetryAfter("0")).toBe(0);
    const now = Date.parse("2026-09-24T19:00:00Z");
    expect(parseRetryAfter("Thu, 24 Sep 2026 19:00:30 GMT", now)).toBe(30_000);
    expect(parseRetryAfter("soon")).toBeNull();
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("-3")).toBeNull();
  });

  it("carries the server's Retry-After on the thrown RateLimitError", async () => {
    await expect(readPagedJson(tooMany("12"))).rejects.toSatisfy(
      (err: unknown) => err instanceof RateLimitError && err.retryAfterMs === 12_000,
    );
    expect(retryAfterOf(new RateLimitError(undefined, 5_000))).toBe(5_000);
    expect(retryAfterOf(new Error("x"))).toBeNull();
  });

  it("waits what the server asked instead of guessing, plus bounded jitter", () => {
    expect(rateLimitWaitMs(0, 9_000)).toBe(9_000);
    expect(rateLimitWaitMs(3, 9_000)).toBe(9_000);
    expect(rateLimitWaitMs(2, null)).toBe(8_000);
    expect(rateLimitWaitMs(0, 0)).toBeGreaterThanOrEqual(1_000);
    const jittered = rateLimitWaitMs(0, 10_000, () => 0.999);
    expect(jittered).toBeGreaterThan(10_000);
    expect(jittered).toBeLessThanOrEqual(12_000);
    expect(applyRateLimit(0, 1_000, { retryAfterMs: 20_000 })).toEqual({ attempt: 1, backoffUntil: 21_000 });
  });
});

describe("fetchBrowseJson", () => {
  it("coalesces identical in-flight GETs into one request", async () => {
    const fetchFn = vi.fn(async () => json({ trade_ups: [1] }));
    const [a, b, c] = await Promise.all([
      fetchBrowseJson("/api/skin-data/x", { fetchFn }),
      fetchBrowseJson("/api/skin-data/x", { fetchFn }),
      fetchBrowseJson("/api/skin-data/x", { fetchFn }),
    ]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ trade_ups: [1] });
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it("serves a fresh copy from memory and refetches once it is older than the TTL", async () => {
    let now = 1_000;
    const fetchFn = vi.fn(async () => json({ n: fetchFn.mock.calls.length }));
    const first = await fetchBrowseJson("/api/collections", { fetchFn, ttlMs: 5_000, now: () => now });
    now += 4_000;
    const second = await fetchBrowseJson("/api/collections", { fetchFn, ttlMs: 5_000, now: () => now });
    expect(second).toEqual(first);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    now += 2_000;
    await fetchBrowseJson("/api/collections", { fetchFn, ttlMs: 5_000, now: () => now });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("lets a revisited page read its fresh copy synchronously", async () => {
    const fetchFn = vi.fn(async () => json([{ name: "Dreams & Nightmares" }]));
    expect(peekBrowseJson("/api/collections")).toBeNull();
    await fetchBrowseJson("/api/collections", { fetchFn, now: () => 1_000 });
    expect(peekBrowseJson("/api/collections", 60_000, 30_000)).toEqual([{ name: "Dreams & Nightmares" }]);
    expect(peekBrowseJson("/api/collections", 60_000, 70_000)).toBeNull();
  });

  it("keeps the last good page on a 429 instead of blanking it", async () => {
    let now = 1_000;
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(json({ skins: ["a"] }))
      .mockResolvedValueOnce(tooMany("30"));
    await fetchBrowseJson("/api/skin-data?page=1", { fetchFn, ttlMs: 1_000, now: () => now });
    now += 5_000;
    const again = await fetchBrowseJson("/api/skin-data?page=1", { fetchFn, ttlMs: 1_000, now: () => now });
    expect(again).toEqual({ skins: ["a"] });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("does not cache a 429, and holds every browse request until Retry-After", async () => {
    let now = 10_000;
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(tooMany("2"))
      .mockResolvedValue(json({ ok: true }));
    await expect(fetchBrowseJson("/api/trade-ups?page=2", { fetchFn, now: () => now })).rejects.toBeInstanceOf(RateLimitError);
    expect(browseHeldUntil()).toBeGreaterThanOrEqual(12_000);
    expect(browseHeldUntil()).toBeLessThanOrEqual(12_500);

    vi.useFakeTimers();
    const other = fetchBrowseJson("/api/skin-data?page=3", { fetchFn, now: () => now });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    now = browseHeldUntil();
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(other).resolves.toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("tells subscribers when a hold starts so pages can say why they paused", async () => {
    const seen: number[] = [];
    const unsubscribe = subscribeBrowseHold(() => seen.push(browseHeldUntil()));
    const fetchFn = vi.fn(async () => tooMany("4"));
    await fetchBrowseJson("/api/preview/faces?names=a", { fetchFn, now: () => 50_000 }).catch(() => {});
    unsubscribe();
    holdBrowse(999_999);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeGreaterThanOrEqual(54_000);
  });

  it("never sends a request whose only caller gave up while it waited", async () => {
    let now = 0;
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(tooMany("5"))
      .mockResolvedValue(json({ ok: true }));
    await fetchBrowseJson("/api/trade-ups?page=1", { fetchFn, now: () => now }).catch(() => {});
    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = fetchBrowseJson("/api/trade-ups?skin=a&page=1", { fetchFn, signal: controller.signal, now: () => now });
    controller.abort();
    await expect(pending).rejects.toSatisfy(isAbortError);
    now = 60_000;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("one caller aborting does not cancel the shared request for the others", async () => {
    let release: (res: Response) => void = () => {};
    const fetchFn = vi.fn(() => new Promise<Response>((resolve) => { release = resolve; }));
    const controller = new AbortController();
    const quitter = fetchBrowseJson("/api/skin-data/y", { fetchFn, signal: controller.signal });
    const stayer = fetchBrowseJson("/api/skin-data/y", { fetchFn });
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalled());
    controller.abort();
    await expect(quitter).rejects.toSatisfy(isAbortError);
    release(json({ name: "y" }));
    await expect(stayer).resolves.toEqual({ name: "y" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("surfaces non-429 failures instead of pretending the list is empty", async () => {
    const fetchFn = vi.fn(async () => json({ error: "Not found" }, { status: 404 }));
    await expect(fetchBrowseJson("/api/skin-by-slug/nope", { fetchFn })).rejects.toThrow(/404/);
  });
});

describe("browseErrorKind", () => {
  it("separates a throttle from a real failure so neither renders as an empty result", () => {
    expect(browseErrorKind(new RateLimitError())).toBe("throttled");
    expect(browseErrorKind(Object.assign(new Error("Aborted"), { name: "AbortError" }))).toBe("aborted");
    expect(browseErrorKind(new Error("HTTP 500"))).toBe("failed");
    expect(browseErrorKind(new TypeError("Failed to fetch"))).toBe("failed");
  });

  it("gives a retry delay that waits out the shared hold, never less than a second", () => {
    expect(retryDelayMs(10_000)).toBe(1_000);
    holdBrowse(25_000);
    expect(retryDelayMs(10_000)).toBe(15_000);
  });
});

describe("page cursor", () => {
  it("snaps back to page 1 the moment the filter key changes", () => {
    const deep = { ...startCursor("sort=score"), page: 7, exhausted: true, retry: 2 };
    expect(cursorFor(deep, "sort=score")).toBe(deep);
    expect(cursorFor(deep, "sort=profit")).toEqual({ key: "sort=profit", page: 1, exhausted: false, retry: 0 });
  });

  it("uses the server total when it has one, so a page thinned by hidden claims is not the end", () => {
    expect(isExhausted({ received: 20, pageSize: 24, page: 1, total: 300 })).toBe(false);
    expect(isExhausted({ received: 24, pageSize: 24, page: 13, total: 300 })).toBe(true);
    expect(isExhausted({ received: 0, pageSize: 24, page: 2, total: 300 })).toBe(true);
    expect(isExhausted({ received: 40, pageSize: 100, page: 3 })).toBe(true);
    expect(isExhausted({ received: 100, pageSize: 100, page: 3 })).toBe(false);
  });
});
