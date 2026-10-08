/**
 * DMarket relink vs daemon lock order.
 * The pre-fix pattern (listing lock held across cost recompute, trade_ups locked
 * in the opposite order from Phase 4c / revive) deadlocks. The shortened
 * relink transaction plus ascending id locks completes.
 */

import fs from "fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestApp, type TestContext } from "./setup.js";
import {
  applyDMarketRelinks,
} from "../../server/dmarket-fetcher-relist.js";
import {
  applyListingPriceToInputs,
  drainDMarketRelinkRecomputes,
  ensureInputReferences,
  repricedInputCost,
  reviveStaleGunTradeUps,
  touchTradeUpOutputs,
} from "../../server/engine.js";
import { resetInputReferenceCache } from "../../server/engine/input-outlier.js";

vi.mock("../../server/engine/pricing.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/engine/pricing.js")>();
  return {
    ...actual,
    lookupOutputPrice: async () => ({ priceCents: 50_000, marketplace: "csfloat", grossPrice: 51_000, feePct: 0.02 }),
  };
});

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestApp();
  resetInputReferenceCache();
});

afterAll(async () => {
  await ctx.cleanup();
});

function errorCode(err: unknown): string {
  if (typeof err !== "object" || err === null || !("code" in err)) return "";
  return typeof err.code === "string" ? err.code : "";
}

async function seedPair(prefix: string): Promise<{ low: number; high: number; listingId: string }> {
  const skinId = `skin-${prefix}`;
  const listingId = `dmarket:${prefix}`;
  await ctx.pool.query(
    `INSERT INTO skins (id, name, weapon, rarity) VALUES ($1, $2, 'AWP', 'Classified')`,
    [skinId, `AWP | ${prefix}`],
  );
  await ctx.pool.query(
    `INSERT INTO listings (id, skin_id, price_cents, float_value, paint_seed, source)
     VALUES ($1, $2, 1000, 0.12, 1, 'dmarket')`,
    [listingId, skinId],
  );
  const ids: number[] = [];
  for (let i = 0; i < 2; i++) {
    const { rows } = await ctx.pool.query<{ id: number }>(
      `INSERT INTO trade_ups (
         total_cost_cents, expected_value_cents, profit_cents, roi_percentage,
         chance_to_profit, best_case_cents, worst_case_cents, outcomes_json, listing_status
       ) VALUES (1025, 8000, 6975, 1, 0.5, 100, -100, $1, 'active')
       RETURNING id`,
      [JSON.stringify([{ estimated_price_cents: 8000, probability: 1 }])],
    );
    const id = Number(rows[0].id);
    ids.push(id);
    await ctx.pool.query(
      `INSERT INTO trade_up_inputs (
         trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source
       ) VALUES ($1, $2, $3, $4, 'Test', 1025, 0.12, 'Minimal Wear', 'dmarket')`,
      [id, listingId, skinId, `AWP | ${prefix}`],
    );
  }
  ids.sort((a, b) => a - b);
  return { low: ids[0], high: ids[1], listingId };
}

