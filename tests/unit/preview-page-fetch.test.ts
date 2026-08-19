import { describe, expect, it } from "vitest";
import {
  RATE_LIMIT_MESSAGE,
  RateLimitError,
  applyRateLimit,
  backoffMs,
  canLoadMore,
  isRateLimitError,
  isRateLimited,
  pageIsShort,
  readPagedJson,
} from "../../src/preview/lib/page-fetch.js";

describe("canLoadMore", () => {
  const idle = { inFlight: false, exhausted: false, backoffUntil: 0, now: 1_000 };

  it("does not fire loadMore while a request is in flight", () => {
    expect(canLoadMore({ ...idle, inFlight: true })).toBe(false);
  });

  it("does not fire once the list is exhausted", () => {
    expect(canLoadMore({ ...idle, exhausted: true })).toBe(false);
  });

  it("does not fire during a 429 backoff window", () => {
    expect(canLoadMore({ ...idle, backoffUntil: 5_000, now: 1_500 })).toBe(false);
  });

  it("fires again after backoff elapses when nothing is in flight", () => {
    expect(canLoadMore({ ...idle, backoffUntil: 5_000, now: 5_000 })).toBe(true);
    expect(canLoadMore(idle)).toBe(true);
  });
});

describe("429 backoff", () => {
  it("recognises the Express limiter body Tim hit live", () => {
    expect(isRateLimited(429, { message: RATE_LIMIT_MESSAGE })).toBe(true);
    expect(isRateLimited(200, { message: RATE_LIMIT_MESSAGE })).toBe(true);
    expect(isRateLimited(200, { trade_ups: [] })).toBe(false);
    expect(RATE_LIMIT_MESSAGE).toBe("Too many requests, please try again later.");
  });

  it("does not tight-loop: each 429 doubles the wait, capped at 32s", () => {
    expect(backoffMs(0)).toBe(2_000);
    expect(backoffMs(1)).toBe(4_000);
    expect(backoffMs(2)).toBe(8_000);
    expect(backoffMs(3)).toBe(16_000);
    expect(backoffMs(4)).toBe(32_000);
    expect(backoffMs(9)).toBe(32_000);

    const first = applyRateLimit(0, 1_000);
    expect(first).toEqual({ attempt: 1, backoffUntil: 3_000 });
    const second = applyRateLimit(first.attempt, 3_000);
    expect(second.backoffUntil - 3_000).toBe(4_000);
    expect(canLoadMore({
      inFlight: false,
      exhausted: false,
      backoffUntil: first.backoffUntil,
      now: 1_500,
    })).toBe(false);
  });

  it("throws RateLimitError from a 429 JSON body instead of returning an empty page", async () => {
    const res = {
      status: 429,
      ok: false,
      json: async () => ({ message: RATE_LIMIT_MESSAGE }),
    };
    await expect(readPagedJson(res)).rejects.toBeInstanceOf(RateLimitError);
    await expect(readPagedJson(res)).rejects.toSatisfy((err: unknown) => isRateLimitError(err));
  });
});

describe("pageIsShort", () => {
  it("lets the skins index keep paging past 200 when pages stay full", () => {
    const pageSize = 100;
    let loaded = 0;
    let exhausted = false;
    for (let page = 1; page <= 5; page++) {
      const received = 100;
      loaded += received;
      exhausted = pageIsShort(received, pageSize);
      expect(exhausted, `page ${page} of ${loaded} skins`).toBe(false);
    }
    expect(loaded).toBe(500);
    expect(pageIsShort(40, pageSize)).toBe(true);
    expect(pageIsShort(0, pageSize)).toBe(true);
  });
});
