import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestApp, seedTestData, type TestContext } from "./setup.js";
import {
  LEAKED_TRADEUP_HEAL_INTERVAL_MS,
  resetLeakedTradeUpHealSchedule,
  leakedTradeUpHealRunCount,
  triggerLeakedTradeUpHeal,
} from "../../server/daemon/leaked-tradeup-heal.js";

/**
 * Debounced daemon heal: marks leaked active rows stale/partial with
 * preserved_at, leaves live claims alone, and runs once per window.
 */

const redisCalls = vi.hoisted(() => ({
  invalidate: [] as string[],
  versions: [] as string[],
}));

vi.mock("../../server/redis.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/redis.js")>();
  return {
    ...actual,
    cacheInvalidatePrefix: async (prefix: string) => {
      redisCalls.invalidate.push(prefix);
      return 0;
    },
    setCycleVersion: async (version: string) => {
      redisCalls.versions.push(version);
    },
  };
});

describe("leaked trade-up heal", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    redisCalls.invalidate.length = 0;
    redisCalls.versions.length = 0;
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

  async function activeIds(): Promise<number[]> {
    const { rows } = await ctx.pool.query<{ id: number }>(
      `SELECT id FROM trade_ups WHERE listing_status = 'active' AND type = 'covert_knife' ORDER BY id ASC`
    );
    return rows.map((row) => row.id);
  }

  async function deleteInputs(tradeUpId: number, all: boolean): Promise<void> {
    await ctx.pool.query(
      `DELETE FROM listings WHERE id IN (
         SELECT listing_id FROM trade_up_inputs WHERE trade_up_id = $1 ${all ? "" : "LIMIT 1"}
       )`,
      [tradeUpId]
    );
  }

  it("marks partial and fully-missing rows, and bumps cycle_version once", async () => {
    const [partialId, staleId] = await activeIds();
    await deleteInputs(partialId, false);
    await deleteInputs(staleId, true);

    const result = await triggerLeakedTradeUpHeal(ctx.pool);

    expect(result).not.toBeNull();
    expect(result!.updated).toBeGreaterThanOrEqual(2);
    expect(result!.cacheBumped).toBe(true);
    expect(redisCalls.invalidate).toEqual([]);
    expect(redisCalls.versions).toHaveLength(1);

    const { rows } = await ctx.pool.query<{ id: number; listing_status: string; preserved_at: Date | null }>(
      `SELECT id, listing_status, preserved_at FROM trade_ups WHERE id = ANY($1::int[])`,
      [[partialId, staleId]]
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(partialId)?.listing_status).toBe("partial");
    expect(byId.get(partialId)?.preserved_at).not.toBeNull();
    expect(byId.get(staleId)?.listing_status).toBe("stale");
    expect(byId.get(staleId)?.preserved_at).not.toBeNull();
    const { rows: stillThere } = await ctx.pool.query(
      `SELECT id FROM trade_ups WHERE id = $1`,
      [staleId]
    );
    expect(stillThere).toHaveLength(1);
  });

  it("does not heal a trade-up with a live claim", async () => {
    const [claimedId, openId] = await activeIds();
    await ctx.pool.query(
      `INSERT INTO trade_up_claims (trade_up_id, user_id, expires_at)
       VALUES ($1, 'claimer', NOW() + INTERVAL '30 minutes')`,
      [claimedId]
    );
    await deleteInputs(claimedId, false);
    await deleteInputs(openId, false);

    await triggerLeakedTradeUpHeal(ctx.pool);

    const { rows } = await ctx.pool.query<{ id: number; listing_status: string; preserved_at: Date | null }>(
      `SELECT id, listing_status, preserved_at FROM trade_ups WHERE id = ANY($1::int[])`,
      [[claimedId, openId]]
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(claimedId)?.listing_status).toBe("active");
    expect(byId.get(claimedId)?.preserved_at).toBeNull();
    expect(byId.get(openId)?.listing_status).toBe("partial");
    expect(byId.get(openId)?.preserved_at).not.toBeNull();
  });

  it("runs at most once per debounce window under concurrent triggers", async () => {
    const [brokenId] = await activeIds();
    await deleteInputs(brokenId, false);
    const now = 1_700_000_000_000;

    const runs = await Promise.all([
      triggerLeakedTradeUpHeal(ctx.pool, now),
      triggerLeakedTradeUpHeal(ctx.pool, now),
      triggerLeakedTradeUpHeal(ctx.pool, now + 10),
      triggerLeakedTradeUpHeal(ctx.pool, now + LEAKED_TRADEUP_HEAL_INTERVAL_MS - 1),
    ]);

    expect(leakedTradeUpHealRunCount()).toBe(1);
    expect(runs[0]).not.toBeNull();
    expect(runs[1]).toBe(runs[0]);
    expect(runs[2]).toBe(runs[0]);
    expect(runs[3]).toBe(runs[0]);
    expect(redisCalls.versions).toHaveLength(1);
    expect(redisCalls.invalidate).toEqual([]);

    const again = await triggerLeakedTradeUpHeal(ctx.pool, now + 1_000);
    expect(again).toBeNull();
    expect(leakedTradeUpHealRunCount()).toBe(1);

    const nextWindow = await triggerLeakedTradeUpHeal(ctx.pool, now + LEAKED_TRADEUP_HEAL_INTERVAL_MS);
    expect(nextWindow).not.toBeNull();
    expect(nextWindow!.updated).toBe(0);
    expect(nextWindow!.cacheBumped).toBe(false);
    expect(leakedTradeUpHealRunCount()).toBe(2);
    expect(redisCalls.versions).toHaveLength(1);
  });
});
