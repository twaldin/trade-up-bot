import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createTestApp, seedTestData, type TestContext } from "./setup.js";
import { PREFERRED_EXAMPLE_TRADE_UP_ID } from "../../shared/calculator-example.js";

describe("GET /api/calculator/example", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestApp({ defaultTier: "free", defaultUserId: "user_free" });
    await seedTestData(ctx.pool, {
      profitableCount: 2,
      unprofitableCount: 1,
      staleCount: 0,
      type: "classified_covert",
    });
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  async function insertPreferredContract(opts: {
    listingPriceCents: number;
    snapshotPriceCents: number;
    listingFloat: number;
    snapshotFloat: number;
    keepListings?: boolean;
  }) {
    const outcomes = JSON.stringify([]);
    await ctx.pool.query(
      `INSERT INTO trade_ups (
         id, total_cost_cents, expected_value_cents, profit_cents, roi_percentage,
         chance_to_profit, type, best_case_cents, worst_case_cents, listing_status,
         outcomes_json, output_skin_names, collection_names, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'classified_covert', $7, $8, 'active', $9, $10, $11, NOW() - INTERVAL '4 hours')`,
      [
        PREFERRED_EXAMPLE_TRADE_UP_ID,
        opts.listingPriceCents * 10,
        999999,
        888888,
        77.7,
        0.99,
        123456,
        -1,
        outcomes,
        ["AK-47 | Fire Serpent"],
        ["Test Collection Alpha"],
      ],
    );

    for (let i = 0; i < 10; i++) {
      const listingId = `preferred-listing-${i}`;
      if (opts.keepListings !== false) {
        await ctx.pool.query(
          `INSERT INTO listings (id, skin_id, price_cents, float_value, source)
           VALUES ($1, $2, $3, $4, 'csfloat')`,
          [listingId, "skin-classified-1", opts.listingPriceCents + i, opts.listingFloat + i * 0.001],
        );
      }
      await ctx.pool.query(
        `INSERT INTO trade_up_inputs (
           trade_up_id, listing_id, skin_id, skin_name, collection_name,
           price_cents, float_value, condition, source
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          PREFERRED_EXAMPLE_TRADE_UP_ID,
          listingId,
          "skin-classified-1",
          "AK-47 | Test Skin",
          "Test Collection Alpha",
          opts.snapshotPriceCents,
          opts.snapshotFloat,
          "Field-Tested",
          "csfloat",
        ],
      );
    }
  }

  it("returns current listings for the preferred contract without baking snapshot numbers", async () => {
    await insertPreferredContract({
      listingPriceCents: 4321,
      snapshotPriceCents: 111,
      listingFloat: 0.2222,
      snapshotFloat: 0.0101,
    });

    const res = await request(ctx.app).get("/api/calculator/example");
    expect(res.status).toBe(200);
    expect(res.body.label).toBe("example");
    expect(res.body.trade_up_id).toBe(PREFERRED_EXAMPLE_TRADE_UP_ID);
    expect(res.body.used_fallback).toBe(false);
    expect(res.body.inputs).toHaveLength(10);
    expect(res.body.inputs[0].skinName).toBe("AK-47 | Test Skin");
    expect(res.body.inputs[0].priceCents).toBe("4321");
    expect(Number(res.body.inputs[0].floatValue)).toBeCloseTo(0.2222, 4);
    expect(res.body.inputs[0].resolved.rarity).toBe("Classified");
    expect(res.body.profit_cents).toBeUndefined();
    expect(res.body.roi_percentage).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("888888");
    expect(JSON.stringify(res.body)).not.toContain("0.0101");
    expect(res.body.inputs.some((slot: { priceCents: string }) => slot.priceCents === "111")).toBe(false);
    expect(JSON.stringify(res.body).toLowerCase()).not.toMatch(/guaranteed|we ran this/);
  });

  it("falls back to the cheapest named Classified row when the preferred id is dead", async () => {
    const cheapest = await ctx.pool.query(
      `SELECT id, total_cost_cents FROM trade_ups
       WHERE type = 'classified_covert' AND listing_status = 'active'
       ORDER BY total_cost_cents ASC, id ASC LIMIT 1`,
    );

    const res = await request(ctx.app).get("/api/calculator/example");
    expect(res.status).toBe(200);
    expect(res.body.used_fallback).toBe(true);
    expect(res.body.trade_up_id).toBe(cheapest.rows[0].id);
    expect(res.body.inputs).toHaveLength(10);
    expect(res.body.inputs.every((slot: { skinName: string }) => slot.skinName.length > 0)).toBe(true);
  });

  it("treats a preferred id with no current listings as dead", async () => {
    await insertPreferredContract({
      listingPriceCents: 5000,
      snapshotPriceCents: 5000,
      listingFloat: 0.2,
      snapshotFloat: 0.2,
      keepListings: false,
    });

    const cheapest = await ctx.pool.query(
      `SELECT id FROM trade_ups
       WHERE type = 'classified_covert' AND listing_status = 'active' AND id <> $1
       ORDER BY total_cost_cents ASC, id ASC LIMIT 1`,
      [PREFERRED_EXAMPLE_TRADE_UP_ID],
    );

    const res = await request(ctx.app).get("/api/calculator/example");
    expect(res.status).toBe(200);
    expect(res.body.used_fallback).toBe(true);
    expect(res.body.trade_up_id).toBe(cheapest.rows[0].id);
  });
});
