import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createExpandedApp, type TestContext } from "./setup.js";

describe("GET /api/board-delay", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createExpandedApp();
    await ctx.pool.query(`
      INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, type, listing_status, created_at)
      VALUES
        (1000, 2800, 1800, 180, 'classified_covert', 'active', NOW()),
        (1000, 1500, 500, 50, 'classified_covert', 'active', NOW()),
        (1000, 900, -100, -10, 'classified_covert', 'active', NOW()),
        (1000, 9999, 8999, 900, 'classified_covert', 'stale', NOW()),
        (1000, 4000, 3000, 300, 'classified_covert', 'active', NOW() - INTERVAL '4 hours')
    `);
    await ctx.pool.query(`
      INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, type, listing_status, is_theoretical, created_at)
      VALUES (1000, 5000, 4000, 400, 'classified_covert', 'active', true, NOW())
    `);
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("counts only active profitable rows inside the 3-hour window", async () => {
    const res = await request(ctx.app).get("/api/board-delay");
    expect(res.status).toBe(200);
    expect(res.body.delay_seconds).toBe(10800);
    expect(res.body.hidden_profitable).toBe(2);
    expect(res.body.best_hidden_profit_cents).toBe(1800);
    expect(res.headers["cache-control"]).toContain("max-age=60");
    expect(JSON.stringify(res.body)).not.toMatch(/listing_id|skin_name/);
  });
});
