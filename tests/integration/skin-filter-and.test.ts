import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createTestApp, seedTestData, type TestContext } from "./setup.js";

describe("/api/trade-ups AND filter logic", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
    await seedTestData(ctx.pool);

    // Create a trade-up with TWO different input skins from TWO collections + a distinct outcome
    const outcomes = JSON.stringify([{
      skin_id: "skin-covert-1", skin_name: "AK-47 | Fire Serpent",
      collection_name: "Test Collection Alpha", probability: 0.5,
      predicted_float: 0.15, predicted_condition: "Field-Tested",
      estimated_price_cents: 20000,
    }, {
      skin_id: "skin-classified-2", skin_name: "M4A4 | Test Skin",
      collection_name: "Test Collection Beta", probability: 0.5,
      predicted_float: 0.15, predicted_condition: "Field-Tested",
      estimated_price_cents: 8000,
    }]);

    const { rows } = await ctx.pool.query(`
      INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, chance_to_profit, type, listing_status, outcomes_json, created_at)
      VALUES (5000, 14000, 9000, 180, 0.5, 'covert_knife', 'active', $1, NOW() - INTERVAL '4 hours')
      RETURNING id
    `, [outcomes]);
    const tuId = rows[0].id;

    // Mix of skins from both collections
    await ctx.pool.query(`INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [tuId, `multi-a-${tuId}`, "skin-classified-1", "AK-47 | Test Skin", "Test Collection Alpha", 1000, 0.15, "Field-Tested", "csfloat"]);
    await ctx.pool.query(`INSERT INTO listings (id, skin_id, price_cents, float_value, source) VALUES ($1, $2, $3, $4, $5)`,
      [`multi-a-${tuId}`, "skin-classified-1", 1000, 0.15, "csfloat"]);
    await ctx.pool.query(`INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [tuId, `multi-b-${tuId}`, "skin-classified-2", "M4A4 | Test Skin", "Test Collection Beta", 1000, 0.35, "Field-Tested", "csfloat"]);
    await ctx.pool.query(`INSERT INTO listings (id, skin_id, price_cents, float_value, source) VALUES ($1, $2, $3, $4, $5)`,
      [`multi-b-${tuId}`, "skin-classified-2", 1000, 0.35, "csfloat"]);
  });

  afterAll(async () => { await ctx.cleanup(); });

  it("single skin filter works (input)", async () => {
    const res = await request(ctx.app).get("/api/trade-ups?skin=AK-47+%7C+Test+Skin");
    expect(res.status).toBe(200);
    expect(res.body.trade_ups.length).toBeGreaterThan(0);
  });

  it("single skin filter works (output via outcomes_json)", async () => {
    const res = await request(ctx.app).get("/api/trade-ups?skin=AK-47+%7C+Fire+Serpent");
    expect(res.status).toBe(200);
    expect(res.body.trade_ups.length).toBeGreaterThan(0);
  });

  it("multi-skin AND: both present returns results", async () => {
    // This trade-up has AK-47 | Test Skin as input AND AK-47 | Fire Serpent as outcome
    const res = await request(ctx.app).get("/api/trade-ups?skin=AK-47+%7C+Test+Skin||AK-47+%7C+Fire+Serpent");
    expect(res.status).toBe(200);
    expect(res.body.trade_ups.length).toBeGreaterThan(0);
  });

  it("multi-skin AND: impossible combo returns zero", async () => {
    // No trade-up has both M4A4 | Test Skin as input AND some non-existent skin
    const res = await request(ctx.app).get("/api/trade-ups?skin=M4A4+%7C+Test+Skin||NonExistent+Skin");
    expect(res.status).toBe(200);
    expect(res.body.trade_ups).toHaveLength(0);
  });

  it("multi-collection AND: both present returns results", async () => {
    // The mixed trade-up has inputs from both Alpha and Beta collections
    const res = await request(ctx.app).get("/api/trade-ups?collection=Test+Collection+Alpha|Test+Collection+Beta");
    expect(res.status).toBe(200);
    expect(res.body.trade_ups.length).toBeGreaterThan(0);
  });

  it("multi-collection AND: impossible combo returns zero", async () => {
    const res = await request(ctx.app).get("/api/trade-ups?collection=Test+Collection+Alpha|NonExistent+Collection");
    expect(res.status).toBe(200);
    expect(res.body.trade_ups).toHaveLength(0);
  });
});
