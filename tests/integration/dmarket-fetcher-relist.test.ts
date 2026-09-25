import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestContext } from "./setup.js";
import { applyDMarketRelinks, planDMarketRelinks, relinkLogLine, type DMarketRelistSide } from "../../server/dmarket-fetcher-relist.js";
import { cascadeTradeUpStatuses, repricedInputCost } from "../../server/engine.js";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestApp();
  await ctx.pool.query(
    `INSERT INTO skins (id, name, weapon, rarity) VALUES ('skin-mp7', 'MP7 | Abyssal Apparition', 'MP7', 'Classified')`,
  );
});

afterAll(async () => {
  await ctx.cleanup();
});

function side(id: string, priceCents: number, floatValue = 0.1523456789): DMarketRelistSide {
  return {
    id,
    skinName: "MP7 | Abyssal Apparition",
    floatValue,
    paintSeed: 412,
    assetId: null,
    priceCents,
  };
}

async function seedTradeUp(oldId: string, rawPrice: number): Promise<number> {
  await ctx.pool.query(
    `INSERT INTO listings (id, skin_id, price_cents, float_value, paint_seed, source)
     VALUES ($1, 'skin-mp7', $2, 0.1523456789, 412, 'dmarket')`,
    [oldId, rawPrice],
  );
  const { rows } = await ctx.pool.query(
    `INSERT INTO trade_ups (
       total_cost_cents, expected_value_cents, profit_cents, roi_percentage,
       chance_to_profit, best_case_cents, worst_case_cents, outcomes_json, listing_status
     ) VALUES ($1, 2000, $2, 1, 0.5, 500, -100, $3, 'active')
     RETURNING id`,
    [rawPrice, 2000 - rawPrice, JSON.stringify([{ estimated_price_cents: 2000, probability: 1 }])],
  );
  const tradeUpId = Number(rows[0].id);
  await ctx.pool.query(
    `INSERT INTO trade_up_inputs (
       trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source
     ) VALUES ($1, $2, 'skin-mp7', 'MP7 | Abyssal Apparition', 'Test', $3, 0.1523456789, 'Minimal Wear', 'dmarket')`,
    [tradeUpId, oldId, repricedInputCost(rawPrice, "dmarket")],
  );
  return tradeUpId;
}

