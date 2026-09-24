import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import request from "supertest";
import { createTestApp, type TestContext } from "./setup.js";
import { storedInputCost } from "../../server/engine/fees.js";
import { recalcTradeUpCosts } from "../../server/engine/db-stats.js";
import { applyListedResult } from "../../server/sync/listings.js";
import { reviveStaleGunTradeUps } from "../../server/engine/db-revive.js";
import { cascadeTradeUpStatuses } from "../../server/engine/db-status.js";
import { phase1Housekeeping } from "../../server/daemon/phases/housekeeping.js";
import { loadDiscoveryData, clearDiscoveryCache, getListingsForRarity } from "../../server/engine/data-load.js";
import { refPriceCache, skinportMedianCache } from "../../server/engine/pricing.js";
import {
  buildInputReferenceMaps, ensureInputReferences, exceedsReferenceCap, inputReferenceCents,
  markTradeUpsOutlierStale, resetInputReferenceCache,
} from "../../server/engine/input-outlier.js";
import { floatToCondition } from "../../shared/types.js";
import { runMarkOutlierStale, withReadOnlySession } from "../../scripts/mark-outlier-stale.js";
import { seedFeeTradeUp, readInputPrices, readListing } from "../helpers/input-fees.js";

vi.mock("../../server/engine/pricing.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/engine/pricing.js")>();
  return {
    ...actual,
    lookupOutputPrice: async () => ({ priceCents: 50_000, marketplace: "csfloat", grossPrice: 51_000, feePct: 0.02 }),
  };
});

const SKIN = "AK-47 | Test Skin";
const FT = "Field-Tested";
const OUTLIER_RAW = 9_999_900;

async function setRef(pool: TestContext["pool"], cents: number) {
  await pool.query(
    `INSERT INTO price_data (skin_name, condition, min_price_cents, median_price_cents, source, volume)
     VALUES ($1, $2, $3, $3, 'csfloat_ref', 10)
     ON CONFLICT (skin_name, condition, source) DO UPDATE SET min_price_cents = $3, median_price_cents = $3`,
    [SKIN, FT, cents],
  );
  refPriceCache.clear();
  skinportMedianCache.clear();
  resetInputReferenceCache();
}

function since() {
  return new Date(Date.now() - 60_000).toISOString();
}

