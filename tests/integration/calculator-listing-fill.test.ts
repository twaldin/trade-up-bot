import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createTestApp, type TestContext } from "./setup.js";

describe("calculator listing fill", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestApp({ defaultTier: "free", defaultUserId: "user_free" });
    await ctx.pool.query(`ALTER TABLE listings ALTER COLUMN float_value DROP NOT NULL`);
    await ctx.pool.query(
      `INSERT INTO collections (id, name) VALUES ('col-leet', 'The 2021 Train Collection')`,
    );
    await ctx.pool.query(
      `INSERT INTO skins (id, name, weapon, min_float, max_float, rarity, stattrak)
       VALUES ('skin-leet', 'AK-47 | Leet Museo', 'AK-47', 0, 0.65, 'Classified', false),
              ('skin-splash', 'SCAR-20 | Splash Jam', 'SCAR-20', 0.06, 0.8, 'Restricted', false)`,
    );
    await ctx.pool.query(
      `INSERT INTO skin_collections (skin_id, collection_id) VALUES ('skin-leet', 'col-leet'), ('skin-splash', 'col-leet')`,
    );
    await ctx.pool.query(
      `INSERT INTO listings (id, skin_id, price_cents, float_value, source, listing_type) VALUES
        ('aaa-null', 'skin-leet', 100, NULL, 'csfloat', 'buy_now'),
        ('aaa-auction', 'skin-leet', 50, 0.2, 'csfloat', 'auction'),
        ('aaa-zero', 'skin-leet', 0, 0.11, 'csfloat', 'buy_now'),
        ('aaa-ft', 'skin-leet', 16499, 0.25, 'csfloat', 'buy_now'),
        ('zzz-bs', 'skin-leet', 6075, 0.5, 'csfloat', 'buy_now')`,
    );
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("returns the cheap listing's own float when that wear is not the mid float", async () => {
    const mid = (0 + 0.65) / 2;
    expect(mid).toBeCloseTo(0.325);
    const res = await request(ctx.app).get("/api/calculator/search").query({ q: "Leet Museo" });
    expect(res.status).toBe(200);
    const hit = res.body.results.find((row: { name: string }) => row.name === "AK-47 | Leet Museo");
    expect(hit.floor_price_cents).toBe(6075);
    expect(hit.floor_float).toBe(0.5);
    expect(hit.floor_float).not.toBeCloseTo(mid);
    expect(hit.min_float).toBe(0);
    expect(hit.max_float).toBe(0.65);
  });

  it("returns no price or float when the skin has no priced listing", async () => {
    const res = await request(ctx.app).get("/api/calculator/search").query({ q: "Splash Jam" });
    expect(res.status).toBe(200);
    const hit = res.body.results.find((row: { name: string }) => row.name === "SCAR-20 | Splash Jam");
    expect(hit.floor_price_cents).toBeNull();
    expect(hit.floor_float).toBeNull();
  });

  it("rejects a non-positive or non-integer price before evaluation", async () => {
    for (const priceCents of [0, -5, 1.5, 10.2]) {
      const res = await request(ctx.app).post("/api/calculator").send({
        inputs: [{ skinName: "AK-47 | Leet Museo", floatValue: 0.5, priceCents }],
      });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/priceCents must be a positive integer/);
      expect(res.body.trade_up).toBeUndefined();
    }

    const accepted = await request(ctx.app).post("/api/calculator").send({
      inputs: [{ skinName: "AK-47 | Leet Museo", floatValue: 0.5, priceCents: 6075 }],
    });
    expect(accepted.status).toBe(400);
    expect(JSON.stringify(accepted.body)).not.toMatch(/positive integer/);
    expect(JSON.stringify(accepted.body)).toMatch(/at least 5/);
  });
});
