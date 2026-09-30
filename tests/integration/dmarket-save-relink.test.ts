import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestContext } from "./setup.js";
import { mergeTradeUps, saveTradeUps, skippedShareLockStats } from "../../server/engine/db-save.js";
import { applyDMarketRelinks, planDMarketRelinks, type DMarketRelistSide } from "../../server/dmarket-fetcher-relist.js";
import { assertDMarketRelinkMap, recordDMarketRelink } from "../../server/engine/dmarket-relink-map.js";
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

  it("does not save an active trade-up on a listing a relink deleted after retarget", async () => {
    await insertListing("dmarket:par-old-barrier");
    await insertListing("dmarket:par-new-barrier");
    await insertListing("csfloat:par-keep");
    const discovered = dmTradeUp(["dmarket:par-old-barrier", "csfloat:par-keep"], 4321);
    let relinkCommitted = false;

    await mergeTradeUps(ctx.pool, [discovered], "save_relink_barrier", {
      beforeInsert: async () => {
        const applied = await applyDMarketRelinks(ctx.pool, [{
          oldId: "dmarket:par-old-barrier",
          newId: "dmarket:par-new-barrier",
          priceCents: 480,
        }]);
        expect(applied.applied).toBe(1);
        const { rows: gone } = await ctx.pool.query(
          `SELECT id FROM listings WHERE id = 'dmarket:par-old-barrier'`,
        );
        expect(gone).toHaveLength(0);
        relinkCommitted = true;
      },
    });

    expect(relinkCommitted).toBe(true);
    const { rows } = await ctx.pool.query(
      `SELECT t.profit_cents, t.total_cost_cents, t.listing_status, tui.listing_id
       FROM trade_ups t
       JOIN trade_up_inputs tui ON tui.trade_up_id = t.id
       WHERE t.type = 'save_relink_barrier'
       ORDER BY tui.listing_id`,
    );
    expect(rows.map(row => row.listing_id)).toEqual(["csfloat:par-keep", "dmarket:par-new-barrier"]);
    expect(rows[0].profit_cents).toBe(4321);
    expect(rows[0].total_cost_cents).toBe(5000);
    expect(rows[0].listing_status).toBe("active");
    const { rows: stale } = await ctx.pool.query(
      `SELECT t.listing_status FROM trade_ups t
       JOIN trade_up_inputs tui ON tui.trade_up_id = t.id
       WHERE tui.listing_id = 'dmarket:par-old-barrier'`,
    );
    expect(stale).toHaveLength(0);
  });

  it("does not save an active trade-up on a listing a relink deleted after the staircase retarget", async () => {
    await insertListing("dmarket:save-barrier-old");
    await insertListing("dmarket:save-barrier-new");
    await insertListing("csfloat:save-barrier-keep");
    const discovered = dmTradeUp(["dmarket:save-barrier-old", "csfloat:save-barrier-keep"], 4321);
    let relinkCommitted = false;

    await saveTradeUps(ctx.pool, [discovered], false, "save_barrier", false, "discovery", {
      beforeWrite: async () => {
        const applied = await applyDMarketRelinks(ctx.pool, [{
          oldId: "dmarket:save-barrier-old",
          newId: "dmarket:save-barrier-new",
          priceCents: 480,
        }]);
        expect(applied.applied).toBe(1);
        const { rows: gone } = await ctx.pool.query(
          `SELECT id FROM listings WHERE id = 'dmarket:save-barrier-old'`,
        );
        expect(gone).toHaveLength(0);
        relinkCommitted = true;
      },
    });

    expect(relinkCommitted).toBe(true);
    const { rows } = await ctx.pool.query(
      `SELECT t.profit_cents, t.total_cost_cents, t.listing_status, tui.listing_id
       FROM trade_ups t
       JOIN trade_up_inputs tui ON tui.trade_up_id = t.id
       WHERE t.type = 'save_barrier'
       ORDER BY tui.listing_id`,
    );
    expect(rows.map(row => row.listing_id)).toEqual(["csfloat:save-barrier-keep", "dmarket:save-barrier-new"]);
    expect(rows[0].profit_cents).toBe(4321);
    expect(rows[0].total_cost_cents).toBe(5000);
    expect(rows[0].listing_status).toBe("active");
    const { rows: stale } = await ctx.pool.query(
      `SELECT t.listing_status FROM trade_ups t
       JOIN trade_up_inputs tui ON tui.trade_up_id = t.id
       WHERE tui.listing_id = 'dmarket:save-barrier-old'`,
    );
    expect(stale).toHaveLength(0);
  });

  it("leaves no active staircase save on a deleted DMarket listing across parallel saves", async () => {
    const rounds = [20, 50];
    let passes = 0;
    for (let round = 0; round < rounds.length; round++) {
      const width = rounds[round];
      const seeded: { oldId: string; newId: string; keepId: string; type: string }[] = [];
      for (let i = 0; i < width; i++) {
        const oldId = `dmarket:save-old-r${round}n${i}`;
        const newId = `dmarket:save-new-r${round}n${i}`;
        const keepId = `csfloat:save-keep-r${round}n${i}`;
        seeded.push({ oldId, newId, keepId, type: `save_race_r${round}n${i}` });
      }
      await ctx.pool.query(
        `INSERT INTO listings (id, skin_id, price_cents, float_value, paint_seed, source)
         SELECT t.id, 'skin-save', 500, 0.15, 412, CASE WHEN t.id LIKE 'dmarket:%' THEN 'dmarket' ELSE 'csfloat' END
         FROM UNNEST($1::text[]) AS t(id)`,
        [seeded.flatMap(row => [row.oldId, row.newId, row.keepId])],
      );
      await Promise.all(seeded.map(row => Promise.all([
        saveTradeUps(ctx.pool, [dmTradeUp([row.oldId, row.keepId], 1500)], false, row.type, false, "discovery"),
        applyDMarketRelinks(ctx.pool, [{ oldId: row.oldId, newId: row.newId, priceCents: 480 }]),
      ])));
      passes += width;
    }

    const { rows: activeOnDeleted } = await ctx.pool.query(
      `SELECT t.id, tui.listing_id
       FROM trade_ups t
       JOIN trade_up_inputs tui ON tui.trade_up_id = t.id
       LEFT JOIN listings l ON l.id = tui.listing_id
       WHERE t.type LIKE 'save_race_%'
         AND t.listing_status = 'active'
         AND tui.listing_id LIKE 'dmarket:%'
         AND l.id IS NULL`,
    );
    expect(activeOnDeleted).toEqual([]);
    const { rows: saved } = await ctx.pool.query(
      `SELECT COUNT(*)::int AS n FROM trade_ups WHERE type LIKE 'save_race_%'`,
    );
    expect(saved[0].n).toBe(passes);
  }, 180_000);

  it("retries the insert when the share lock times out and still saves the live listing", async () => {
    await insertListing("dmarket:lock-timeout");
    await insertListing("csfloat:lock-timeout-keep");
    const holder = await ctx.pool.connect();
    await holder.query("BEGIN");
    await holder.query(`SELECT id FROM listings WHERE id = 'dmarket:lock-timeout' FOR UPDATE`);
    let released = false;
    const releaseHolder = (async () => {
      try {
        await new Promise(resolve => setTimeout(resolve, 6000));
        await holder.query("COMMIT");
        released = true;
      } catch (err) {
        await holder.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        holder.release();
      }
    })();
    try {
      await mergeTradeUps(ctx.pool, [dmTradeUp(["dmarket:lock-timeout", "csfloat:lock-timeout-keep"], 2222)], "save_relink_lock_timeout");
    } finally {
      await releaseHolder;
    }
    expect(released).toBe(true);
    const { rows } = await ctx.pool.query(
      `SELECT t.listing_status, tui.listing_id
       FROM trade_ups t
       JOIN trade_up_inputs tui ON tui.trade_up_id = t.id
       WHERE t.type = 'save_relink_lock_timeout' AND tui.listing_id LIKE 'dmarket:%'`,
    );
    expect(rows).toEqual([{ listing_status: "active", listing_id: "dmarket:lock-timeout" }]);
  }, 20_000);

  it("re-queues a merge batch after share-lock retries instead of dropping it", async () => {
    await insertListing("dmarket:skip-batch");
    await insertListing("csfloat:skip-batch-keep");
    const holder = await ctx.pool.connect();
    await holder.query("BEGIN");
    await holder.query(`SELECT id FROM listings WHERE id = 'dmarket:skip-batch' FOR UPDATE`);
    const errors: string[] = [];
    const orig = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(arg => String(arg)).join(" "));
    };
    const before = skippedShareLockStats().skippedBatches;
    try {
      await mergeTradeUps(
        ctx.pool,
        [dmTradeUp(["dmarket:skip-batch", "csfloat:skip-batch-keep"], 3333)],
        "save_relink_skip_batch",
      );
    } finally {
      console.error = orig;
      await holder.query("ROLLBACK");
      holder.release();
    }
    const afterSkip = skippedShareLockStats();
    expect(afterSkip.skippedBatches).toBe(before + 1);
    expect(afterSkip.queuedTradeUps).toBeGreaterThanOrEqual(1);
    expect(errors.some(line => line.includes("skipping batch of 1") && line.includes("55P03"))).toBe(true);
    const { rows: none } = await ctx.pool.query(
      `SELECT id FROM trade_ups WHERE type = 'save_relink_skip_batch'`,
    );
    expect(none).toHaveLength(0);
    await mergeTradeUps(ctx.pool, [], "save_relink_skip_batch");
    const { rows } = await ctx.pool.query(
      `SELECT t.listing_status, tui.listing_id
       FROM trade_ups t
       JOIN trade_up_inputs tui ON tui.trade_up_id = t.id
       WHERE t.type = 'save_relink_skip_batch' AND tui.listing_id LIKE 'dmarket:%'`,
    );
    expect(rows).toEqual([{ listing_status: "active", listing_id: "dmarket:skip-batch" }]);
    expect(skippedShareLockStats().queuedTradeUps).toBe(0);
  }, 45_000);

  it("leaves no active trade-up on a deleted DMarket listing across parallel merges", async () => {
    const rounds = [20, 50, 50, 50];
    let passes = 0;
    for (let round = 0; round < rounds.length; round++) {
      const width = rounds[round];
      const seeded: { oldId: string; newId: string; keepId: string }[] = [];
      for (let i = 0; i < width; i++) {
        const oldId = `dmarket:par-old-r${round}n${i}`;
        const newId = `dmarket:par-new-r${round}n${i}`;
        const keepId = `csfloat:par-keep-r${round}n${i}`;
        seeded.push({ oldId, newId, keepId });
      }
      await ctx.pool.query(
        `INSERT INTO listings (id, skin_id, price_cents, float_value, paint_seed, source)
         SELECT id, 'skin-save', 500, 0.15, 412, CASE WHEN id LIKE 'dmarket:%' THEN 'dmarket' ELSE 'csfloat' END
         FROM UNNEST($1::text[]) AS t(id)`,
        [seeded.flatMap(row => [row.oldId, row.newId, row.keepId])],
      );
      await Promise.all(seeded.map(row => Promise.all([
        mergeTradeUps(
          ctx.pool,
          [dmTradeUp([row.oldId, row.keepId], 1500)],
          "save_relink_conc",
        ),
        applyDMarketRelinks(ctx.pool, [{ oldId: row.oldId, newId: row.newId, priceCents: 480 }]),
      ])));
      passes += width;
    }

    const { rows: activeOnDeleted } = await ctx.pool.query(
      `SELECT t.id, tui.listing_id
       FROM trade_ups t
       JOIN trade_up_inputs tui ON tui.trade_up_id = t.id
       LEFT JOIN listings l ON l.id = tui.listing_id
       WHERE t.type = 'save_relink_conc'
         AND t.listing_status = 'active'
         AND tui.listing_id LIKE 'dmarket:%'
         AND l.id IS NULL`,
    );
    expect(activeOnDeleted).toEqual([]);
    const { rows: saved } = await ctx.pool.query(
      `SELECT COUNT(*)::int AS n FROM trade_ups WHERE type = 'save_relink_conc'`,
    );
    expect(saved[0].n).toBe(passes);
  }, 180_000);
});

describe("daemon relink map", () => {
  it("accepts a schema that has dmarket_listing_relinks", async () => {
    await expect(assertDMarketRelinkMap(ctx.pool)).resolves.toBeUndefined();
  });

  it("rejects a schema where dmarket_listing_relinks is missing", async () => {
    const client = await ctx.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL search_path TO pg_catalog");
      await expect(assertDMarketRelinkMap(client)).rejects.toThrow(
        /dmarket_listing_relinks is missing/,
      );
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });
});
