import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestContext } from "./setup.js";
import { mergeTradeUps } from "../../server/engine/db-save.js";
import { applyDMarketRelinks, planDMarketRelinks, type DMarketRelistSide } from "../../server/dmarket-fetcher-relist.js";
import { recordDMarketRelink } from "../../server/engine/dmarket-relink-map.js";
import { makeTradeUp } from "../helpers/fixtures.js";
import type { TradeUp } from "../../shared/types.js";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestApp();
  await ctx.pool.query(
    `INSERT INTO skins (id, name, weapon, rarity) VALUES ('skin-save', 'MP7 | Abyssal Apparition', 'MP7', 'Classified')`,
  );
});

afterAll(async () => {
  await ctx.cleanup();
});

function dmTradeUp(listingIds: string[], profit: number): TradeUp {
  const tu = makeTradeUp({ listingIds, profit_cents: profit, total_cost_cents: 5000, expected_value_cents: 5000 + profit });
  tu.inputs = tu.inputs.map(input => ({
    ...input,
    source: input.listing_id.startsWith("dmarket:") ? "dmarket" : "csfloat",
    skin_id: "skin-save",
    skin_name: "MP7 | Abyssal Apparition",
  }));
  tu.profit_cents = profit;
  tu.total_cost_cents = 5000;
  return tu;
}

async function insertListing(id: string, floatValue = 0.15): Promise<void> {
  await ctx.pool.query(
    `INSERT INTO listings (id, skin_id, price_cents, float_value, paint_seed, source)
     VALUES ($1, 'skin-save', 500, $2, 412, $3)`,
    [id, floatValue, id.startsWith("dmarket:") ? "dmarket" : "csfloat"],
  );
}

describe("daemon save after a DMarket relink", () => {
  it("saves the live offer id and keeps the discovered score", async () => {
    await insertListing("dmarket:save-old");
    await insertListing("dmarket:save-new");
    await insertListing("csfloat:save-keep");
    const stored: DMarketRelistSide = {
      id: "dmarket:save-old",
      skinName: "MP7 | Abyssal Apparition",
      floatValue: 0.15,
      paintSeed: 412,
      assetId: null,
      priceCents: 500,
    };
    const incoming: DMarketRelistSide = { ...stored, id: "dmarket:save-new", priceCents: 480 };
    const plan = planDMarketRelinks([stored], [incoming]);
    const applied = await applyDMarketRelinks(ctx.pool, plan.relinks);
    expect(applied.applied).toBe(1);

    const discovered = dmTradeUp(["dmarket:save-old", "csfloat:save-keep"], 4321);
    await mergeTradeUps(ctx.pool, [discovered], "save_relink_race");

    const { rows } = await ctx.pool.query(
      `SELECT t.profit_cents, t.total_cost_cents, t.listing_status, tui.listing_id
       FROM trade_ups t
       JOIN trade_up_inputs tui ON tui.trade_up_id = t.id
       WHERE t.type = 'save_relink_race'
       ORDER BY tui.listing_id`,
    );
    expect(rows.map(row => row.listing_id)).toEqual(["csfloat:save-keep", "dmarket:save-new"]);
    expect(rows[0].profit_cents).toBe(4321);
    expect(rows[0].total_cost_cents).toBe(5000);
    expect(rows[0].listing_status).toBe("active");
    const { rows: status } = await ctx.pool.query(
      `SELECT listing_status FROM trade_ups t
       JOIN trade_up_inputs tui ON tui.trade_up_id = t.id
       WHERE tui.listing_id = 'dmarket:save-old'`,
    );
    expect(status).toHaveLength(0);
  });

  it("skips the trade-up when the DMarket input is gone and was not relinked", async () => {
    await insertListing("csfloat:skip-keep");
    const discovered = dmTradeUp(["dmarket:never-relinked", "csfloat:skip-keep"], 1111);
    await mergeTradeUps(ctx.pool, [discovered], "save_relink_skip");
    const { rows } = await ctx.pool.query(
      `SELECT id FROM trade_ups WHERE type = 'save_relink_skip'`,
    );
    expect(rows).toHaveLength(0);
  });

  it("still lets two trade-ups share one live listing", async () => {
    await insertListing("dmarket:shared");
    await insertListing("csfloat:shared-a");
    await insertListing("csfloat:shared-b");
    await mergeTradeUps(ctx.pool, [
      dmTradeUp(["dmarket:shared", "csfloat:shared-a"], 100),
      dmTradeUp(["dmarket:shared", "csfloat:shared-b"], 200),
    ], "save_relink_share");
    const { rows } = await ctx.pool.query(
      `SELECT t.profit_cents FROM trade_ups t
       JOIN trade_up_inputs tui ON tui.trade_up_id = t.id
       WHERE t.type = 'save_relink_share' AND tui.listing_id = 'dmarket:shared'
       ORDER BY t.profit_cents`,
    );
    expect(rows.map(row => row.profit_cents)).toEqual([100, 200]);
  });

  it("does not retarget onto a claimed listing", async () => {
    await insertListing("dmarket:claim-target");
    await ctx.pool.query(
      `UPDATE listings SET claimed_by = 'buyer', claimed_at = NOW() WHERE id = 'dmarket:claim-target'`,
    );
    await insertListing("csfloat:claim-keep");
    await recordDMarketRelink(ctx.pool, "dmarket:claim-old", "dmarket:claim-target");
    const discovered = dmTradeUp(["dmarket:claim-old", "csfloat:claim-keep"], 3333);
    await mergeTradeUps(ctx.pool, [discovered], "save_relink_claimed");
    const { rows } = await ctx.pool.query(
      `SELECT tui.listing_id, t.listing_status
       FROM trade_ups t
       JOIN trade_up_inputs tui ON tui.trade_up_id = t.id
       WHERE t.type = 'save_relink_claimed'`,
    );
    expect(rows).toHaveLength(0);
  });

  it("skips a trade-up whose inputs would collapse onto one listing", async () => {
    await insertListing("dmarket:collapse-new");
    await recordDMarketRelink(ctx.pool, "dmarket:collapse-a", "dmarket:collapse-new");
    await recordDMarketRelink(ctx.pool, "dmarket:collapse-b", "dmarket:collapse-new");
    const discovered = dmTradeUp(["dmarket:collapse-a", "dmarket:collapse-b"], 7777);
    await mergeTradeUps(ctx.pool, [discovered], "save_relink_collapse");
    const { rows } = await ctx.pool.query(
      `SELECT id FROM trade_ups WHERE type = 'save_relink_collapse'`,
    );
    expect(rows).toHaveLength(0);
  });
});
