import { describe, it, expect, beforeEach, afterEach } from "vitest";
import pg from "pg";
import { createTestApp, type TestContext } from "./setup.js";
import { repriceTradeUpOutputs } from "../../server/engine/db-stats.js";

/**
 * Inserts a minimal trade_up row and returns its id.
 * outcomes_json='[]' so repriceTradeUpOutputs immediately stamps output_repriced_at
 * without needing any real price data.
 */
async function insertTU(
  pool: pg.Pool,
  opts: {
    profitCents: number;
    outputRepricedAt: string | null;
  }
): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO trade_ups
       (total_cost_cents, expected_value_cents, profit_cents, roi_percentage,
        listing_status, is_theoretical, outcomes_json, output_repriced_at)
     VALUES ($1, $2, $3, $4, 'active', false, '[]', $5)
     RETURNING id`,
    [
      10000,
      10000 + opts.profitCents,
      opts.profitCents,
      Math.round((opts.profitCents / 10000) * 10000) / 100,
      opts.outputRepricedAt,
    ]
  );
  return rows[0].id as number;
}

describe("repriceTradeUpOutputs — Phase 4c selection priority", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestApp({ defaultTier: "pro" });
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("processes a profitable TU before an unprofitable TU when both are stale", async () => {
    // Both have output_repriced_at = NULL (never repriced), but only limit=1 will be processed.
    const unprofitableId = await insertTU(ctx.pool, { profitCents: -500, outputRepricedAt: null });
    const profitableId = await insertTU(ctx.pool, { profitCents: 1000, outputRepricedAt: null });

    const result = await repriceTradeUpOutputs(ctx.pool, 1);

    expect(result.checked).toBe(1);

    // The profitable TU should have been processed (output_repriced_at set)
    const { rows: profitable } = await ctx.pool.query(
      "SELECT output_repriced_at FROM trade_ups WHERE id = $1", [profitableId]
    );
    const { rows: unprofitable } = await ctx.pool.query(
      "SELECT output_repriced_at FROM trade_ups WHERE id = $1", [unprofitableId]
    );

    expect(profitable[0].output_repriced_at).not.toBeNull();
    expect(unprofitable[0].output_repriced_at).toBeNull();
  });

  it("processes the oldest profitable TU first when multiple profitable TUs are stale", async () => {
    // newerProfitableId repriced 3 hours ago; olderProfitableId repriced 5 hours ago
    const olderProfitableId = await insertTU(ctx.pool, {
      profitCents: 2000,
      outputRepricedAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    });
    const newerProfitableId = await insertTU(ctx.pool, {
      profitCents: 800,
      outputRepricedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    });

    const result = await repriceTradeUpOutputs(ctx.pool, 1);

    expect(result.checked).toBe(1);

    const { rows: older } = await ctx.pool.query(
      "SELECT output_repriced_at FROM trade_ups WHERE id = $1",
      [olderProfitableId]
    );
    const { rows: newer } = await ctx.pool.query(
      "SELECT output_repriced_at FROM trade_ups WHERE id = $1",
      [newerProfitableId]
    );

    // Older profitable TU should have been touched (updated to a recent timestamp)
    expect(new Date(older[0].output_repriced_at).getTime()).toBeGreaterThan(
      Date.now() - 10_000
    );
    // Newer profitable TU should still have the old timestamp (not yet repriced)
    expect(new Date(newer[0].output_repriced_at).getTime()).toBeLessThan(
      Date.now() - 2 * 60 * 60 * 1000
    );
  });

  it("skips TUs that were repriced within the 2-hour window", async () => {
    // Repriced 30 minutes ago — should not qualify
    const freshId = await insertTU(ctx.pool, {
      profitCents: 5000,
      outputRepricedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    });
    // Stale profitable TU — should qualify
    const staleId = await insertTU(ctx.pool, {
      profitCents: 1000,
      outputRepricedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    });

    await repriceTradeUpOutputs(ctx.pool, 10);

    const { rows: fresh } = await ctx.pool.query(
      "SELECT output_repriced_at FROM trade_ups WHERE id = $1",
      [freshId]
    );
    const { rows: stale } = await ctx.pool.query(
      "SELECT output_repriced_at FROM trade_ups WHERE id = $1",
      [staleId]
    );

    // Fresh TU timestamp should be unchanged (still 30 min ago)
    expect(new Date(fresh[0].output_repriced_at).getTime()).toBeLessThan(
      Date.now() - 25 * 60 * 1000
    );
    // Stale TU should have been repriced now
    expect(new Date(stale[0].output_repriced_at).getTime()).toBeGreaterThan(
      Date.now() - 10_000
    );
  });
});
