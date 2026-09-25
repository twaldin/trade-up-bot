import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestContext } from "./setup.js";
import { purgeExpiredPreserved } from "../../server/engine.js";
import { runReviveDMarketRelists } from "../../scripts/revive-dmarket-relists.js";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestApp();
  await ctx.pool.query(
    `INSERT INTO skins (id, name, weapon, rarity)
     VALUES ('skin-hold', 'MP7 | Abyssal Apparition', 'MP7', 'Classified')`,
  );
  await ctx.pool.query(`
    CREATE TABLE trade_up_relist_hold (
      trade_up_id INTEGER PRIMARY KEY,
      flagged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
});

afterAll(async () => {
  await ctx.cleanup();
});

describe("relist hold", () => {
  it("an expired hold does not block purge", async () => {
    const { rows } = await ctx.pool.query(
      `INSERT INTO trade_ups (
         total_cost_cents, expected_value_cents, profit_cents, roi_percentage,
         chance_to_profit, best_case_cents, worst_case_cents, listing_status, preserved_at, outcomes_json
       ) VALUES (500, 1000, 500, 10, 0.5, 100, -50, 'partial', NOW() - INTERVAL '3 days', '[]')
       RETURNING id`,
    );
    const tradeUpId = Number(rows[0].id);
    await ctx.pool.query(
      `INSERT INTO trade_up_relist_hold (trade_up_id, flagged_at) VALUES ($1, NOW() - INTERVAL '49 hours')`,
      [tradeUpId],
    );

    await purgeExpiredPreserved(ctx.pool, 2);

    const { rows: left } = await ctx.pool.query(`SELECT id FROM trade_ups WHERE id = $1`, [tradeUpId]);
    expect(left).toHaveLength(0);
  });

  it("unrestored rows have no hold after apply", async () => {
    await ctx.pool.query(
      `INSERT INTO listings (id, skin_id, price_cents, float_value, paint_seed, source, claimed_by)
       VALUES ('dmarket:claimed-relist', 'skin-hold', 538, 0.1523456789, 412, 'dmarket', 'buyer')`,
    );
    const { rows } = await ctx.pool.query(
      `INSERT INTO trade_ups (
         total_cost_cents, expected_value_cents, profit_cents, roi_percentage,
         chance_to_profit, best_case_cents, worst_case_cents, listing_status, preserved_at, outcomes_json
       ) VALUES (554, 2000, 1446, 10, 0.5, 100, -50, 'partial', NOW(), '[]')
       RETURNING id`,
    );
    const tradeUpId = Number(rows[0].id);
    await ctx.pool.query(
      `INSERT INTO trade_up_inputs (
         trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source
       ) VALUES ($1, 'dmarket:missing-old', 'skin-hold', 'MP7 | Abyssal Apparition', 'Test', 554, 0.1523456789, 'Minimal Wear', 'dmarket')`,
      [tradeUpId],
    );

    await runReviveDMarketRelists(ctx.pool, { dryRun: false, hold: false, hours: 36 });

    const { rows: holds } = await ctx.pool.query(
      `SELECT trade_up_id FROM trade_up_relist_hold WHERE trade_up_id = $1`,
      [tradeUpId],
    );
    expect(holds).toHaveLength(0);
    const { rows: status } = await ctx.pool.query(
      `SELECT listing_status FROM trade_ups WHERE id = $1`,
      [tradeUpId],
    );
    expect(status[0].listing_status).toBe("partial");
  });
});
