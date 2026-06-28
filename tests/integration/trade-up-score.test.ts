import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestApp, type TestContext } from "./setup.js";

/**
 * E1: trade_up_score is a persisted, indexed column maintained by a DB trigger
 * from the FROZEN formula (operating contract):
 *   roi_frac      = profit_cents / total_cost_cents
 *   downside_frac = max(0, -worst_case_cents) / total_cost_cents
 *   score = round(1000 * chance_to_profit * roi_frac / (1 + downside_frac))   (cost<=0 => 0)
 * The trigger fires on INSERT and on UPDATE of the four source columns, so it
 * covers every write path (save / reprice / revive) with no app-code changes.
 */
describe("trade_up_score trigger (E1)", () => {
  let ctx: TestContext;
  beforeEach(async () => { ctx = await createTestApp({ defaultTier: "pro" }); });
  afterEach(async () => { await ctx.cleanup(); });

  async function insert(profit: number, cost: number, chance: number, worst: number): Promise<number> {
    const { rows } = await ctx.pool.query(
      `INSERT INTO trade_ups
         (total_cost_cents, expected_value_cents, profit_cents, roi_percentage,
          chance_to_profit, worst_case_cents, type, listing_status, is_theoretical, outcomes_json)
       VALUES ($1, $2, $3, 0, $4, $5, 'milspec_restricted', 'active', false, '[]')
       RETURNING trade_up_score`,
      [cost, cost + profit, profit, chance, worst]
    );
    return rows[0].trade_up_score as number;
  }

  it("computes trade_up_score on INSERT from the frozen formula", async () => {
    // roi=500/1000=0.5; downside=200/1000=0.2; chance=0.5
    // score = round(1000 * 0.5 * 0.5 / 1.2) = round(208.33) = 208
    expect(await insert(500, 1000, 0.5, -200)).toBe(208);
  });

  it("recomputes trade_up_score on UPDATE of profit/EV (reprice path)", async () => {
    const { rows: ins } = await ctx.pool.query(
      `INSERT INTO trade_ups
         (total_cost_cents, expected_value_cents, profit_cents, roi_percentage,
          chance_to_profit, worst_case_cents, type, listing_status, is_theoretical, outcomes_json)
       VALUES (1000, 1500, 500, 0, 0.5, -200, 'milspec_restricted', 'active', false, '[]')
       RETURNING id`
    );
    const id = ins[0].id;
    // profit 1000 (roi 1.0): score = round(1000 * 0.5 * 1.0 / 1.2) = round(416.67) = 417
    await ctx.pool.query(
      `UPDATE trade_ups SET profit_cents = 1000, expected_value_cents = 2000 WHERE id = $1`,
      [id]
    );
    const { rows } = await ctx.pool.query(`SELECT trade_up_score FROM trade_ups WHERE id = $1`, [id]);
    expect(rows[0].trade_up_score).toBe(417);
  });

  it("score is 0 when total_cost_cents <= 0 (no divide-by-zero)", async () => {
    expect(await insert(0, 0, 0.5, 0)).toBe(0);
  });

  it("negative-EV contract gets a negative score (sinks to bottom of sort)", async () => {
    // profit -300 / cost 1000 = roi -0.3; downside 400/1000=0.4; chance 0.2
    // score = round(1000 * 0.2 * -0.3 / 1.4) = round(-42.86) = -43
    expect(await insert(-300, 1000, 0.2, -400)).toBe(-43);
  });

  it("a touch-only UPDATE (output_repriced_at) leaves the score unchanged", async () => {
    const { rows: ins } = await ctx.pool.query(
      `INSERT INTO trade_ups
         (total_cost_cents, expected_value_cents, profit_cents, roi_percentage,
          chance_to_profit, worst_case_cents, type, listing_status, is_theoretical, outcomes_json)
       VALUES (1000, 1500, 500, 0, 0.5, -200, 'milspec_restricted', 'active', false, '[]')
       RETURNING id`
    );
    const id = ins[0].id;
    await ctx.pool.query(`UPDATE trade_ups SET output_repriced_at = NOW() WHERE id = $1`, [id]);
    const { rows } = await ctx.pool.query(`SELECT trade_up_score FROM trade_ups WHERE id = $1`, [id]);
    expect(rows[0].trade_up_score).toBe(208);
  });
});
