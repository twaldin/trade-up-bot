import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp, type TestContext } from "./setup.js";

describe("market filter", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("trade_ups table has input_sources column", async () => {
    const { rows } = await ctx.pool.query(`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'trade_ups'
        AND column_name = 'input_sources'
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].data_type).toBe("ARRAY");
  });

  it("input_sources defaults to empty array", async () => {
    const { rows } = await ctx.pool.query(`
      INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, type, outcomes_json)
      VALUES (1000, 1500, 500, 50.0, 'classified_covert', '[]')
      RETURNING input_sources
    `);
    expect(rows[0].input_sources).toEqual([]);
  });
});
