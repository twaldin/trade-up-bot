import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { createTestApp, type TestContext } from "./setup.js";

vi.mock("../../server/engine.js", () => ({
  batchInputValueRatios: vi.fn(async () => new Map<string, number>([
    ["good-listing", 0.5],
    ["junk-listing", 0.01],
  ])),
}));

import { listingSniperRouter } from "../../server/routes/listing-sniper.js";

describe("Listing sniper route", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();

    await ctx.pool.query(
      `INSERT INTO skins (id, name, weapon, rarity, min_float, max_float)
       VALUES
         ('skin-1', 'AK-47 | Test Skin', 'AK-47', 'Classified', 0.0, 1.0),
         ('skin-2', 'M4A4 | Test Skin', 'M4A4', 'Classified', 0.0, 1.0)`
    );

    await ctx.pool.query(
      `INSERT INTO listings (id, skin_id, price_cents, float_value, source, listing_type)
       VALUES
         ('good-listing', 'skin-1', 100, 0.2, 'csfloat', 'buy_now'),
         ('junk-listing', 'skin-2', 8, 0.7, 'csfloat', 'buy_now')`
    );

    ctx.app.use(listingSniperRouter(ctx.pool));
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("filters out implausible estimates above 10x listing price", async () => {
    const res = await request(ctx.app).get("/api/listing-sniper");

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.listings).toHaveLength(1);
    expect(res.body.listings[0].id).toBe("good-listing");
  });
});
