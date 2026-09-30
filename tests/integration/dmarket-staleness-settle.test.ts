import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestContext } from "./setup.js";
import { settleDMarketRelinkPlan } from "../../server/sync/dmarket.js";
import { planDMarketRelinks, referencePricesAllowDeletes, type DMarketRelistSide } from "../../server/dmarket-fetcher-relist.js";
import { resetInputReferenceCache } from "../../server/engine.js";
import { refPriceCache } from "../../server/engine/pricing.js";
import { repricedInputCost } from "../../server/engine.js";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestApp();
  await ctx.pool.query(
    `INSERT INTO skins (id, name, weapon, rarity) VALUES ('skin-stale', 'MP7 | Abyssal Apparition', 'MP7', 'Classified')`,
  );
});

afterAll(async () => {
  await ctx.cleanup();
});

function side(id: string, floatValue = 0.15): DMarketRelistSide {
  return {
    id,
    skinName: "MP7 | Abyssal Apparition",
    floatValue,
    paintSeed: 412,
    assetId: null,
    priceCents: 500,
  };
}

async function seed(listingId: string, floatValue = 0.15): Promise<number> {
  await ctx.pool.query(
    `INSERT INTO listings (id, skin_id, price_cents, float_value, paint_seed, source)
     VALUES ($1, 'skin-stale', 500, $2, 412, 'dmarket')`,
    [listingId, floatValue],
  );
  const { rows } = await ctx.pool.query(
    `INSERT INTO trade_ups (
       total_cost_cents, expected_value_cents, profit_cents, roi_percentage,
       chance_to_profit, best_case_cents, worst_case_cents, outcomes_json, listing_status, type
     ) VALUES (500, 1000, 500, 1, 0.5, 100, -50, '[]', 'active', 'staleness_settle')
     RETURNING id`,
  );
  const tradeUpId = Number(rows[0].id);
  const keeper = `csfloat:keep-${listingId}`;
  await ctx.pool.query(
    `INSERT INTO listings (id, skin_id, price_cents, float_value, source)
     VALUES ($1, 'skin-stale', 100, 0.1, 'csfloat')`,
    [keeper],
  );
  await ctx.pool.query(
    `INSERT INTO trade_up_inputs (
       trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source
     ) VALUES
       ($1, $2, 'skin-stale', 'MP7 | Abyssal Apparition', 'Test', $3, $4, 'Field-Tested', 'dmarket'),
       ($1, $5, 'skin-stale', 'MP7 | Abyssal Apparition', 'Test', 100, 0.1, 'Factory New', 'csfloat')`,
    [tradeUpId, listingId, repricedInputCost(500, "dmarket"), floatValue, keeper],
  );
  return tradeUpId;
}

describe("DMarket staleness settle", () => {
  it("relinks the input onto the live offer", async () => {
    const tradeUpId = await seed("dmarket:stale-old");
    await ctx.pool.query(
      `INSERT INTO listings (id, skin_id, price_cents, float_value, paint_seed, source)
       VALUES ('dmarket:stale-new', 'skin-stale', 480, 0.15, 412, 'dmarket')`,
    );
    const plan = planDMarketRelinks([side("dmarket:stale-old")], [side("dmarket:stale-new")]);
    const settled = await settleDMarketRelinkPlan(ctx.pool, plan, true);
    expect(settled.relinked).toBe(1);
    expect(settled.deleted).toBe(0);
    const { rows } = await ctx.pool.query(
      `SELECT tui.listing_id, tu.listing_status
       FROM trade_up_inputs tui JOIN trade_ups tu ON tu.id = tui.trade_up_id
       WHERE tu.id = $1
       ORDER BY tui.listing_id`,
      [tradeUpId],
    );
    expect(rows.map(row => row.listing_id)).toEqual(["csfloat:keep-dmarket:stale-old", "dmarket:stale-new"]);
    expect(rows.every(row => row.listing_status === "active")).toBe(true);
  });

  it("deletes both sides of a contested offer and marks the trade-up partial", async () => {
    const tradeUpId = await seed("dmarket:contest-a", 0.21);
    await ctx.pool.query(
      `INSERT INTO listings (id, skin_id, price_cents, float_value, paint_seed, source)
       VALUES ('dmarket:contest-b', 'skin-stale', 500, 0.21, 412, 'dmarket')`,
    );
    const plan = planDMarketRelinks(
      [side("dmarket:contest-a", 0.21), side("dmarket:contest-b", 0.21)],
      [side("dmarket:contest-new", 0.21)],
    );
    expect(plan.relinks).toEqual([]);
    expect(plan.contested).toBeGreaterThan(0);
    const settled = await settleDMarketRelinkPlan(ctx.pool, plan, true);
    expect(settled.deleted).toBe(2);
    expect(settled.contested).toBe(plan.contested);
    const { rows } = await ctx.pool.query(
      `SELECT listing_status FROM trade_ups WHERE id = $1`,
      [tradeUpId],
    );
    expect(rows[0].listing_status).toBe("partial");
  });

  it("deletes an unmatched listing and marks the trade-up partial", async () => {
    const tradeUpId = await seed("dmarket:plain-delete", 0.33);
    const plan = planDMarketRelinks([side("dmarket:plain-delete", 0.33)], []);
    const settled = await settleDMarketRelinkPlan(ctx.pool, plan, true);
    expect(settled.deleted).toBe(1);
    expect(settled.relinked).toBe(0);
    const { rows } = await ctx.pool.query(
      `SELECT listing_status FROM trade_ups WHERE id = $1`,
      [tradeUpId],
    );
    expect(rows[0].listing_status).toBe("partial");
  });

  it("skips deletes when the reference-price load fails", async () => {
    const tradeUpId = await seed("dmarket:ref-fail", 0.44);
    refPriceCache.clear();
    resetInputReferenceCache();
    await ctx.pool.query(`ALTER TABLE price_data RENAME TO price_data_hidden`);
    try {
      const allow = await referencePricesAllowDeletes(ctx.pool);
      expect(allow).toBe(false);
      const plan = planDMarketRelinks([side("dmarket:ref-fail", 0.44)], []);
      const settled = await settleDMarketRelinkPlan(ctx.pool, plan, allow);
      expect(settled.deleted).toBe(0);
      const { rows: listing } = await ctx.pool.query(
        `SELECT id FROM listings WHERE id = 'dmarket:ref-fail'`,
      );
      expect(listing).toHaveLength(1);
      const { rows: status } = await ctx.pool.query(
        `SELECT listing_status FROM trade_ups WHERE id = $1`,
        [tradeUpId],
      );
      expect(status[0].listing_status).toBe("active");
    } finally {
      await ctx.pool.query(`ALTER TABLE price_data_hidden RENAME TO price_data`);
      refPriceCache.clear();
      resetInputReferenceCache();
    }
  });
});
