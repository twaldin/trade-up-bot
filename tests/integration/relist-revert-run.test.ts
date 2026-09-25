import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestContext } from "./setup.js";
import { relistRevertSql } from "../../scripts/revive-dmarket-relists.js";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestApp();
  await ctx.pool.query(
    `INSERT INTO skins (id, name, weapon, rarity) VALUES ('skin-revert', 'MP7 | Abyssal Apparition', 'MP7', 'Classified')`,
  );
});

afterAll(async () => {
  await ctx.cleanup();
});

describe("relist revert by run_id", () => {
  it("restores only the selected run", async () => {
    async function tradeUp(listingId: string, profit: number): Promise<number> {
      const { rows } = await ctx.pool.query(
        `INSERT INTO trade_ups (
           total_cost_cents, expected_value_cents, profit_cents, roi_percentage,
           chance_to_profit, best_case_cents, worst_case_cents, outcomes_json, listing_status
         ) VALUES ($1, 2000, $2, 1, 0.5, 100, -50, '[]', 'partial')
         RETURNING id`,
        [1000, profit],
      );
      const id = Number(rows[0].id);
      await ctx.pool.query(
        `INSERT INTO trade_up_inputs (
           trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source
         ) VALUES ($1, $2, 'skin-revert', 'MP7 | Abyssal Apparition', 'Test', 1000, 0.15, 'Field-Tested', 'dmarket')`,
        [id, listingId],
      );
      return id;
    }

    const runA = await tradeUp("dmarket:before-a", 10);
    const runB = await tradeUp("dmarket:before-b", 20);
    await ctx.pool.query(`CREATE TABLE trade_ups_bak_relist_20260925 AS SELECT * FROM trade_ups WHERE id = ANY($1)`, [[runA, runB]]);
    await ctx.pool.query(`CREATE TABLE trade_up_inputs_bak_relist_20260925 AS SELECT * FROM trade_up_inputs WHERE trade_up_id = ANY($1)`, [[runA, runB]]);
    await ctx.pool.query(
      `UPDATE trade_up_inputs SET listing_id = 'dmarket:after-a', price_cents = 50 WHERE trade_up_id = $1`,
      [runA],
    );
    await ctx.pool.query(
      `UPDATE trade_up_inputs SET listing_id = 'dmarket:after-b', price_cents = 60 WHERE trade_up_id = $1`,
      [runB],
    );
    await ctx.pool.query(`UPDATE trade_ups SET profit_cents = 999 WHERE id = ANY($1)`, [[runA, runB]]);
    await ctx.pool.query(`
      CREATE TABLE trade_up_relist_applied (
        trade_up_id INTEGER NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        run_id TEXT NOT NULL,
        PRIMARY KEY (trade_up_id, run_id)
      )
    `);
    await ctx.pool.query(
      `INSERT INTO trade_up_relist_applied (trade_up_id, run_id) VALUES ($1, 'run-a'), ($2, 'run-b')`,
      [runA, runB],
    );

    const sql = relistRevertSql("20260925", "run-a");
    for (const statement of sql.split(";").map(part => part.trim()).filter(Boolean)) {
      if (statement === "BEGIN" || statement === "COMMIT") continue;
      await ctx.pool.query(statement);
    }

    const { rows: a } = await ctx.pool.query(
      `SELECT listing_id, price_cents FROM trade_up_inputs WHERE trade_up_id = $1`,
      [runA],
    );
    const { rows: b } = await ctx.pool.query(
      `SELECT listing_id, price_cents FROM trade_up_inputs WHERE trade_up_id = $1`,
      [runB],
    );
    expect(a[0]).toMatchObject({ listing_id: "dmarket:before-a", price_cents: 1000 });
    expect(b[0]).toMatchObject({ listing_id: "dmarket:after-b", price_cents: 60 });
    const { rows: profits } = await ctx.pool.query(
      `SELECT id, profit_cents FROM trade_ups WHERE id = ANY($1) ORDER BY id`,
      [[runA, runB]],
    );
    const byId = new Map(profits.map(row => [Number(row.id), Number(row.profit_cents)]));
    expect(byId.get(runA)).toBe(10);
    expect(byId.get(runB)).toBe(999);
  });
});