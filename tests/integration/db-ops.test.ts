import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestApp, seedTestData, type TestContext } from "./setup.js";
import { cascadeTradeUpStatuses, deleteListings, refreshListingStatuses, purgeExpiredPreserved } from "../../server/engine/db-status.js";
import { saveTradeUps, mergeTradeUps } from "../../server/engine/db-save.js";
import { makeTradeUp } from "../helpers/fixtures.js";
import type { TradeUp, TradeUpInput, TradeUpOutcome } from "../../shared/types.js";

function makeDbTradeUp(overrides: {
  listingIds: string[];
  profit?: number;
  cost?: number;
  ev?: number;
  collectionName?: string;
}): TradeUp {
  const { listingIds, profit = 2000, cost = 8000, ev = 10000, collectionName = "Test Collection Alpha" } = overrides;
  const inputs: TradeUpInput[] = listingIds.map(id => ({
    listing_id: id,
    skin_id: "skin-classified-1",
    skin_name: "AK-47 | Test Skin",
    collection_name: collectionName,
    price_cents: Math.round(cost / listingIds.length),
    float_value: 0.15,
    condition: "Field-Tested" as const,
    source: "csfloat",
  }));
  const outcomes: TradeUpOutcome[] = [{
    skin_id: "skin-covert-1",
    skin_name: "AK-47 | Fire Serpent",
    collection_name: collectionName,
    probability: 1.0,
    predicted_float: 0.15,
    predicted_condition: "Field-Tested" as const,
    estimated_price_cents: ev,
  }];
  return {
    id: 0,
    inputs,
    outcomes,
    total_cost_cents: cost,
    expected_value_cents: ev,
    profit_cents: profit,
    roi_percentage: Math.round((profit / cost) * 10000) / 100,
    created_at: new Date().toISOString(),
  };
}