async function seedRelinkSet(opts: {
  prefix: string;
  count: number;
  raw: number;
  evBase?: number;
}): Promise<{ oldId: string; ids: number[] }> {
  const skinId = `skin-${opts.prefix}`;
  const oldId = `dmarket:${opts.prefix}-old`;
  const name = `AWP | ${opts.prefix}`;
  const dmFee = repricedInputCost(opts.raw, "dmarket");
  const otherFee = repricedInputCost(400, "csfloat");
  const cost = dmFee + otherFee;
  const evBase = opts.evBase ?? 8000;
  await ctx.pool.query(
    `INSERT INTO skins (id, name, weapon, rarity, min_float, max_float)
     VALUES ($1, $2, 'AWP', 'Classified', 0, 1)`,
    [skinId, name],
  );
  await ctx.pool.query(
    `INSERT INTO listings (id, skin_id, price_cents, float_value, paint_seed, source)
     VALUES ($1, $2, $3, 0.12, 7, 'dmarket')`,
    [oldId, skinId, opts.raw],
  );
  await ctx.pool.query(
    `INSERT INTO listings (id, skin_id, price_cents, float_value, source)
     SELECT 'csfloat:' || $1 || '-' || g::text, $2, 400, 0.2, 'csfloat'
     FROM generate_series(1, $3) g`,
    [opts.prefix, skinId, opts.count],
  );
  await ctx.pool.query(
    `WITH tus AS (
       INSERT INTO trade_ups (
         total_cost_cents, expected_value_cents, profit_cents, roi_percentage,
         chance_to_profit, best_case_cents, worst_case_cents, outcomes_json, listing_status
       )
       SELECT $1, $2 + g, ($2 + g) - $1, 1, 0.5, 100, -100, $3, 'active'
       FROM generate_series(1, $4) g
       RETURNING id
     ),
     numbered AS (
       SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS n FROM tus
     )
     INSERT INTO trade_up_inputs (
       trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source
     )
     SELECT id, $5, $6, $7, 'Parity', $8::int, 0.12, 'Minimal Wear', 'dmarket' FROM numbered
     UNION ALL
     SELECT id, 'csfloat:' || $9 || '-' || n::text, $6, $7, 'Parity', $10::int, 0.2, 'Field-Tested', 'csfloat' FROM numbered`,
    [
      cost,
      evBase,
      JSON.stringify([{ estimated_price_cents: evBase, probability: 1 }]),
      opts.count,
      oldId,
      skinId,
      name,
      dmFee,
      opts.prefix,
      otherFee,
    ],
  );
  const { rows } = await ctx.pool.query<{ id: number }>(
    `SELECT DISTINCT trade_up_id AS id FROM trade_up_inputs WHERE listing_id = $1 ORDER BY trade_up_id`,
    [oldId],
  );
  return { oldId, ids: rows.map(row => Number(row.id)) };
}

interface CostRow {
  id: number;
  total_cost_cents: number;
  expected_value_cents: number;
  profit_cents: number;
  roi_percentage: number;
  chance_to_profit: number;
  best_case_cents: number;
  worst_case_cents: number;
  trade_up_score: number;
  price_cents: number;
}

async function readCosts(listingId: string): Promise<CostRow[]> {
  const { rows } = await ctx.pool.query<CostRow>(
    `SELECT tu.id, tu.total_cost_cents, tu.expected_value_cents, tu.profit_cents, tu.roi_percentage,
            tu.chance_to_profit, tu.best_case_cents, tu.worst_case_cents, tu.trade_up_score,
            tui.price_cents
     FROM trade_ups tu
     JOIN trade_up_inputs tui ON tui.trade_up_id = tu.id
     WHERE tui.listing_id = $1
     ORDER BY tu.id`,
    [listingId],
  );
  return rows.map(row => ({
    id: Number(row.id),
    total_cost_cents: Number(row.total_cost_cents),
    expected_value_cents: Number(row.expected_value_cents),
    profit_cents: Number(row.profit_cents),
    roi_percentage: Number(row.roi_percentage),
    chance_to_profit: Number(row.chance_to_profit),
    best_case_cents: Number(row.best_case_cents),
    worst_case_cents: Number(row.worst_case_cents),
    trade_up_score: Number(row.trade_up_score),
    price_cents: Number(row.price_cents),
  }));
}