describe("DMarket fetcher relist reconcile", () => {
  it("applies two relinks at once without a deadlock", async () => {
    await seedTradeUp("dmarket:old-conc-a", 554);
    await seedTradeUp("dmarket:old-conc-b", 600);
    await ctx.pool.query(
      `INSERT INTO listings (id, skin_id, price_cents, float_value, paint_seed, source)
       VALUES ('dmarket:new-conc-a', 'skin-mp7', 538, 0.1523456789, 412, 'dmarket'),
              ('dmarket:new-conc-b', 'skin-mp7', 580, 0.1523456789, 412, 'dmarket')`,
    );
    const [left, right] = await Promise.all([
      applyDMarketRelinks(ctx.pool, [{ oldId: "dmarket:old-conc-a", newId: "dmarket:new-conc-a", priceCents: 538 }]),
      applyDMarketRelinks(ctx.pool, [{ oldId: "dmarket:old-conc-b", newId: "dmarket:new-conc-b", priceCents: 580 }]),
    ]);
    expect(left.failedIds).toEqual([]);
    expect(right.failedIds).toEqual([]);
    expect(left.applied).toBe(1);
    expect(right.applied).toBe(1);
    const { rows } = await ctx.pool.query(
      `SELECT listing_id FROM trade_up_inputs WHERE listing_id = ANY($1) ORDER BY listing_id`,
      [["dmarket:new-conc-a", "dmarket:new-conc-b"]],
    );
    expect(rows.map(row => row.listing_id)).toEqual(["dmarket:new-conc-a", "dmarket:new-conc-b"]);
  });

  it("repoints a relist and leaves the trade-up active", async () => {
    const tradeUpId = await seedTradeUp("dmarket:old-match", 554);
    await ctx.pool.query(
      `INSERT INTO listings (id, skin_id, price_cents, float_value, paint_seed, source)
       VALUES ('dmarket:new-match', 'skin-mp7', 538, 0.1523456789, 412, 'dmarket')`,
    );
    const plan = planDMarketRelinks(
      [side("dmarket:old-match", 554)],
      [side("dmarket:new-match", 538)],
    );
    expect(plan.deleteIds).toEqual([]);
    await applyDMarketRelinks(ctx.pool, plan.relinks);

    const { rows: inputs } = await ctx.pool.query(
      `SELECT listing_id, price_cents, source FROM trade_up_inputs WHERE trade_up_id = $1`,
      [tradeUpId],
    );
    expect(inputs[0].listing_id).toBe("dmarket:new-match");
    expect(inputs[0].price_cents).toBe(repricedInputCost(538, "dmarket"));
    expect(inputs[0].source).toBe("dmarket");
    const { rows: status } = await ctx.pool.query(
      `SELECT listing_status FROM trade_ups WHERE id = $1`,
      [tradeUpId],
    );
    expect(status[0].listing_status).toBe("active");
    const { rows: oldListing } = await ctx.pool.query(`SELECT id FROM listings WHERE id = 'dmarket:old-match'`);
    expect(oldListing).toHaveLength(0);
  });

  it("writes the new raw price through the reprice path when the relist is cheaper", async () => {
    const tradeUpId = await seedTradeUp("dmarket:old-price", 1000);
    await ctx.pool.query(
      `INSERT INTO listings (id, skin_id, price_cents, float_value, paint_seed, source)
       VALUES ('dmarket:new-price', 'skin-mp7', 700, 0.1523456789, 412, 'dmarket')`,
    );
    const plan = planDMarketRelinks(
      [side("dmarket:old-price", 1000)],
      [side("dmarket:new-price", 700)],
    );
    await applyDMarketRelinks(ctx.pool, plan.relinks);
    const { rows } = await ctx.pool.query(
      `SELECT tui.price_cents, tu.total_cost_cents, tu.listing_status
       FROM trade_up_inputs tui JOIN trade_ups tu ON tu.id = tui.trade_up_id
       WHERE tui.trade_up_id = $1`,
      [tradeUpId],
    );
    const expected = repricedInputCost(700, "dmarket");
    expect(rows[0].price_cents).toBe(expected);
    expect(rows[0].total_cost_cents).toBe(expected);
    expect(rows[0].listing_status).toBe("active");
  });

  it("deletes and cascades when nothing matches", async () => {
    const tradeUpId = await seedTradeUp("dmarket:gone", 554);
    await ctx.pool.query(
      `INSERT INTO listings (id, skin_id, price_cents, float_value, paint_seed, source)
       VALUES ('dmarket:keeper', 'skin-mp7', 400, 0.2, 9, 'dmarket')`,
    );
    await ctx.pool.query(
      `INSERT INTO trade_up_inputs (
         trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source
       ) VALUES ($1, 'dmarket:keeper', 'skin-mp7', 'MP7 | Abyssal Apparition', 'Test', 400, 0.2, 'Field-Tested', 'dmarket')`,
      [tradeUpId],
    );
    const plan = planDMarketRelinks(
      [side("dmarket:gone", 554)],
      [side("dmarket:unrelated", 100, 0.01)],
    );
    expect(plan.relinks).toEqual([]);
    expect(plan.deleteIds).toEqual(["dmarket:gone"]);
    await ctx.pool.query(`DELETE FROM listings WHERE id = ANY($1)`, [plan.deleteIds]);
    await cascadeTradeUpStatuses(ctx.pool, plan.deleteIds);
    const { rows } = await ctx.pool.query(
      `SELECT listing_status FROM trade_ups WHERE id = $1`,
      [tradeUpId],
    );
    expect(rows[0].listing_status).toBe("partial");
  });

  it("rolls back the repoint when deleting the old listing fails", async () => {
    const tradeUpId = await seedTradeUp("dmarket:old-rollback", 554);
    await ctx.pool.query(
      `INSERT INTO listings (id, skin_id, price_cents, float_value, paint_seed, source)
       VALUES ('dmarket:new-rollback', 'skin-mp7', 538, 0.1523456789, 412, 'dmarket')`,
    );
    await ctx.pool.query(`
      CREATE FUNCTION fail_relist_delete() RETURNS trigger AS $$
      BEGIN
        IF OLD.id = 'dmarket:old-rollback' THEN
          RAISE EXCEPTION 'forced rollback';
        END IF;
        RETURN OLD;
      END;
      $$ LANGUAGE plpgsql
    `);
    await ctx.pool.query(`
      CREATE TRIGGER fail_relist_delete_trg
      BEFORE DELETE ON listings
      FOR EACH ROW EXECUTE FUNCTION fail_relist_delete()
    `);
    const result = await applyDMarketRelinks(ctx.pool, [{
      oldId: "dmarket:old-rollback",
      newId: "dmarket:new-rollback",
      priceCents: 538,
    }]);
    expect(result).toEqual({
      applied: 0,
      failedIds: ["dmarket:old-rollback"],
      skipped: [],
      referenceLoadFailed: false,
    });
    const { rows } = await ctx.pool.query(
      `SELECT listing_id FROM trade_up_inputs WHERE trade_up_id = $1`,
      [tradeUpId],
    );
    expect(rows[0].listing_id).toBe("dmarket:old-rollback");
    const { rows: oldListing } = await ctx.pool.query(
      `SELECT id FROM listings WHERE id = 'dmarket:old-rollback'`,
    );
    expect(oldListing).toHaveLength(1);
    await ctx.pool.query(`DROP TRIGGER fail_relist_delete_trg ON listings`);
  });

  it("does not relink onto a listing that is already a trade-up input", async () => {
    const oldId = await seedTradeUp("dmarket:old-used", 554);
    const keptId = await seedTradeUp("dmarket:au-new", 538);
    await ctx.pool.query(
      `INSERT INTO listings (id, skin_id, price_cents, float_value, paint_seed, source)
       VALUES ('dmarket:keeper-used', 'skin-mp7', 400, 0.2, 9, 'dmarket')`,
    );
    await ctx.pool.query(
      `INSERT INTO trade_up_inputs (
         trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source
       ) VALUES ($1, 'dmarket:keeper-used', 'skin-mp7', 'MP7 | Abyssal Apparition', 'Test', 400, 0.2, 'Field-Tested', 'dmarket')`,
      [oldId],
    );
    const plan = planDMarketRelinks(
      [side("dmarket:old-used", 554)],
      [side("dmarket:au-new", 538)],
    );
    const result = await applyDMarketRelinks(ctx.pool, plan.relinks);
    expect(result.applied).toBe(0);
    expect(result.skipped).toEqual([{ oldId: "dmarket:old-used", reason: "new_id_already_input" }]);
    expect(relinkLogLine("MP7 | Abyssal Apparition", plan, result)).toBe(
      "  MP7 | Abyssal Apparition: relinked 0 deleted 1 contested 1 failed 0 (new_id_already_input)",
    );
    const { rows: stillOld } = await ctx.pool.query(
      `SELECT listing_id FROM trade_up_inputs WHERE trade_up_id = $1 AND listing_id = 'dmarket:old-used'`,
      [oldId],
    );
    expect(stillOld).toHaveLength(1);
    await ctx.pool.query(`DELETE FROM listings WHERE id = $1`, ["dmarket:old-used"]);
    await cascadeTradeUpStatuses(ctx.pool, ["dmarket:old-used"]);
    const { rows: oldStatus } = await ctx.pool.query(
      `SELECT listing_status FROM trade_ups WHERE id = $1`,
      [oldId],
    );
    expect(oldStatus[0].listing_status).toBe("partial");
    const { rows: kept } = await ctx.pool.query(
      `SELECT listing_id FROM trade_up_inputs WHERE trade_up_id = $1`,
      [keptId],
    );
    expect(kept).toHaveLength(1);
    expect(kept[0].listing_id).toBe("dmarket:au-new");
    const { rows: keptStatus } = await ctx.pool.query(
      `SELECT listing_status FROM trade_ups WHERE id = $1`,
      [keptId],
    );
    expect(keptStatus[0].listing_status).toBe("active");
  });

  it("does not relink onto a listing claimed by another user", async () => {
    const oldId = await seedTradeUp("dmarket:old-claimed", 554);
    await ctx.pool.query(
      `INSERT INTO listings (id, skin_id, price_cents, float_value, paint_seed, source, claimed_by, claimed_at)
       VALUES ('dmarket:claimed-new', 'skin-mp7', 538, 0.1523456789, 412, 'dmarket', 'other-user', NOW())`,
    );
    await ctx.pool.query(
      `INSERT INTO listings (id, skin_id, price_cents, float_value, paint_seed, source)
       VALUES ('dmarket:keeper-claimed', 'skin-mp7', 400, 0.2, 9, 'dmarket')`,
    );
    await ctx.pool.query(
      `INSERT INTO trade_up_inputs (
         trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source
       ) VALUES ($1, 'dmarket:keeper-claimed', 'skin-mp7', 'MP7 | Abyssal Apparition', 'Test', 400, 0.2, 'Field-Tested', 'dmarket')`,
      [oldId],
    );
    const plan = planDMarketRelinks(
      [side("dmarket:old-claimed", 554)],
      [side("dmarket:claimed-new", 538)],
    );
    const result = await applyDMarketRelinks(ctx.pool, plan.relinks);
    expect(result.applied).toBe(0);
    expect(result.skipped).toEqual([{ oldId: "dmarket:old-claimed", reason: "claimed_target" }]);
    expect(relinkLogLine("MP7 | Abyssal Apparition", plan, result)).toBe(
      "  MP7 | Abyssal Apparition: relinked 0 deleted 1 contested 1 failed 0 (claimed_target)",
    );
    const { rows: stillOld } = await ctx.pool.query(
      `SELECT listing_id FROM trade_up_inputs WHERE trade_up_id = $1`,
      [oldId],
    );
    expect(stillOld[0].listing_id).toBe("dmarket:old-claimed");
    await ctx.pool.query(`DELETE FROM listings WHERE id = $1`, ["dmarket:old-claimed"]);
    await cascadeTradeUpStatuses(ctx.pool, ["dmarket:old-claimed"]);
    const { rows: status } = await ctx.pool.query(
      `SELECT listing_status FROM trade_ups WHERE id = $1`,
      [oldId],
    );
    expect(status[0].listing_status).toBe("partial");
    const { rows: claim } = await ctx.pool.query(
      `SELECT claimed_by FROM listings WHERE id = 'dmarket:claimed-new'`,
    );
    expect(claim[0].claimed_by).toBe("other-user");
  });
});