describe("input price outlier guard", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestApp({ defaultTier: "pro", defaultUserId: "user_pro" });
    refPriceCache.clear();
    skinportMedianCache.clear();
    resetInputReferenceCache();
    clearDiscoveryCache();
  });

  afterEach(async () => {
    refPriceCache.clear();
    skinportMedianCache.clear();
    resetInputReferenceCache();
    clearDiscoveryCache();
    await ctx.cleanup();
  });

  describe("recalcTradeUpCosts", () => {
    it("writes a listing already above 5x its reference when the price does not jump 3x", async () => {
      const oldRaw = 6000;
      const id = await seedFeeTradeUp(ctx.pool, [
        { listingId: "above-ref", source: "csfloat", raw: oldRaw, stored: storedInputCost(oldRaw, "csfloat"), float: 0.2 },
      ]);
      await setRef(ctx.pool, 1000);
      await ctx.pool.query("UPDATE listings SET price_cents = 7000, price_updated_at = NOW() WHERE id = 'above-ref'");

      const res = await recalcTradeUpCosts(ctx.pool, since());

      expect(res.flagged).toBe(0);
      expect(res.updated).toBe(1);
      expect((await readInputPrices(ctx.pool, id))["above-ref"]).toBe(storedInputCost(7000, "csfloat"));
      const { rows } = await ctx.pool.query("SELECT listing_status FROM trade_ups WHERE id = $1", [id]);
      expect(rows[0].listing_status).toBe("active");
    });

    it("does not write a 1000 → 9,999,900 jump, marks stale, and still stores a clean drift", async () => {
      const kept = new Date("2020-01-02T00:00:00Z");
      const jumped = await seedFeeTradeUp(ctx.pool, [
        { listingId: "jump-1", source: "dmarket", raw: 1000, stored: storedInputCost(1000, "dmarket"), float: 0.2 },
      ]);
      const keptRow = await seedFeeTradeUp(ctx.pool, [
        { listingId: "jump-kept", source: "dmarket", raw: 1000, stored: storedInputCost(1000, "dmarket"), float: 0.2 },
      ]);
      const clean = await seedFeeTradeUp(ctx.pool, [
        { listingId: "clean-1161", source: "csfloat", raw: 1000, stored: storedInputCost(1000, "csfloat"), float: 0.2 },
      ]);
      await ctx.pool.query("UPDATE trade_ups SET preserved_at = $1 WHERE id = $2", [kept, keptRow]);
      await ctx.pool.query("UPDATE listings SET price_cents = $1, price_updated_at = NOW() WHERE id IN ('jump-1', 'jump-kept')", [OUTLIER_RAW]);
      await ctx.pool.query("UPDATE listings SET price_cents = 1100, price_updated_at = NOW() WHERE id = 'clean-1161'");
      const beforeJump = (await readInputPrices(ctx.pool, jumped))["jump-1"];
      const beforeKept = (await readInputPrices(ctx.pool, keptRow))["jump-kept"];
      const beforeTotal = (await ctx.pool.query("SELECT total_cost_cents FROM trade_ups WHERE id = $1", [jumped])).rows[0].total_cost_cents;
      await setRef(ctx.pool, 1000);

      const res = await recalcTradeUpCosts(ctx.pool, since());

      expect(res.flagged).toBe(2);
      expect((await readInputPrices(ctx.pool, jumped))["jump-1"]).toBe(beforeJump);
      expect((await readInputPrices(ctx.pool, keptRow))["jump-kept"]).toBe(beforeKept);
      const jumpedRow = (await ctx.pool.query("SELECT total_cost_cents, listing_status, preserved_at FROM trade_ups WHERE id = $1", [jumped])).rows[0];
      expect(jumpedRow.total_cost_cents).toBe(beforeTotal);
      expect(jumpedRow.listing_status).toBe("stale");
      expect(jumpedRow.preserved_at).not.toBeNull();
      const keptStatus = (await ctx.pool.query("SELECT listing_status, preserved_at FROM trade_ups WHERE id = $1", [keptRow])).rows[0];
      expect(keptStatus.listing_status).toBe("stale");
      expect(new Date(keptStatus.preserved_at).toISOString()).toBe(kept.toISOString());
      expect((await readListing(ctx.pool, "jump-1"))?.price_updated_at).toBeNull();
      expect((await readInputPrices(ctx.pool, clean))["clean-1161"]).toBe(1161);
      expect(res.updated).toBe(1);
    });
  });

  describe("applyListedResult", () => {
    it("keeps the new raw listing price and does not write the outlier input", async () => {
      const id = await seedFeeTradeUp(ctx.pool, [
        { listingId: "listed-jump", source: "csfloat", raw: 1000, stored: storedInputCost(1000, "csfloat"), float: 0.2 },
      ]);
      await setRef(ctx.pool, 1000);
      const before = (await readInputPrices(ctx.pool, id))["listed-jump"];

      const res = await applyListedResult(ctx.pool, { id: "listed-jump", price_cents: 1000 }, { price: OUTLIER_RAW });

      expect(res.listingChanged).toBe(true);
      expect(res.tradeUpsFlagged).toBe(1);
      expect(res.inputsUpdated).toBe(0);
      expect((await readInputPrices(ctx.pool, id))["listed-jump"]).toBe(before);
      expect((await readListing(ctx.pool, "listed-jump"))?.price_cents).toBe(OUTLIER_RAW);
      const row = (await ctx.pool.query("SELECT listing_status, preserved_at FROM trade_ups WHERE id = $1", [id])).rows[0];
      expect(row.listing_status).toBe("stale");
      expect(row.preserved_at).not.toBeNull();
    });
  });

  describe("revive", () => {
    async function seedRevive(opts: {
      existingRaw: number;
      candidates: { id: string; float: number; raw: number }[];
      missing?: boolean;
    }) {
      await ctx.pool.query(
        `INSERT INTO collections (id, name) VALUES ('col-revive', 'Revive Collection') ON CONFLICT DO NOTHING`,
      );
      await ctx.pool.query(
        `INSERT INTO skins (id, name, weapon, rarity, min_float, max_float)
         VALUES ('skin-revive', $1, 'AK-47', 'Classified', 0, 1) ON CONFLICT DO NOTHING`,
        [SKIN],
      );
      await ctx.pool.query(
        `INSERT INTO skins (id, name, weapon, rarity, min_float, max_float)
         VALUES ('skin-covert-out', 'AK-47 | Out', 'AK-47', 'Covert', 0, 1) ON CONFLICT DO NOTHING`,
      );
      await ctx.pool.query(
        `INSERT INTO skin_collections (skin_id, collection_id) VALUES ('skin-revive', 'col-revive'), ('skin-covert-out', 'col-revive') ON CONFLICT DO NOTHING`,
      );
      const inputs = Array.from({ length: 10 }, (_, i) => ({
        listingId: i === 0 ? "rev-target" : `rev-ok-${i}`,
        source: "csfloat",
        raw: 1000,
        stored: storedInputCost(1000, "csfloat"),
        float: 0.2,
      }));
      const id = await seedFeeTradeUp(ctx.pool, inputs);
      await ctx.pool.query(
        "UPDATE listings SET skin_id = 'skin-revive' WHERE id = ANY($1)",
        [inputs.map(i => i.listingId)],
      );
      await ctx.pool.query(
        "UPDATE trade_up_inputs SET collection_name = 'Revive Collection', skin_id = 'skin-revive', skin_name = $2 WHERE trade_up_id = $1",
        [id, SKIN],
      );
      await ctx.pool.query("UPDATE listings SET price_cents = $1 WHERE id = 'rev-target'", [opts.existingRaw]);
      if (opts.missing) await ctx.pool.query("DELETE FROM listings WHERE id = 'rev-target'");
      for (const c of opts.candidates) {
        await ctx.pool.query(
          `INSERT INTO listings (id, skin_id, price_cents, float_value, source) VALUES ($1, 'skin-revive', $2, $3, 'csfloat')`,
          [c.id, c.raw, c.float],
        );
      }
      await ctx.pool.query("UPDATE trade_ups SET listing_status = 'stale', preserved_at = NOW() WHERE id = $1", [id]);
      await setRef(ctx.pool, 1000);
      return id;
    }

    it("replaces an outlier listing that still exists", async () => {
      const id = await seedRevive({
        existingRaw: OUTLIER_RAW,
        candidates: [{ id: "rev-clean", float: 0.21, raw: 1100 }],
      });
      const res = await reviveStaleGunTradeUps(ctx.pool, 10, "classified_covert");
      expect(res.revived).toBeGreaterThanOrEqual(1);
      const prices = await readInputPrices(ctx.pool, id);
      expect(prices["rev-target"]).toBeUndefined();
      expect(prices["rev-clean"]).toBeDefined();
      const row = (await ctx.pool.query("SELECT listing_status FROM trade_ups WHERE id = $1", [id])).rows[0];
      expect(row.listing_status).toBe("active");
    });

    it("skips an outlier nearest candidate for the next one", async () => {
      const id = await seedRevive({
        existingRaw: 1000,
        missing: true,
        candidates: [
          { id: "rev-near", float: 0.201, raw: OUTLIER_RAW },
          { id: "rev-next", float: 0.25, raw: 1200 },
        ],
      });
      const res = await reviveStaleGunTradeUps(ctx.pool, 10, "classified_covert");
      expect(res.revived).toBeGreaterThanOrEqual(1);
      const prices = await readInputPrices(ctx.pool, id);
      expect(prices["rev-near"]).toBeUndefined();
      expect(prices["rev-next"]).toBeDefined();
    });

    it("leaves the row stale when every candidate is an outlier", async () => {
      const id = await seedRevive({
        existingRaw: 1000,
        missing: true,
        candidates: [
          { id: "rev-bad-1", float: 0.201, raw: OUTLIER_RAW },
          { id: "rev-bad-2", float: 0.22, raw: OUTLIER_RAW },
        ],
      });
      const res = await reviveStaleGunTradeUps(ctx.pool, 10, "classified_covert");
      expect(res.revived).toBe(0);
      const row = (await ctx.pool.query("SELECT listing_status FROM trade_ups WHERE id = $1", [id])).rows[0];
      expect(row.listing_status).toBe("stale");
    });
  });

  describe("cascade reference lookup", () => {
    it("builds the lookup only when a row would become active, and concurrent builds share one flight", async () => {
      const tuId = await seedFeeTradeUp(ctx.pool, [
        { listingId: "cascade-ref-1", source: "csfloat", raw: 1000, stored: storedInputCost(1000, "csfloat"), float: 0.2 },
        { listingId: "cascade-ref-2", source: "csfloat", raw: 1000, stored: storedInputCost(1000, "csfloat"), float: 0.21 },
      ]);
      const { rows: inputs } = await ctx.pool.query(
        "SELECT listing_id FROM trade_up_inputs WHERE trade_up_id = $1",
        [tuId],
      );
      const listingIds = inputs.map((r: { listing_id: string }) => r.listing_id);
      await ctx.pool.query("DELETE FROM listings WHERE id = ANY($1)", [listingIds]);

      const refSql = (sql: unknown) => typeof sql === "string" && sql.includes("csfloat_sales");
      const spy = vi.spyOn(ctx.pool, "query");
      await cascadeTradeUpStatuses(ctx.pool, listingIds);
      const buildsWhenDeleting = spy.mock.calls.filter(call => refSql(call[0])).length;
      expect(buildsWhenDeleting).toBe(0);
      spy.mockRestore();

      resetInputReferenceCache();
      refPriceCache.clear();
      let refQueries = 0;
      const original = ctx.pool.query.bind(ctx.pool);
      vi.spyOn(ctx.pool, "query").mockImplementation((...args: Parameters<typeof original>) => {
        if (refSql(args[0])) refQueries++;
        return original(...args);
      });
      await Promise.all([ensureInputReferences(ctx.pool), ensureInputReferences(ctx.pool)]);
      expect(refQueries).toBe(1);
    });
  });

  describe("claim release", () => {
    it("does not re-activate a guard-staled row, and a clean row still becomes active", async () => {
      const outlierId = await seedFeeTradeUp(ctx.pool, [
        { listingId: "claim-jump", source: "dmarket", raw: 1000, stored: storedInputCost(1000, "dmarket"), float: 0.2 },
      ]);
      const cleanId = await seedFeeTradeUp(ctx.pool, [
        { listingId: "claim-clean", source: "csfloat", raw: 1000, stored: storedInputCost(1000, "csfloat"), float: 0.21 },
      ]);
      await setRef(ctx.pool, 1000);

      const claimOut = await request(ctx.app).post(`/api/trade-ups/${outlierId}/claim`);
      expect(claimOut.status).toBe(200);
      await ctx.pool.query("UPDATE listings SET price_cents = $1 WHERE id = 'claim-jump'", [OUTLIER_RAW]);
      await markTradeUpsOutlierStale(ctx.pool, [outlierId]);
      const preserved = (await ctx.pool.query("SELECT preserved_at FROM trade_ups WHERE id = $1", [outlierId])).rows[0].preserved_at;

      const releaseOut = await request(ctx.app).delete(`/api/trade-ups/${outlierId}/claim`);
      expect(releaseOut.status).toBe(200);
      const after = (await ctx.pool.query("SELECT listing_status, preserved_at FROM trade_ups WHERE id = $1", [outlierId])).rows[0];
      expect(after.listing_status).toBe("stale");
      expect(new Date(after.preserved_at).toISOString()).toBe(new Date(preserved).toISOString());

      const claimClean = await request(ctx.app).post(`/api/trade-ups/${cleanId}/claim`);
      expect(claimClean.status).toBe(200);
      await ctx.pool.query("UPDATE trade_ups SET listing_status = 'stale', preserved_at = NOW() WHERE id = $1", [cleanId]);
      await ctx.pool.query("UPDATE listings SET claimed_by = NULL, claimed_at = NULL WHERE id = 'claim-clean'");
      await ctx.pool.query(
        "UPDATE trade_up_claims SET released_at = NOW() WHERE trade_up_id = $1",
        [cleanId],
      );
      await cascadeTradeUpStatuses(ctx.pool, ["claim-clean"]);
      const clean = (await ctx.pool.query("SELECT listing_status, preserved_at FROM trade_ups WHERE id = $1", [cleanId])).rows[0];
      expect(clean.listing_status).toBe("active");
      expect(clean.preserved_at).toBeNull();
    });
  });

  describe("cleanup script", () => {
    it("reports a 5x-reference input and does not mark it when cost is within 20x EV", async () => {
      const id = await seedFeeTradeUp(ctx.pool, [
        { listingId: "wide-5x", source: "buff", raw: 6000, stored: storedInputCost(6000, "buff"), float: 0.2 },
      ]);
      await setRef(ctx.pool, 1000);
      const report = await runMarkOutlierStale(ctx.pool, { dryRun: true, pauseMs: 0, log: () => undefined });
      expect(report.marked).toBe(0);
      expect(report.refBuckets["5-10x"]).toBeGreaterThanOrEqual(1);
      expect(report.refBySource.buff).toBeGreaterThanOrEqual(1);
      const row = (await ctx.pool.query("SELECT listing_status FROM trade_ups WHERE id = $1", [id])).rows[0];
      expect(row.listing_status).toBe("active");
    });

    it("dry-run changes no rows and a write on the read-only session fails", async () => {
      await ctx.pool.query(
        `INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, type, listing_status)
         VALUES (100000, 100, -99900, -99, 'classified_covert', 'active')`,
      );
      const before = await ctx.pool.query("SELECT listing_status FROM trade_ups WHERE total_cost_cents = 100000");
      const report = await runMarkOutlierStale(ctx.pool, { dryRun: true, pauseMs: 0, log: () => undefined });
      expect(report.dryRun).toBe(true);
      expect(report.marked).toBeGreaterThanOrEqual(1);
      const after = await ctx.pool.query("SELECT listing_status FROM trade_ups WHERE total_cost_cents = 100000");
      expect(after.rows[0].listing_status).toBe(before.rows[0].listing_status);
      await expect(withReadOnlySession(ctx.pool, db => db.query("UPDATE trade_ups SET listing_status = 'stale'"))).rejects.toThrow();
    });

    it("apply marks cost over 20x EV and writes a revert CSV", async () => {
      const { rows } = await ctx.pool.query(
        `INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, type, listing_status)
         VALUES (100000, 100, -99900, -99, 'classified_covert', 'active') RETURNING id`,
      );
      const id = rows[0].id as number;
      await seedFeeTradeUp(ctx.pool, [
        { listingId: "cost-listing", source: "dmarket", raw: 100000, stored: 100000, float: 0.2 },
      ]);
      const csvPath = path.join(os.tmpdir(), `mark-outlier-${process.pid}-${Date.now()}.csv`);
      const report = await runMarkOutlierStale(ctx.pool, { dryRun: false, csvPath, pauseMs: 0, log: () => undefined });
      expect(report.marked).toBeGreaterThanOrEqual(1);
      const row = (await ctx.pool.query("SELECT listing_status, preserved_at FROM trade_ups WHERE id = $1", [id])).rows[0];
      expect(row.listing_status).toBe("stale");
      expect(row.preserved_at).not.toBeNull();
      const csv = fs.readFileSync(csvPath, "utf8");
      expect(csv).toContain("status,trade_up_id,old_listing_status,old_preserved_at,reason,listing_id");
      expect(csv).toContain(`committed,${id},active,,cost_over_20x_ev`);
      fs.unlinkSync(csvPath);
    });
  });

  describe("housekeeping", () => {
    it("stales cost over 20x EV, leaves exactly 20x and non-active rows, and still deletes EV 0", async () => {
      const over = (await ctx.pool.query(
        `INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, type, listing_status)
         VALUES (21, 1, -20, -95, 'classified_covert', 'active') RETURNING id`,
      )).rows[0].id;
      const exact = (await ctx.pool.query(
        `INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, type, listing_status)
         VALUES (20, 1, -19, -95, 'classified_covert', 'active') RETURNING id`,
      )).rows[0].id;
      const partial = (await ctx.pool.query(
        `INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, type, listing_status)
         VALUES (1000, 1, -999, -99, 'classified_covert', 'partial') RETURNING id`,
      )).rows[0].id;
      const zero = (await ctx.pool.query(
        `INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, type, listing_status)
         VALUES (0, 0, 0, 0, 'classified_covert', 'active') RETURNING id`,
      )).rows[0].id;

      await ctx.pool.query(`
        CREATE TABLE IF NOT EXISTS daemon_events (
          id SERIAL PRIMARY KEY,
          event_type TEXT NOT NULL,
          summary TEXT NOT NULL,
          detail TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await phase1Housekeeping(ctx.pool, 1);

      const overRow = (await ctx.pool.query("SELECT listing_status FROM trade_ups WHERE id = $1", [over])).rows[0];
      expect(overRow.listing_status).toBe("stale");
      expect((await ctx.pool.query("SELECT id FROM trade_ups WHERE id = $1", [over])).rows).toHaveLength(1);
      expect((await ctx.pool.query("SELECT listing_status FROM trade_ups WHERE id = $1", [exact])).rows[0].listing_status).toBe("active");
      expect((await ctx.pool.query("SELECT listing_status FROM trade_ups WHERE id = $1", [partial])).rows[0].listing_status).toBe("partial");
      expect((await ctx.pool.query("SELECT id FROM trade_ups WHERE id = $1", [zero])).rows).toHaveLength(0);
    });
  });

  describe("discovery reference equivalence", () => {
    it("buildInputReferenceMaps matches the previous ref queries on a fixture", async () => {
      await ctx.pool.query(
        `INSERT INTO skins (id, name, weapon, rarity) VALUES ('skin-buff', 'Buff Only', 'AUG', 'Classified') ON CONFLICT DO NOTHING`,
      );
      await ctx.pool.query(
        `INSERT INTO price_data (skin_name, condition, min_price_cents, median_price_cents, source)
         VALUES ('Both', 'Field-Tested', 0, 80, 'csfloat_sales'),
                ('Both', 'Field-Tested', 50, 90, 'csfloat_ref'),
                ('Both', 'Field-Tested', 0, 40, 'skinport'),
                ('Sp Only', 'Factory New', 0, 25, 'skinport')`,
      );
      await ctx.pool.query(
        `INSERT INTO listings (id, skin_id, price_cents, float_value, source)
         VALUES ('buff-a', 'skin-buff', 10, 0.2, 'buff'), ('buff-b', 'skin-buff', 30, 0.2, 'buff')`,
      );
      const maps = await buildInputReferenceMaps(ctx.pool);
      const { rows: refRows } = await ctx.pool.query(`
        SELECT skin_name, condition, MIN(CASE WHEN min_price_cents > 0 THEN min_price_cents ELSE median_price_cents END) as ref
        FROM price_data WHERE (min_price_cents > 0 OR median_price_cents > 0)
          AND source IN ('csfloat_sales', 'csfloat_ref')
        GROUP BY skin_name, condition
      `);
      expect(maps.refPriceCache.get("Both:Field-Tested")).toBe(Number(refRows.find((r: { skin_name: string }) => r.skin_name === "Both").ref));
      expect(maps.skinportMedianCache.get("Both:Field-Tested")).toBe(40);
      expect(maps.refPriceCache.get("Sp Only:Factory New")).toBe(25);
      expect(maps.refPriceCache.get("Buff Only:Field-Tested")).toBe(20);
    });

    it("loadDiscoveryData keeps the same listing ids as the old inline predicate", async () => {
      await ctx.pool.query(
        `INSERT INTO collections (id, name) VALUES ('col-disc', 'Disc Col') ON CONFLICT DO NOTHING`,
      );
      await ctx.pool.query(
        `INSERT INTO skins (id, name, weapon, rarity) VALUES
           ('skin-disc', 'Disc Skin', 'AK-47', 'Restricted') ON CONFLICT DO NOTHING`,
      );
      await ctx.pool.query(
        `INSERT INTO skin_collections (skin_id, collection_id) VALUES ('skin-disc', 'col-disc') ON CONFLICT DO NOTHING`,
      );
      await ctx.pool.query(
        `INSERT INTO listings (id, skin_id, price_cents, float_value, source) VALUES
           ('disc-ok', 'skin-disc', 100, 0.2, 'csfloat'),
           ('disc-out', 'skin-disc', 600, 0.2, 'csfloat')`,
      );
      await ctx.pool.query(
        `INSERT INTO price_data (skin_name, condition, min_price_cents, median_price_cents, source)
         VALUES ('Disc Skin', 'Field-Tested', 100, 100, 'csfloat_ref'),
                ('Disc Skin', 'Field-Tested', 0, 80, 'skinport')`,
      );
      const maps = await buildInputReferenceMaps(ctx.pool);
      refPriceCache.clear();
      skinportMedianCache.clear();
      for (const [k, v] of maps.refPriceCache) refPriceCache.set(k, v);
      for (const [k, v] of maps.skinportMedianCache) skinportMedianCache.set(k, v);
      clearDiscoveryCache();

      const data = await loadDiscoveryData(ctx.pool, "Restricted", "collection_id");
      const raw = await getListingsForRarity(ctx.pool, "Restricted");
      const oldIds = raw.filter(l => {
        const cond = floatToCondition(l.float_value);
        const ref = refPriceCache.get(`${l.skin_name}:${cond}`);
        const sp = skinportMedianCache.get(`${l.skin_name}:${cond}`);
        const effective = ref && sp ? Math.min(ref, sp) : (sp ?? ref);
        return !effective || l.price_cents <= effective * 5;
      }).map(l => l.id).sort();
      const newIds = data.allListings.map(l => l.id).sort();
      expect(newIds).toEqual(oldIds);
      expect(newIds).toContain("disc-ok");
      expect(newIds).not.toContain("disc-out");
      expect(exceedsReferenceCap(600, inputReferenceCents("Disc Skin", FT, {
        ref: refPriceCache, skinport: skinportMedianCache,
      }))).toBe(true);
    });
  });
});