describe("DB Operations", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestApp({ defaultTier: "pro" });
    await seedTestData(ctx.pool, {
      profitableCount: 3,
      unprofitableCount: 1,
      staleCount: 1,
      type: "covert_knife",
    });
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  // ─── cascadeTradeUpStatuses ──────────────────────────────────────────────

  describe("cascadeTradeUpStatuses", () => {
    it("marks trade-up as partial when one listing is deleted", async () => {
      // Get an active trade-up and one of its listings
      const { rows: tus } = await ctx.pool.query(
        "SELECT id FROM trade_ups WHERE listing_status = 'active' LIMIT 1"
      );
      const tuId = tus[0].id;
      const { rows: inputs } = await ctx.pool.query(
        "SELECT listing_id FROM trade_up_inputs WHERE trade_up_id = $1 LIMIT 1",
        [tuId]
      );
      const listingId = inputs[0].listing_id;

      // Delete the listing
      await ctx.pool.query("DELETE FROM listings WHERE id = $1", [listingId]);

      // Cascade
      await cascadeTradeUpStatuses(ctx.pool, [listingId]);

      // Verify
      const { rows } = await ctx.pool.query(
        "SELECT listing_status FROM trade_ups WHERE id = $1", [tuId]
      );
      expect(rows[0].listing_status).toBe("partial");
    });

    it("deletes trade-up when all listings are gone", async () => {
      const { rows: tus } = await ctx.pool.query(
        "SELECT id FROM trade_ups WHERE listing_status = 'active' LIMIT 1"
      );
      const tuId = tus[0].id;
      const { rows: inputs } = await ctx.pool.query(
        "SELECT listing_id FROM trade_up_inputs WHERE trade_up_id = $1",
        [tuId]
      );
      const listingIds = inputs.map((i: { listing_id: string }) => i.listing_id);

      // Delete all listings
      await ctx.pool.query("DELETE FROM listings WHERE id = ANY($1)", [listingIds]);

      // Cascade
      await cascadeTradeUpStatuses(ctx.pool, listingIds);

      // Verify trade-up is deleted
      const { rows } = await ctx.pool.query(
        "SELECT id FROM trade_ups WHERE id = $1", [tuId]
      );
      expect(rows).toHaveLength(0);
    });

    it("restores trade-up to active when no listings are missing", async () => {
      // Make a trade-up partial manually
      const { rows: tus } = await ctx.pool.query(
        "SELECT id FROM trade_ups WHERE listing_status = 'active' LIMIT 1"
      );
      const tuId = tus[0].id;
      await ctx.pool.query(
        "UPDATE trade_ups SET listing_status = 'partial', preserved_at = NOW() WHERE id = $1",
        [tuId]
      );

      // Get its listing IDs (all still exist)
      const { rows: inputs } = await ctx.pool.query(
        "SELECT listing_id FROM trade_up_inputs WHERE trade_up_id = $1",
        [tuId]
      );
      const listingIds = inputs.map((i: { listing_id: string }) => i.listing_id);

      // Cascade (all listings still exist)
      await cascadeTradeUpStatuses(ctx.pool, listingIds);

      // Should be back to active
      const { rows } = await ctx.pool.query(
        "SELECT listing_status, preserved_at FROM trade_ups WHERE id = $1", [tuId]
      );
      expect(rows[0].listing_status).toBe("active");
      expect(rows[0].preserved_at).toBeNull();
    });

    it("empty listing IDs array is a no-op", async () => {
      const result = await cascadeTradeUpStatuses(ctx.pool, []);
      expect(result).toBe(0);
    });
  });

  // ─── deleteListings ──────────────────────────────────────────────────────

  describe("deleteListings", () => {
    it("deletes listings and cascades status changes", async () => {
      const { rows: tus } = await ctx.pool.query(
        "SELECT id FROM trade_ups WHERE listing_status = 'active' LIMIT 1"
      );
      const tuId = tus[0].id;
      const { rows: inputs } = await ctx.pool.query(
        "SELECT listing_id FROM trade_up_inputs WHERE trade_up_id = $1 LIMIT 1",
        [tuId]
      );
      const listingId = inputs[0].listing_id;

      const deleted = await deleteListings(ctx.pool, [listingId]);
      expect(deleted).toBe(1);

      // Listing should be gone
      const { rows: remaining } = await ctx.pool.query(
        "SELECT id FROM listings WHERE id = $1", [listingId]
      );
      expect(remaining).toHaveLength(0);

      // Trade-up should be partial
      const { rows: tuRows } = await ctx.pool.query(
        "SELECT listing_status FROM trade_ups WHERE id = $1", [tuId]
      );
      expect(tuRows[0].listing_status).toBe("partial");
    });
  });

  // ─── saveTradeUps ────────────────────────────────────────────────────────

  describe("saveTradeUps", () => {
    it("inserts trade-ups with inputs", async () => {
      // Create listings for the trade-up
      for (let i = 0; i < 5; i++) {
        await ctx.pool.query(
          "INSERT INTO listings (id, skin_id, price_cents, float_value) VALUES ($1, $2, $3, $4)",
          [`save-test-${i}`, "skin-classified-1", 1600, 0.15 + i * 0.01]
        );
      }

      const tu = makeDbTradeUp({
        listingIds: Array.from({ length: 5 }, (_, i) => `save-test-${i}`),
        profit: 3000,
        cost: 8000,
        ev: 11000,
      });

      await saveTradeUps(ctx.pool, [tu], false, "covert_knife");

      // Verify insertion
      const { rows } = await ctx.pool.query(
        "SELECT * FROM trade_ups WHERE profit_cents = 3000 AND type = 'covert_knife'"
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);

      const { rows: inputRows } = await ctx.pool.query(
        "SELECT * FROM trade_up_inputs WHERE trade_up_id = $1",
        [rows[0].id]
      );
      expect(inputRows).toHaveLength(5);
    });

    it("clearFirst=true removes existing trade-ups of same type", async () => {
      const { rows: before } = await ctx.pool.query(
        "SELECT COUNT(*) as cnt FROM trade_ups WHERE type = 'covert_knife'"
      );
      const beforeCount = parseInt(before[0].cnt, 10);
      expect(beforeCount).toBeGreaterThan(0);

      // Save with clearFirst — should replace all existing covert_knife trade-ups
      await saveTradeUps(ctx.pool, [], true, "covert_knife");

      const { rows: after } = await ctx.pool.query(
        "SELECT COUNT(*) as cnt FROM trade_ups WHERE type = 'covert_knife' AND (source = 'discovery' OR source IS NULL)"
      );
      expect(parseInt(after[0].cnt, 10)).toBe(0);
    });
  });

  // ─── mergeTradeUps ───────────────────────────────────────────────────────

  describe("mergeTradeUps", () => {
    it("inserts new trade-ups by signature", async () => {
      // Create fresh listings
      for (let i = 0; i < 5; i++) {
        await ctx.pool.query(
          "INSERT INTO listings (id, skin_id, price_cents, float_value) VALUES ($1, $2, $3, $4)",
          [`merge-new-${i}`, "skin-classified-1", 2000, 0.15 + i * 0.01]
        );
      }

      const tu = makeDbTradeUp({
        listingIds: Array.from({ length: 5 }, (_, i) => `merge-new-${i}`),
        profit: 5000,
      });

      await mergeTradeUps(ctx.pool, [tu], "covert_knife");

      // Should now exist
      const { rows } = await ctx.pool.query(
        "SELECT * FROM trade_ups WHERE profit_cents = 5000"
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
    });

    it("updates existing trade-up when signature matches", async () => {
      // Get an existing trade-up's listing IDs
      const { rows: tus } = await ctx.pool.query(
        "SELECT id FROM trade_ups WHERE type = 'covert_knife' AND listing_status = 'active' LIMIT 1"
      );
      const tuId = tus[0].id;
      const { rows: inputs } = await ctx.pool.query(
        "SELECT listing_id FROM trade_up_inputs WHERE trade_up_id = $1 ORDER BY listing_id",
        [tuId]
      );
      const listingIds = inputs.map((i: { listing_id: string }) => i.listing_id);

      // Create a trade-up with same listing IDs but different profit
      const tu = makeDbTradeUp({ listingIds, profit: 99999, cost: 50000, ev: 149999 });

      await mergeTradeUps(ctx.pool, [tu], "covert_knife");

      // Should have updated the existing row
      const { rows } = await ctx.pool.query(
        "SELECT profit_cents FROM trade_ups WHERE id = $1", [tuId]
      );
      expect(rows[0].profit_cents).toBe(99999);
    });

    it("tracks profit streak on consecutive profitable merges", async () => {
      // Create listings
      for (let i = 0; i < 5; i++) {
        await ctx.pool.query(
          "INSERT INTO listings (id, skin_id, price_cents, float_value) VALUES ($1, $2, $3, $4)",
          [`streak-${i}`, "skin-classified-1", 1000, 0.15]
        );
      }
      const ids = Array.from({ length: 5 }, (_, i) => `streak-${i}`);

      // First merge: profitable
      const tu1 = makeDbTradeUp({ listingIds: ids, profit: 1000 });
      await mergeTradeUps(ctx.pool, [tu1], "covert_knife");

      // Second merge: still profitable (same sig)
      const tu2 = makeDbTradeUp({ listingIds: ids, profit: 1200 });
      await mergeTradeUps(ctx.pool, [tu2], "covert_knife");

      // Third merge: still profitable
      const tu3 = makeDbTradeUp({ listingIds: ids, profit: 1500 });
      await mergeTradeUps(ctx.pool, [tu3], "covert_knife");

      // Check streak
      const { rows } = await ctx.pool.query(
        "SELECT profit_streak FROM trade_ups WHERE profit_cents = 1500"
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
      // Insert sets streak=0 (default), 2nd merge sets streak=1, 3rd merge sets streak=2
      expect(rows[0].profit_streak).toBe(2);
    });
  });

  // ─── refreshListingStatuses ──────────────────────────────────────────────

  describe("refreshListingStatuses", () => {
    it("returns counts of active, partial, and stale trade-ups", async () => {
      const result = await refreshListingStatuses(ctx.pool);
      expect(result.active).toBeGreaterThanOrEqual(0);
      expect(result.partial).toBeGreaterThanOrEqual(0);
      expect(result.stale).toBeGreaterThanOrEqual(0);
      expect(typeof result.preserved).toBe("number");
    });

    it("detects newly missing listings", async () => {
      // Get an active trade-up
      const { rows: tus } = await ctx.pool.query(
        "SELECT id FROM trade_ups WHERE listing_status = 'active' LIMIT 1"
      );
      if (tus.length === 0) return;
      const tuId = tus[0].id;

      // Delete one of its listings
      const { rows: inputs } = await ctx.pool.query(
        "SELECT listing_id FROM trade_up_inputs WHERE trade_up_id = $1 LIMIT 1", [tuId]
      );
      await ctx.pool.query("DELETE FROM listings WHERE id = $1", [inputs[0].listing_id]);

      // Refresh
      await refreshListingStatuses(ctx.pool);

      // Should now be partial
      const { rows } = await ctx.pool.query(
        "SELECT listing_status FROM trade_ups WHERE id = $1", [tuId]
      );
      expect(["partial", "stale"]).toContain(rows[0].listing_status);
    });
  });

  // ─── purgeExpiredPreserved ───────────────────────────────────────────────

  describe("purgeExpiredPreserved", () => {
    it("purges preserved trade-ups older than maxDays", async () => {
      // Set a trade-up as preserved 10 days ago
      await ctx.pool.query(`
        UPDATE trade_ups SET preserved_at = NOW() - INTERVAL '10 days', listing_status = 'partial'
        WHERE listing_status = 'stale'
      `);

      const purged = await purgeExpiredPreserved(ctx.pool, 2);
      expect(purged).toBeGreaterThan(0);
    });

    it("does not purge recently preserved trade-ups", async () => {
      // Set a trade-up as preserved just now
      const { rows: tus } = await ctx.pool.query(
        "SELECT id FROM trade_ups WHERE listing_status = 'active' LIMIT 1"
      );
      if (tus.length === 0) return;
      await ctx.pool.query(
        "UPDATE trade_ups SET preserved_at = NOW(), listing_status = 'partial' WHERE id = $1",
        [tus[0].id]
      );

      const purged = await purgeExpiredPreserved(ctx.pool, 2);

      // The recently preserved one should still exist
      const { rows } = await ctx.pool.query(
        "SELECT id FROM trade_ups WHERE id = $1", [tus[0].id]
      );
      expect(rows).toHaveLength(1);
    });
  });

  // ─── Schema: marketplace_id column ────────────────────────────────────────

  describe("listings table schema", () => {
    it("has marketplace_id column", async () => {
      const { rows } = await ctx.pool.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'listings' AND column_name = 'marketplace_id'
      `);
      expect(rows).toHaveLength(1);
      expect(rows[0].data_type).toBe("text");
    });
  });
});
