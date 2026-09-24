import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createTestApp, seedTestData, type TestContext } from "./setup.js";
import { initRedis, isRedisAvailable } from "../../server/redis.js";
import {
  resetLeakedTradeUpHealSchedule,
  triggerLeakedTradeUpHeal,
} from "../../server/daemon/leaked-tradeup-heal.js";

/**
 * Real Redis: a cached GET /api/trade-ups page is a miss after the heal
 * flushes tu:*. This file does not mock cacheInvalidatePrefix.
 */

async function waitForRedis(): Promise<void> {
  initRedis();
  for (let i = 0; i < 40; i++) {
    if (isRedisAvailable()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Redis did not connect");
}

describe("leaked trade-up heal cache", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    await waitForRedis();
  });

  beforeEach(async () => {
    resetLeakedTradeUpHealSchedule();
    ctx = await createTestApp({ defaultTier: "pro", defaultUserId: "user_pro" });
    await seedTestData(ctx.pool, {
      profitableCount: 4,
      unprofitableCount: 0,
      staleCount: 0,
      type: "covert_knife",
    });
  });

  afterEach(async () => {
    resetLeakedTradeUpHealSchedule();
    await ctx.cleanup();
  });

  it("a cached board page misses after a heal", async () => {
    const headers = { "X-Test-User-Id": "user_pro", "X-Test-User-Tier": "pro" };
    const path = `/api/trade-ups?type=covert_knife&per_page=50&cache_bust=${Date.now()}`;

    const first = await request(ctx.app).get(path).set(headers);
    expect(first.status).toBe(200);
    expect(first.headers["x-cache"]).toBe("MISS");
    const beforeIds = first.body.trade_ups.map((tu: { id: number }) => tu.id);
    expect(beforeIds.length).toBeGreaterThan(0);

    const hit = await request(ctx.app).get(path).set(headers);
    expect(hit.headers["x-cache"]).toBe("HIT");
    expect(hit.body.trade_ups.map((tu: { id: number }) => tu.id)).toEqual(beforeIds);

    const brokenId = beforeIds[0];
    await ctx.pool.query(
      `DELETE FROM listings WHERE id IN (
         SELECT listing_id FROM trade_up_inputs WHERE trade_up_id = $1 LIMIT 1
       )`,
      [brokenId],
    );

    const healed = await triggerLeakedTradeUpHeal(ctx.pool);
    expect(healed).not.toBeNull();
    expect(healed!.updated).toBeGreaterThan(0);
    expect(healed!.cacheFlushed).toBe(true);

    const after = await request(ctx.app).get(path).set(headers);
    expect(after.status).toBe(200);
    expect(after.headers["x-cache"]).toBe("MISS");
    expect(after.body.trade_ups.map((tu: { id: number }) => tu.id)).not.toContain(brokenId);
  });
});
