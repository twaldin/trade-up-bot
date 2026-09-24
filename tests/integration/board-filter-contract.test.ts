import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createTestApp, type TestContext } from "./setup.js";

// chance, profit, cost — every row is restricted_classified and under $60.
// 0.1 * 10 sums to 0.9999999999999999: the engine's own "100%".
const ROWS: [number, number, number][] = [
  [1.0, 400, 3000],
  [0.1 + 0.1 + 0.1 + 0.1 + 0.1 + 0.1 + 0.1 + 0.1 + 0.1 + 0.1, 1200, 4000],
  [1.0, 800, 5500],
  [0.0333, -1008, 4631],
  [0.0333, -405, 1331],
  [0.025, -1179, 2661],
  [0.5, 2500, 5000],
];

interface Row { chance_to_profit: number; profit_cents: number; total_cost_cents: number; type: string }

describe("/api/trade-ups board filter contract", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp({ defaultTier: "pro", defaultUserId: "user_pro" });
    for (const [i, [chance, profit, cost]] of ROWS.entries()) {
      await ctx.pool.query(`
        INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, chance_to_profit,
          type, best_case_cents, worst_case_cents, listing_status, outcomes_json, output_skin_names, collection_names, created_at)
        VALUES ($1, $2, $3, $4, $5, 'restricted_classified', $6, $7, 'active', '[]', $8, $9, NOW() - INTERVAL '4 hours')
      `, [cost, cost + profit, profit, Math.round((profit / cost) * 10000) / 100, chance,
          profit + 500, profit - 500, ["Out"], [`Board Contract ${i}`]]);
    }
  });

  afterAll(async () => { await ctx.cleanup(); });

  async function list(qs: string): Promise<Row[]> {
    const res = await request(ctx.app)
      .get(`/api/trade-ups?${qs}`)
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");
    expect(res.status).toBe(200);
    return res.body.trade_ups;
  }

  it("min_chance=100 returns only 100% rows, sorted by profit", async () => {
    const rows = await list("per_page=12&sort=profit&order=desc&type=restricted_classified&min_chance=100&max_cost=6000&page=1");
    expect(rows.map((r) => r.profit_cents)).toEqual([1200, 800, 400]);
    for (const row of rows) {
      expect(row.chance_to_profit).toBeGreaterThan(0.999999);
      expect(row.total_cost_cents).toBeLessThanOrEqual(6000);
      expect(row.type).toBe("restricted_classified");
    }
  });

  it("min_chance is a percent: 40 keeps the 50% row and drops the ~3% rows", async () => {
    const rows = await list("type=restricted_classified&min_chance=40&sort=profit&order=desc");
    expect(rows.map((r) => r.profit_cents)).toEqual([2500, 1200, 800, 400]);
  });

  it("max_chance is a percent too", async () => {
    const rows = await list("type=restricted_classified&max_chance=5&sort=profit&order=desc");
    expect(rows.map((r) => r.profit_cents)).toEqual([-405, -1008, -1179]);
  });

  it("sort=profit_cents sorts by profit rather than falling back to score", async () => {
    const rows = await list("type=restricted_classified&sort=profit_cents&order=desc");
    expect(rows.map((r) => r.profit_cents)).toEqual([2500, 1200, 800, 400, -405, -1008, -1179]);
  });

  it("sort=total_cost_cents ascending sorts by cost", async () => {
    const rows = await list("type=restricted_classified&sort=total_cost_cents&order=asc");
    expect(rows.map((r) => r.total_cost_cents)).toEqual([1331, 2661, 3000, 4000, 4631, 5000, 5500]);
  });

  it("a non-numeric min_chance is ignored instead of erroring", async () => {
    const rows = await list("type=restricted_classified&min_chance=abc");
    expect(rows).toHaveLength(ROWS.length);
  });
});