async function waitForTradeUpLockWait(): Promise<void> {
  const start = Date.now();
  for (;;) {
    const { rows } = await ctx.pool.query<{ waiting: string }>(
      `SELECT COUNT(*)::text AS waiting
       FROM pg_stat_activity
       WHERE datname = current_database()
         AND pid <> pg_backend_pid()
         AND wait_event_type = 'Lock'
         AND query LIKE '%trade_ups WHERE id = $1 FOR UPDATE%'`,
    );
    if (Number(rows[0].waiting) > 0) return;
    if (Date.now() - start > 10_000) throw new Error("timed out waiting for a trade_ups lock waiter");
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

describe("DMarket relink lock order", () => {
  it("old relink vs Phase 4c lock order deadlocks", async () => {
    const { low, high, listingId } = await seedPair("dead-4c");
    const relink = await ctx.pool.connect();
    const phase4c = await ctx.pool.connect();
    try {
      await relink.query("BEGIN");
      await phase4c.query("BEGIN");
      await relink.query(`SELECT id FROM listings WHERE id = $1 FOR UPDATE`, [listingId]);
      await relink.query(`SELECT id FROM trade_ups WHERE id = $1 FOR UPDATE`, [high]);
      await phase4c.query(`SELECT id FROM trade_ups WHERE id = $1 FOR UPDATE`, [low]);
      const results = await Promise.allSettled([
        relink.query(`SELECT id FROM trade_ups WHERE id = $1 FOR UPDATE`, [low]),
        phase4c.query(`UPDATE trade_ups SET output_repriced_at = NOW() WHERE id = $1`, [high]),
      ]);
      const codes = results.map(result => result.status === "rejected" ? errorCode(result.reason) : "");
      expect(codes).toContain("40P01");
    } finally {
      await relink.query("ROLLBACK").catch(() => undefined);
      await phase4c.query("ROLLBACK").catch(() => undefined);
      relink.release();
      phase4c.release();
    }
  }, 20_000);

  it("old relink vs revive input-delete order deadlocks", async () => {
    const { low, listingId } = await seedPair("dead-revive");
    const relink = await ctx.pool.connect();
    const revive = await ctx.pool.connect();
    try {
      await relink.query("BEGIN");
      await revive.query("BEGIN");
      await relink.query(
        `SELECT trade_up_id FROM trade_up_inputs WHERE trade_up_id = $1 AND listing_id = $2 FOR UPDATE`,
        [low, listingId],
      );
      await revive.query(`SELECT id FROM trade_ups WHERE id = $1 FOR UPDATE`, [low]);
      const results = await Promise.allSettled([
        relink.query(`SELECT id FROM trade_ups WHERE id = $1 FOR UPDATE`, [low]),
        revive.query(
          `SELECT trade_up_id FROM trade_up_inputs WHERE trade_up_id = $1 AND listing_id = $2 FOR UPDATE`,
          [low, listingId],
        ),
      ]);
      const codes = results.map(result => result.status === "rejected" ? errorCode(result.reason) : "");
      expect(codes).toContain("40P01");
    } finally {
      await relink.query("ROLLBACK").catch(() => undefined);
      await revive.query("ROLLBACK").catch(() => undefined);
      relink.release();
      revive.release();
    }
  }, 20_000);

  it("relink recompute and Phase 4c complete without a deadlock", async () => {
    const { low, high, listingId } = await seedPair("live-4c");
    const newId = "dmarket:live-4c-new";
    await ctx.pool.query(
      `INSERT INTO listings (id, skin_id, price_cents, float_value, paint_seed, source)
       VALUES ($1, 'skin-live-4c', 700, 0.12, 1, 'dmarket')`,
      [newId],
    );

    let releaseTouch!: () => void;
    const touchMayFinish = new Promise<void>(resolve => { releaseTouch = resolve; });
    const touch = touchTradeUpOutputs(ctx.pool, [low, high], {
      afterLockId: async (id) => {
        if (id !== low) return;
        releaseTouch();
        await waitForTradeUpLockWait();
      },
    });
    const relink = (async () => {
      await touchMayFinish;
      return applyDMarketRelinks(ctx.pool, [{ oldId: listingId, newId, priceCents: 700 }]);
    })();
    const [touched, applied] = await Promise.all([touch, relink]);
    expect(touched).toBeUndefined();
    expect(applied.failedIds).toEqual([]);
    expect(applied.deferredIds).toEqual([]);
    expect(applied.applied).toBe(1);
    const costs = await readCosts(newId);
    expect(costs).toHaveLength(2);
    expect(costs.map(row => row.price_cents)).toEqual([
      repricedInputCost(700, "dmarket"),
      repricedInputCost(700, "dmarket"),
    ]);
  }, 30_000);

  it("relink and reviveStaleGeneric complete without a deadlock", async () => {
    const skin = "AK-47 | Relink Revive";
    await ctx.pool.query(
      `INSERT INTO collections (id, name) VALUES ('col-relink-revive', 'Relink Revive')`,
    );
    await ctx.pool.query(
      `INSERT INTO skins (id, name, weapon, rarity, min_float, max_float)
       VALUES ('skin-relink-revive', $1, 'AK-47', 'Classified', 0, 1),
              ('skin-relink-revive-out', 'AK-47 | Relink Revive Out', 'AK-47', 'Covert', 0, 1)`,
      [skin],
    );
    await ctx.pool.query(
      `INSERT INTO skin_collections (skin_id, collection_id) VALUES
         ('skin-relink-revive', 'col-relink-revive'),
         ('skin-relink-revive-out', 'col-relink-revive')`,
    );
    const dmId = "dmarket:revive-old";
    await ctx.pool.query(
      `INSERT INTO listings (id, skin_id, price_cents, float_value, paint_seed, source)
       VALUES ($1, 'skin-relink-revive', 1000, 0.2, 3, 'dmarket'),
              ('dmarket:revive-new', 'skin-relink-revive', 900, 0.2, 3, 'dmarket'),
              ('rev-missing-repl', 'skin-relink-revive', 1100, 0.21, NULL, 'csfloat')`,
      [dmId],
    );
    for (let i = 1; i < 9; i++) {
      await ctx.pool.query(
        `INSERT INTO listings (id, skin_id, price_cents, float_value, source)
         VALUES ($1, 'skin-relink-revive', 1000, 0.2, 'csfloat')`,
        [`rev-keep-${i}`],
      );
    }
    await ctx.pool.query(
      `INSERT INTO listings (id, skin_id, price_cents, float_value, source)
       VALUES ('rev-gone', 'skin-relink-revive', 1000, 0.2, 'csfloat')`,
    );
    const dmFee = repricedInputCost(1000, "dmarket");
    const csFee = repricedInputCost(1000, "csfloat");
    const { rows } = await ctx.pool.query<{ id: number }>(
      `INSERT INTO trade_ups (
         total_cost_cents, expected_value_cents, profit_cents, roi_percentage, type,
         chance_to_profit, best_case_cents, worst_case_cents, outcomes_json, listing_status
       ) VALUES ($1, 50000, 1, 1, 'classified_covert', 0.5, 100, -100, $2, 'stale')
       RETURNING id`,
      [dmFee + csFee * 9, JSON.stringify([{ estimated_price_cents: 50000, probability: 1 }])],
    );
    const tradeUpId = Number(rows[0].id);
    const inputs: { id: string; source: string; price: number }[] = [
      { id: dmId, source: "dmarket", price: dmFee },
      ...Array.from({ length: 8 }, (_, i) => ({ id: `rev-keep-${i + 1}`, source: "csfloat", price: csFee })),
      { id: "rev-gone", source: "csfloat", price: csFee },
    ];
    for (const input of inputs) {
      await ctx.pool.query(
        `INSERT INTO trade_up_inputs (
           trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source
         ) VALUES ($1, $2, 'skin-relink-revive', $3, 'Relink Revive', $4, 0.2, 'Field-Tested', $5)`,
        [tradeUpId, input.id, skin, input.price, input.source],
      );
    }
    await ctx.pool.query(`DELETE FROM listings WHERE id = 'rev-gone'`);

    let held!: () => void;
    const reviveHolds = new Promise<void>(resolve => { held = resolve; });
    const revive = reviveStaleGunTradeUps(ctx.pool, 10, "classified_covert", {
      afterTradeUpUpdate: async () => {
        held();
        await waitForTradeUpLockWait();
      },
    });
    const relink = (async () => {
      await reviveHolds;
      return applyDMarketRelinks(ctx.pool, [{
        oldId: dmId,
        newId: "dmarket:revive-new",
        priceCents: 900,
      }]);
    })();
    const [revived, applied] = await Promise.all([revive, relink]);
    expect(applied.failedIds).toEqual([]);
    expect(applied.deferredIds).toEqual([]);
    expect(applied.applied).toBe(1);
    expect(revived.revived).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it("matches inline recompute on 1000 trade-ups, and leaves EV unchanged", async () => {
    const raw = 1000;
    const nextRaw = 640;
    const { oldId, ids } = await seedRelinkSet({ prefix: "parity", count: 1000, raw });
    expect(ids.length).toBe(1000);
    const before = await readCosts(oldId);
    const controlId = ids[0];
    await ctx.pool.query(
      `INSERT INTO listings (id, skin_id, price_cents, float_value, source)
       VALUES ('dmarket:parity-control', 'skin-parity', 1000, 0.12, 'dmarket')`,
    );
    const { rows: controlRows } = await ctx.pool.query<{ id: number }>(
      `INSERT INTO trade_ups (
         total_cost_cents, expected_value_cents, profit_cents, roi_percentage,
         chance_to_profit, best_case_cents, worst_case_cents, outcomes_json, listing_status
       ) VALUES (1500, 9000, 7500, 1, 0.4, 50, -20, $1, 'active') RETURNING id`,
      [JSON.stringify([{ estimated_price_cents: 9000, probability: 1 }])],
    );
    const untouchedId = Number(controlRows[0].id);
    await ctx.pool.query(
      `INSERT INTO trade_up_inputs (
         trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source
       ) VALUES ($1, 'dmarket:parity-control', 'skin-parity', 'AWP | parity', 'Parity', 1500, 0.12, 'Minimal Wear', 'dmarket')`,
      [untouchedId],
    );
    const untouchedBefore = (await ctx.pool.query(
      `SELECT total_cost_cents, expected_value_cents, trade_up_score, profit_cents FROM trade_ups WHERE id = $1`,
      [untouchedId],
    )).rows[0];

    const refLookup = await ensureInputReferences(ctx.pool);
    const client = await ctx.pool.connect();
    let inline: CostRow[];
    try {
      await client.query("BEGIN");
      await applyListingPriceToInputs(client, oldId, nextRaw, "dmarket", refLookup);
      const { rows } = await client.query<CostRow>(
        `SELECT tu.id, tu.total_cost_cents, tu.expected_value_cents, tu.profit_cents, tu.roi_percentage,
                tu.chance_to_profit, tu.best_case_cents, tu.worst_case_cents, tu.trade_up_score,
                tui.price_cents
         FROM trade_ups tu
         JOIN trade_up_inputs tui ON tui.trade_up_id = tu.id AND tui.listing_id = $1
         WHERE tu.id = ANY($2::int[])
         ORDER BY tu.id`,
        [oldId, ids],
      );
      inline = rows.map(row => ({
        id: Number(row.id),
        total_cost_cents: Number(row.total_cost_cents),
        expected_value_cents: Number(row.expected_value_cents),
        profit_cents: Number(row.profit_cents),
        roi_percentage: Number(row.roi_percentage),
        chance_to_profit: Number(row.chance_to_profit),
        best_case_cents: Number(row.best_case_cents),
        worst_case_cents: Number(row.worst_case_cents),
        trade_up_score: Number(row.trade_up_score),
        price_cents: Number(row.price_cents),
      }));
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }

    const newId = "dmarket:parity-new";
    await ctx.pool.query(
      `INSERT INTO listings (id, skin_id, price_cents, float_value, paint_seed, source)
       VALUES ($1, 'skin-parity', $2, 0.12, 7, 'dmarket')`,
      [newId, nextRaw],
    );
    const applied = await applyDMarketRelinks(ctx.pool, [{ oldId, newId, priceCents: nextRaw }]);
    expect(applied.applied).toBe(1);
    expect(applied.failedIds).toEqual([]);
    const after = await readCosts(newId);
    expect(after).toEqual(inline);
    expect(after.map(row => row.expected_value_cents)).toEqual(before.map(row => row.expected_value_cents));
    expect(after.every(row => row.price_cents === repricedInputCost(nextRaw, "dmarket"))).toBe(true);
    expect(controlId).toBe(ids[0]);
    const untouchedAfter = (await ctx.pool.query(
      `SELECT total_cost_cents, expected_value_cents, trade_up_score, profit_cents FROM trade_ups WHERE id = $1`,
      [untouchedId],
    )).rows[0];
    expect(untouchedAfter).toEqual(untouchedBefore);
  }, 180_000);

  it("recomputes after a kill between relink commit and the cost batches", async () => {
    const { oldId } = await seedRelinkSet({ prefix: "kill", count: 3, raw: 1000 });
    const newId = "dmarket:kill-new";
    const nextRaw = 700;
    await ctx.pool.query(
      `INSERT INTO listings (id, skin_id, price_cents, float_value, paint_seed, source)
       VALUES ($1, 'skin-kill', $2, 0.12, 7, 'dmarket')`,
      [newId, nextRaw],
    );
    const oldCost = (await readCosts(oldId))[0].total_cost_cents;
    await expect(applyDMarketRelinks(ctx.pool, [{ oldId, newId, priceCents: nextRaw }], {
      afterRelinkCommit: async () => { throw new Error("killed"); },
    })).rejects.toThrow(/killed/);

    const mid = await readCosts(newId);
    expect(mid).toHaveLength(3);
    expect(mid.every(row => row.price_cents === repricedInputCost(1000, "dmarket"))).toBe(true);
    expect(mid.every(row => row.total_cost_cents === oldCost)).toBe(true);
    const pending = await ctx.pool.query(
      `SELECT key FROM sync_meta WHERE key LIKE 'dm_relink_recompute:%'`,
    );
    expect(pending.rows.length).toBe(1);

    const drained = await drainDMarketRelinkRecomputes(ctx.pool);
    expect(drained.recomputed).toBe(3);
    expect(drained.requeued).toBe(0);
    const after = await readCosts(newId);
    const other = repricedInputCost(400, "csfloat");
    const expected = repricedInputCost(nextRaw, "dmarket") + other;
    expect(after.every(row => row.total_cost_cents === expected)).toBe(true);
    const left = await ctx.pool.query(
      `SELECT key FROM sync_meta WHERE key LIKE 'dm_relink_recompute:%kill%'`,
    );
    expect(left.rows).toHaveLength(0);
  }, 30_000);

  it("keeps the latest price when two relinks commit before recompute", async () => {
    const { oldId } = await seedRelinkSet({ prefix: "twice", count: 2, raw: 1000 });
    const midId = "dmarket:twice-mid";
    const newId = "dmarket:twice-new";
    await ctx.pool.query(
      `INSERT INTO listings (id, skin_id, price_cents, float_value, paint_seed, source)
       VALUES ($1, 'skin-twice', 800, 0.12, 7, 'dmarket'),
              ($2, 'skin-twice', 500, 0.12, 7, 'dmarket')`,
      [midId, newId],
    );
    await applyDMarketRelinks(ctx.pool, [{ oldId, newId: midId, priceCents: 800 }], { deferRecompute: true });
    await applyDMarketRelinks(ctx.pool, [{ oldId: midId, newId, priceCents: 500 }], { deferRecompute: true });
    await drainDMarketRelinkRecomputes(ctx.pool);
    const rows = await readCosts(newId);
    const latest = repricedInputCost(500, "dmarket");
    const expected = latest + repricedInputCost(400, "csfloat");
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.price_cents === latest)).toBe(true);
    expect(rows.every(row => row.total_cost_cents === expected)).toBe(true);
  }, 30_000);

  it("ends on the latest price when a second relink lands between recompute batches", async () => {
    const { oldId, ids } = await seedRelinkSet({ prefix: "batch", count: 3, raw: 1200 });
    const midId = "dmarket:batch-mid";
    const newId = "dmarket:batch-new";
    await ctx.pool.query(
      `INSERT INTO listings (id, skin_id, price_cents, float_value, paint_seed, source)
       VALUES ($1, 'skin-batch', 900, 0.12, 7, 'dmarket'),
              ($2, 'skin-batch', 450, 0.12, 7, 'dmarket')`,
      [midId, newId],
    );
    await applyDMarketRelinks(ctx.pool, [{ oldId, newId: midId, priceCents: 900 }], { deferRecompute: true });
    let relinked = false;
    await drainDMarketRelinkRecomputes(ctx.pool, {
      batchSize: 1,
      backoffMs: 0,
      beforeBatch: async (batch) => {
        if (relinked || batch[0] !== ids[1]) return;
        relinked = true;
        await applyDMarketRelinks(ctx.pool, [{ oldId: midId, newId, priceCents: 450 }], { deferRecompute: true });
      },
    });
    expect(relinked).toBe(true);
    const rows = await readCosts(newId);
    const latest = repricedInputCost(450, "dmarket");
    const expected = latest + repricedInputCost(400, "csfloat");
    expect(rows.map(row => row.id)).toEqual(ids);
    expect(rows.every(row => row.price_cents === latest)).toBe(true);
    expect(rows.every(row => row.total_cost_cents === expected)).toBe(true);
  }, 30_000);

  it("requeues a recompute batch that throws and finishes it on the next drain", async () => {
    const { oldId } = await seedRelinkSet({ prefix: "requeue", count: 2, raw: 1000 });
    const newId = "dmarket:requeue-new";
    await ctx.pool.query(
      `INSERT INTO listings (id, skin_id, price_cents, float_value, paint_seed, source)
       VALUES ($1, 'skin-requeue', 700, 0.12, 7, 'dmarket')`,
      [newId],
    );
    await applyDMarketRelinks(ctx.pool, [{ oldId, newId, priceCents: 700 }], { deferRecompute: true });
    const oldCost = (await ctx.pool.query<{ total_cost_cents: number }>(
      `SELECT total_cost_cents FROM trade_ups tu
       JOIN trade_up_inputs tui ON tui.trade_up_id = tu.id
       WHERE tui.listing_id = $1 LIMIT 1`,
      [newId],
    )).rows[0].total_cost_cents;
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(arg => String(arg)).join(" "));
    };
    try {
      const failed = await drainDMarketRelinkRecomputes(ctx.pool, {
        backoffMs: 0,
        beforeBatch: async () => { throw new Error("batch exploded"); },
      });
      expect(failed.requeued).toBe(2);
      expect(failed.recomputed).toBe(0);
    } finally {
      console.error = original;
    }
    expect(errors.some(line => /DMarket relink recompute requeued 2 trade-ups/.test(line))).toBe(true);
    const stuck = await readCosts(newId);
    expect(stuck.every(row => row.total_cost_cents === Number(oldCost))).toBe(true);
    const drained = await drainDMarketRelinkRecomputes(ctx.pool, { backoffMs: 0 });
    expect(drained.recomputed).toBe(2);
    const after = await readCosts(newId);
    const expected = repricedInputCost(700, "dmarket") + repricedInputCost(400, "csfloat");
    expect(after.every(row => row.total_cost_cents === expected)).toBe(true);
  }, 30_000);

  it("records listing-row lock hold before and after the short transaction", async () => {
    const rows = 248;
    const raw = 1000;
    const nextRaw = 700;
    const beforeSet = await seedRelinkSet({ prefix: "hold-before", count: rows, raw });
    const beforeNew = "dmarket:hold-before-new";
    await ctx.pool.query(
      `INSERT INTO listings (id, skin_id, price_cents, float_value, paint_seed, source)
       VALUES ($1, 'skin-hold-before', $2, 0.12, 7, 'dmarket')`,
      [beforeNew, nextRaw],
    );
    const refLookup = await ensureInputReferences(ctx.pool);
    const client = await ctx.pool.connect();
    let beforeMs = 0;
    try {
      await client.query("BEGIN");
      const ids = [beforeSet.oldId, beforeNew].sort();
      const started = process.hrtime.bigint();
      for (const id of ids) {
        await client.query(`SELECT id FROM listings WHERE id = $1 FOR UPDATE`, [id]);
      }
      await client.query(
        `UPDATE trade_up_inputs SET listing_id = $1 WHERE listing_id = $2`,
        [beforeNew, beforeSet.oldId],
      );
      await applyListingPriceToInputs(client, beforeNew, nextRaw, "dmarket", refLookup);
      await client.query(`DELETE FROM listings WHERE id = $1`, [beforeSet.oldId]);
      beforeMs = Number(process.hrtime.bigint() - started) / 1e6;
      await client.query("COMMIT");
    } finally {
      client.release();
    }

    const afterSet = await seedRelinkSet({ prefix: "hold-after", count: rows, raw });
    const afterNew = "dmarket:hold-after-new";
    await ctx.pool.query(
      `INSERT INTO listings (id, skin_id, price_cents, float_value, paint_seed, source)
       VALUES ($1, 'skin-hold-after', $2, 0.12, 7, 'dmarket')`,
      [afterNew, nextRaw],
    );
    let lockedAt = 0n;
    let committedAt = 0n;
    const applied = await applyDMarketRelinks(ctx.pool, [{
      oldId: afterSet.oldId,
      newId: afterNew,
      priceCents: nextRaw,
    }], {
      onListingLocked: () => { lockedAt = process.hrtime.bigint(); },
      onListingCommitted: () => { committedAt = process.hrtime.bigint(); },
    });
    expect(applied.applied).toBe(1);
    const afterMs = Number(committedAt - lockedAt) / 1e6;
    const report = {
      rows,
      beforeListingLockHoldMs: Math.round(beforeMs * 100) / 100,
      afterListingLockHoldMs: Math.round(afterMs * 100) / 100,
    };
    fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
    fs.writeFileSync("/opt/cursor/artifacts/listing-lock-hold.json", JSON.stringify(report, null, 2));
    console.log(`listing lock hold before ${report.beforeListingLockHoldMs}ms after ${report.afterListingLockHoldMs}ms`);
    expect(report.afterListingLockHoldMs).toBeLessThan(report.beforeListingLockHoldMs);
    const costs = await readCosts(afterNew);
    expect(costs).toHaveLength(rows);
    expect(costs[0].total_cost_cents).toBe(repricedInputCost(nextRaw, "dmarket") + repricedInputCost(400, "csfloat"));
  }, 180_000);
});
