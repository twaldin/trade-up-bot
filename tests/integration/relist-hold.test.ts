import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestContext } from "./setup.js";
import { purgeExpiredPreserved } from "../../server/engine.js";
import { ensureAppliedTable, planDMarketRelistRevive, runReviveDMarketRelists } from "../../scripts/revive-dmarket-relists.js";

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

async function appliedPrimaryKey(): Promise<string | null> {
  const { rows } = await ctx.pool.query<{ cols: string | null }>(`
    SELECT string_agg(a.attname, ',' ORDER BY k.ord) AS cols
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
    WHERE t.relname = 'trade_up_relist_applied' AND c.contype = 'p'
      AND t.relnamespace = current_schema()::regnamespace
  `);
  return rows[0]?.cols ?? null;
}

async function appliedPrimaryKeyOid(): Promise<string | null> {
  const { rows } = await ctx.pool.query<{ oid: string | null }>(`
    SELECT c.oid::text AS oid
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'trade_up_relist_applied' AND c.contype = 'p'
      AND t.relnamespace = current_schema()::regnamespace
  `);
  return rows[0]?.oid ?? null;
}

describe("relist applied table", () => {
  it("creates a fresh table, migrates the old key once, and leaves the new key alone", async () => {
    await ctx.pool.query(`DROP TABLE IF EXISTS trade_up_relist_applied`);
    await ensureAppliedTable(ctx.pool);
    expect(await appliedPrimaryKey()).toBe("trade_up_id,run_id");
    const freshOid = await appliedPrimaryKeyOid();
    await ensureAppliedTable(ctx.pool);
    expect(await appliedPrimaryKeyOid()).toBe(freshOid);

    await ctx.pool.query(`DROP TABLE trade_up_relist_applied`);
    await ctx.pool.query(`
      CREATE TABLE trade_up_relist_applied (
        trade_up_id INTEGER PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        run_id TEXT NOT NULL
      )
    `);
    await ctx.pool.query(
      `INSERT INTO trade_up_relist_applied (trade_up_id, run_id) VALUES (11, 'run-a'), (12, 'run-b')`,
    );
    await ensureAppliedTable(ctx.pool);
    expect(await appliedPrimaryKey()).toBe("trade_up_id,run_id");
    const { rows: kept } = await ctx.pool.query(
      `SELECT trade_up_id, run_id FROM trade_up_relist_applied ORDER BY trade_up_id`,
    );
    expect(kept).toEqual([
      { trade_up_id: 11, run_id: "run-a" },
      { trade_up_id: 12, run_id: "run-b" },
    ]);
    const migratedOid = await appliedPrimaryKeyOid();
    await ensureAppliedTable(ctx.pool);
    expect(await appliedPrimaryKey()).toBe("trade_up_id,run_id");
    expect(await appliedPrimaryKeyOid()).toBe(migratedOid);
    const { rows: still } = await ctx.pool.query(
      `SELECT trade_up_id, run_id FROM trade_up_relist_applied ORDER BY trade_up_id`,
    );
    expect(still).toEqual(kept);
  });
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

  it("skips a plan whose post-repoint inputs duplicate an existing trade-up", async () => {
    await ctx.pool.query(
      `INSERT INTO listings (id, skin_id, price_cents, float_value, paint_seed, source) VALUES
         ('dmarket:dup-keep', 'skin-hold', 400, 0.2, 9, 'dmarket'),
         ('dmarket:dup-new', 'skin-hold', 538, 0.1811111111, 77, 'dmarket')`,
    );
    const insertTu = async (status: string, listingIds: string[]) => {
      const { rows } = await ctx.pool.query(
        `INSERT INTO trade_ups (
           total_cost_cents, expected_value_cents, profit_cents, roi_percentage,
           chance_to_profit, best_case_cents, worst_case_cents, listing_status, preserved_at, outcomes_json, trade_up_score
         ) VALUES (900, 2000, 1100, 10, 0.5, 100, -50, $1, NOW(), '[]', 30)
         RETURNING id`,
        [status],
      );
      const id = Number(rows[0].id);
      for (const listingId of listingIds) {
        await ctx.pool.query(
          `INSERT INTO trade_up_inputs (
             trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source
           ) VALUES ($1, $2, 'skin-hold', 'MP7 | Abyssal Apparition', 'Test', 400, 0.2, 'Field-Tested', 'dmarket')`,
          [id, listingId],
        );
      }
      return id;
    };
    await insertTu("active", ["dmarket:dup-keep", "dmarket:dup-new"]);
    const partialId = await insertTu("partial", ["dmarket:dup-keep", "dmarket:dup-missing"]);
    await ctx.pool.query(
      `UPDATE trade_up_inputs SET float_value = 0.1811111111 WHERE trade_up_id = $1 AND listing_id = 'dmarket:dup-missing'`,
      [partialId],
    );

    const { plans, report } = await planDMarketRelistRevive(ctx.pool, 36);
    expect(report.skipped["dup-existing"]).toBeGreaterThanOrEqual(1);
    expect(plans.some(plan => plan.tradeUpId === partialId)).toBe(false);
  });
});
