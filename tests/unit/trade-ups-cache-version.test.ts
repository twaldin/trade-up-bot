import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function load() {
  vi.resetModules();
  return import("../../server/routes/trade-ups-query.js");
}

describe("trade-ups cache key is versioned per deploy (214 N1)", () => {
  it("embeds the response version and the build id under the tu: prefix", async () => {
    vi.stubEnv("BUILD_SHA", "abc123def4567890");
    const q = await load();
    const key = q.tradeUpsCacheKey({ type: "classified_covert" }, "anon", "free");
    expect(key.startsWith(`tu:v${q.TRADE_UPS_RESPONSE_VERSION}:abc123def456:`)).toBe(true);
    expect(q.TRADE_UPS_RESPONSE_VERSION).toBeGreaterThanOrEqual(3);
  });

  it("a different deploy gets a different key for the same request", async () => {
    vi.stubEnv("BUILD_SHA", "1111111111111111");
    const before = (await load()).tradeUpsCacheKey({}, "anon", "free");
    vi.stubEnv("BUILD_SHA", "2222222222222222");
    const after = (await load()).tradeUpsCacheKey({}, "anon", "free");
    expect(before).not.toBe(after);
    expect(before.startsWith("tu:")).toBe(true);
    expect(after.startsWith("tu:")).toBe(true);
  });

  it("falls back to the git HEAD of the checkout when BUILD_SHA is unset", async () => {
    vi.stubEnv("BUILD_SHA", "");
    const q = await load();
    expect(q.TRADE_UPS_CACHE_BUILD).toMatch(/^([0-9a-f]{7,12}|dev)$/);
  });

  it("keeps the key stable within one process", async () => {
    vi.stubEnv("BUILD_SHA", "feedfacefeedface");
    const q = await load();
    expect(q.tradeUpsCacheKey({ page: "1" }, "a", "pro")).toBe(q.tradeUpsCacheKey({}, "a", "pro"));
  });
});
