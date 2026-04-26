import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createTestApp, seedTestData, type TestContext } from "./setup.js";

describe("collection filter reproduction", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp({ defaultTier: "pro", defaultUserId: "user_pro" });

    await ctx.pool.query(`
      ALTER TABLE trade_ups
      ADD COLUMN IF NOT EXISTS collection_names TEXT[] NOT NULL DEFAULT '{}'
    `);

    await seedTestData(ctx.pool, {
      profitableCount: 0,
      unprofitableCount: 3,
      staleCount: 0,
      type: "covert_knife",
    });

    await ctx.pool.query(`
      UPDATE trade_ups
      SET collection_names = ARRAY['Test Collection Beta']
      WHERE type = 'covert_knife'
    `);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("returns unprofitable trade-ups when filtering by collection", async () => {
    const { rows: [countRow] } = await ctx.pool.query(
      `SELECT COUNT(DISTINCT t.id) AS c
       FROM trade_ups t
       JOIN trade_up_inputs i ON i.trade_up_id = t.id
       WHERE t.type = 'covert_knife'
         AND t.listing_status = 'active'
         AND t.is_theoretical = false
         AND i.collection_name = 'Test Collection Beta'`
    );

    expect(Number(countRow.c)).toBeGreaterThan(0);

    const res = await request(ctx.app)
      .get("/api/trade-ups?type=covert_knife&collection=Test+Collection+Beta")
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");

    expect(res.status).toBe(200);
    expect(res.body.trade_ups.length).toBeGreaterThan(0);
  });
});
