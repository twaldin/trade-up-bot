import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp, seedTestData, type TestContext } from "./setup.js";
import { saveTradeUps, mergeTradeUps, trimGlobalExcess } from "../../server/engine/db-save.js";
import { cascadeTradeUpStatuses, deleteListings, refreshListingStatuses, purgeExpiredPreserved } from "../../server/engine/db-status.js";
import { makeTradeUp } from "../helpers/fixtures.js";
import type { TradeUp, TradeUpInput, TradeUpOutcome } from "../../shared/types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Unique prefix per test to avoid ID collisions across tests sharing one schema. */
let _seq = 0;
function uid(label: string): string {
  return `${label}-${Date.now()}-${++_seq}`;
}

/** Insert listings into DB and return their IDs. */
async function insertListings(
  pool: import("pg").Pool,
  prefix: string,
  count: number,
  opts: { skinId?: string; priceCents?: number } = {}
): Promise<string[]> {
  const { skinId = "skin-classified-1", priceCents = 2000 } = opts;
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = uid(`${prefix}-${i}`);
    ids.push(id);
    await pool.query(
      "INSERT INTO listings (id, skin_id, price_cents, float_value, source) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING",
      [id, skinId, priceCents, 0.15 + i * 0.005, "csfloat"]
    );
  }
  return ids;
}

/** Build a TradeUp object backed by real listing IDs. */
function buildTradeUp(listingIds: string[], overrides: {
  profit?: number;
  cost?: number;
  ev?: number;
  collectionName?: string;
} = {}): TradeUp {
  const { profit = 2000, cost = 10000, ev = 12000, collectionName = "Test Collection Alpha" } = overrides;
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

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("db-save + db-status integration", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
    await seedTestData(ctx.pool);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // saveTradeUps
  // ═══════════════════════════════════════════════════════════════════════════

  describe("saveTradeUps", () => {
    it("saves trade-ups with correct data", async () => {
      const ids1 = await insertListings(ctx.pool, "save-correct-a", 5);
      const ids2 = await insertListings(ctx.pool, "save-correct-b", 5);
      const ids3 = await insertListings(ctx.pool, "save-correct-c", 5);

      const tus = [
        buildTradeUp(ids1, { profit: 3000, cost: 8000, ev: 11000 }),
        buildTradeUp(ids2, { profit: 5000, cost: 10000, ev: 15000 }),
        buildTradeUp(ids3, { profit: 1000, cost: 6000, ev: 7000 }),
      ];

      // Use a unique type to avoid collision with seeded data
      await saveTradeUps(ctx.pool, tus, false, "classified_covert");

      const { rows } = await ctx.pool.query(
        "SELECT total_cost_cents, profit_cents, roi_percentage FROM trade_ups WHERE type = 'classified_covert' ORDER BY profit_cents ASC"
      );
      // At least the 3 we inserted
      expect(rows.length).toBeGreaterThanOrEqual(3);

      const profits = rows.map((r: { profit_cents: number }) => r.profit_cents);
      expect(profits).toContain(3000);
      expect(profits).toContain(5000);
      expect(profits).toContain(1000);
    });

    it("clearFirst deletes existing trade-ups of same type", async () => {
      const type = "classified_covert_fn";

      // Save batch A
      const idsA = await insertListings(ctx.pool, "clear-a", 5);
      const tuA = buildTradeUp(idsA, { profit: 1111 });
      await saveTradeUps(ctx.pool, [tuA], false, type);

      const { rows: before } = await ctx.pool.query(
        "SELECT COUNT(*) as cnt FROM trade_ups WHERE type = $1", [type]
      );
      expect(parseInt(before[0].cnt, 10)).toBeGreaterThanOrEqual(1);

      // Save batch B with clearFirst=true — should replace all of type
      const idsB = await insertListings(ctx.pool, "clear-b", 5);
      const tuB = buildTradeUp(idsB, { profit: 2222 });
      await saveTradeUps(ctx.pool, [tuB], true, type);

      const { rows: after } = await ctx.pool.query(
        "SELECT profit_cents FROM trade_ups WHERE type = $1", [type]
      );
      expect(after).toHaveLength(1);
      expect(after[0].profit_cents).toBe(2222);
    });

    it("clearFirst=false appends without deleting", async () => {
      const type = "milspec_restricted";

      const idsA = await insertListings(ctx.pool, "append-a", 5);
      const tuA = buildTradeUp(idsA, { profit: 3333 });
      await saveTradeUps(ctx.pool, [tuA], false, type);

      const idsB = await insertListings(ctx.pool, "append-b", 5);
      const tuB = buildTradeUp(idsB, { profit: 4444 });
      await saveTradeUps(ctx.pool, [tuB], false, type);

      const { rows } = await ctx.pool.query(
        "SELECT profit_cents FROM trade_ups WHERE type = $1 ORDER BY profit_cents", [type]
      );
      expect(rows.length).toBeGreaterThanOrEqual(2);
      const profits = rows.map((r: { profit_cents: number }) => r.profit_cents);
      expect(profits).toContain(3333);
      expect(profits).toContain(4444);
    });

    it("saves inputs with correct listing data", async () => {
      const ids = await insertListings(ctx.pool, "inputs-check", 5, { priceCents: 1500 });
      const tu = buildTradeUp(ids, { cost: 7500, ev: 12000, profit: 4500 });

      await saveTradeUps(ctx.pool, [tu], false, "restricted_classified");

      // Find the trade-up we just saved
      const { rows: tuRows } = await ctx.pool.query(
        "SELECT id FROM trade_ups WHERE type = 'restricted_classified' AND profit_cents = 4500 LIMIT 1"
      );
      expect(tuRows).toHaveLength(1);
      const tuId = tuRows[0].id;

      const { rows: inputRows } = await ctx.pool.query(
        "SELECT listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source FROM trade_up_inputs WHERE trade_up_id = $1 ORDER BY listing_id",
        [tuId]
      );
      expect(inputRows).toHaveLength(5);

      for (const row of inputRows) {
        expect(ids).toContain(row.listing_id);
        expect(row.skin_id).toBe("skin-classified-1");
        expect(row.skin_name).toBe("AK-47 | Test Skin");
        expect(row.collection_name).toBe("Test Collection Alpha");
        expect(row.price_cents).toBe(1500); // 7500 / 5
        expect(row.condition).toBe("Field-Tested");
        expect(row.source).toBe("csfloat");
      }
    });

    it("computes chance_to_profit and best/worst case on save", async () => {
      const ids = await insertListings(ctx.pool, "derived-fields", 5);
      const cost = 8000;
      // Two outcomes: one profitable, one not — chance_to_profit should be 0.6
      const tu: TradeUp = {
        id: 0,
        inputs: ids.map(id => ({
          listing_id: id,
          skin_id: "skin-classified-1",
          skin_name: "AK-47 | Test Skin",
          collection_name: "Test Collection Alpha",
          price_cents: cost / ids.length,
          float_value: 0.15,
          condition: "Field-Tested" as const,
          source: "csfloat",
        })),
        outcomes: [
          {
            skin_id: "skin-covert-1",
            skin_name: "AK-47 | Fire Serpent",
            collection_name: "Test Collection Alpha",
            probability: 0.6,
            predicted_float: 0.15,
            predicted_condition: "Field-Tested" as const,
            estimated_price_cents: 15000, // above cost
          },
          {
            skin_id: "skin-covert-1",
            skin_name: "AK-47 | Fire Serpent",
            collection_name: "Test Collection Alpha",
            probability: 0.4,
            predicted_float: 0.55,
            predicted_condition: "Battle-Scarred" as const,
            estimated_price_cents: 3000, // below cost
          },
        ],
        total_cost_cents: cost,
        expected_value_cents: 15000 * 0.6 + 3000 * 0.4,
        profit_cents: Math.round(15000 * 0.6 + 3000 * 0.4) - cost,
        roi_percentage: 0,
        created_at: new Date().toISOString(),
      };

      const type = "restricted_classified";
      await saveTradeUps(ctx.pool, [tu], false, type);

      const { rows } = await ctx.pool.query(
        "SELECT chance_to_profit, best_case_cents, worst_case_cents FROM trade_ups WHERE total_cost_cents = $1 AND type = $2 ORDER BY id DESC LIMIT 1",
        [cost, type]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].chance_to_profit).toBeCloseTo(0.6, 5);
      // best = 15000 - 8000 = 7000, worst = 3000 - 8000 = -5000
      expect(rows[0].best_case_cents).toBe(7000);
      expect(rows[0].worst_case_cents).toBe(-5000);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // mergeTradeUps
  // ═══════════════════════════════════════════════════════════════════════════

  describe("mergeTradeUps", () => {
    it("inserts new trade-ups by listing signature", async () => {
      const type = "covert_knife";
      const ids1 = await insertListings(ctx.pool, "merge-new-1", 5);
      const ids2 = await insertListings(ctx.pool, "merge-new-2", 5);
      const ids3 = await insertListings(ctx.pool, "merge-new-3", 5);

      const tus = [
        buildTradeUp(ids1, { profit: 11111 }),
        buildTradeUp(ids2, { profit: 22222 }),
        buildTradeUp(ids3, { profit: 33333 }),
      ];

      await mergeTradeUps(ctx.pool, tus, type);

      for (const expected of [11111, 22222, 33333]) {
        const { rows } = await ctx.pool.query(
          "SELECT id FROM trade_ups WHERE profit_cents = $1", [expected]
        );
        expect(rows.length).toBeGreaterThanOrEqual(1);
      }
    });

    it("updates existing trade-up when signature matches", async () => {
      const type = "covert_knife";
      const ids = await insertListings(ctx.pool, "merge-update", 5);

      // Insert first time
      const tu1 = buildTradeUp(ids, { profit: 5555, cost: 8000, ev: 13555 });
      await mergeTradeUps(ctx.pool, [tu1], type);

      // Find it
      const { rows: inserted } = await ctx.pool.query(
        "SELECT id FROM trade_ups WHERE profit_cents = 5555 AND type = $1", [type]
      );
      expect(inserted.length).toBeGreaterThanOrEqual(1);
      const tuId = inserted[0].id;

      // Merge again with same listing IDs but different profit
      const tu2 = buildTradeUp(ids, { profit: 7777, cost: 8000, ev: 15777 });
      await mergeTradeUps(ctx.pool, [tu2], type);

      const { rows: updated } = await ctx.pool.query(
        "SELECT profit_cents FROM trade_ups WHERE id = $1", [tuId]
      );
      expect(updated[0].profit_cents).toBe(7777);
    });

    it("tracks profit streak on consecutive profitable merges", async () => {
      const type = "restricted_classified"; // isolated type to avoid cross-test sig interference
      const ids = await insertListings(ctx.pool, "streak-profit", 5);

      // First merge: profitable — insert, streak stays at default 0
      const tu1 = buildTradeUp(ids, { profit: 60001, cost: 5000, ev: 65001 });
      await mergeTradeUps(ctx.pool, [tu1], type);

      const { rows: r1 } = await ctx.pool.query(
        "SELECT id, profit_streak FROM trade_ups WHERE profit_cents = 60001 AND type = $1", [type]
      );
      expect(r1.length).toBeGreaterThanOrEqual(1);
      const tuId = r1[0].id;
      // On insert, profit_streak defaults to 0

      // Second merge: still profitable — update path, streak goes to 1
      const tu2 = buildTradeUp(ids, { profit: 60002, cost: 5000, ev: 65002 });
      await mergeTradeUps(ctx.pool, [tu2], type);

      const { rows: r2 } = await ctx.pool.query(
        "SELECT profit_streak FROM trade_ups WHERE id = $1", [tuId]
      );
      expect(r2[0].profit_streak).toBe(1);

      // Third merge: still profitable — streak goes to 2
      const tu3 = buildTradeUp(ids, { profit: 60003, cost: 5000, ev: 65003 });
      await mergeTradeUps(ctx.pool, [tu3], type);

      const { rows: r3 } = await ctx.pool.query(
        "SELECT profit_streak FROM trade_ups WHERE id = $1", [tuId]
      );
      expect(r3[0].profit_streak).toBe(2);
    });

    it("profit streak resets to 0 when trade-up becomes unprofitable", async () => {
      const type = "milspec_restricted"; // isolated type to avoid cross-test sig interference
      const ids = await insertListings(ctx.pool, "streak-reset", 5);

      // Two profitable merges to build streak
      const tu1 = buildTradeUp(ids, { profit: 70001, cost: 5000, ev: 75001 });
      await mergeTradeUps(ctx.pool, [tu1], type);
      const tu2 = buildTradeUp(ids, { profit: 70002, cost: 5000, ev: 75002 });
      await mergeTradeUps(ctx.pool, [tu2], type);

      const { rows: beforeReset } = await ctx.pool.query(
        "SELECT id, profit_streak FROM trade_ups WHERE profit_cents = 70002 AND type = $1", [type]
      );
      expect(beforeReset.length).toBeGreaterThanOrEqual(1);
      const tuId = beforeReset[0].id;
      expect(beforeReset[0].profit_streak).toBe(1);

      // Now merge as unprofitable — streak resets
      const tu3 = buildTradeUp(ids, { profit: -500, cost: 5000, ev: 4500 });
      await mergeTradeUps(ctx.pool, [tu3], type);

      const { rows: afterReset } = await ctx.pool.query(
        "SELECT profit_streak FROM trade_ups WHERE id = $1", [tuId]
      );
      expect(afterReset[0].profit_streak).toBe(0);
    });

    it("records profitable combo history", async () => {
      const type = "covert_knife";
      const ids = await insertListings(ctx.pool, "combo-history", 5);

      const tu = buildTradeUp(ids, { profit: 8000, cost: 10000, ev: 18000, collectionName: "Test Collection Alpha" });
      await mergeTradeUps(ctx.pool, [tu], type);

      // The combo_key is collection names sorted and joined by "|"
      const { rows } = await ctx.pool.query(
        "SELECT combo_key, best_profit_cents, times_profitable, last_cost_cents FROM profitable_combos WHERE combo_key = $1",
        ["Test Collection Alpha"]
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0].best_profit_cents).toBeGreaterThanOrEqual(8000);
      expect(rows[0].times_profitable).toBeGreaterThanOrEqual(1);
      expect(rows[0].last_cost_cents).toBe(10000);
    });

    it("processes in batches without long locks", async () => {
      const type = "covert_knife";
      // Create 600+ trade-ups (exceeds BATCH_SIZE of 500)
      const batchCount = 600;
      const tus: TradeUp[] = [];

      for (let i = 0; i < batchCount; i++) {
        const ids = await insertListings(ctx.pool, `batch-${i}`, 5);
        tus.push(buildTradeUp(ids, { profit: 100 + i }));
      }

      await mergeTradeUps(ctx.pool, tus, type);

      // Verify all were inserted
      const { rows } = await ctx.pool.query(
        "SELECT COUNT(*) as cnt FROM trade_ups WHERE type = $1 AND profit_cents >= 100 AND profit_cents < $2",
        [type, 100 + batchCount]
      );
      expect(parseInt(rows[0].cnt, 10)).toBe(batchCount);
    }, 60_000); // allow more time for 600 inserts
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // trimGlobalExcess
  // ═══════════════════════════════════════════════════════════════════════════

  describe("trimGlobalExcess", () => {
    it("does nothing when count is below max", async () => {
      const { rows: before } = await ctx.pool.query(
        "SELECT COUNT(*) as cnt FROM trade_ups WHERE is_theoretical = false"
      );
      const beforeCount = parseInt(before[0].cnt, 10);

      const deleted = await trimGlobalExcess(ctx.pool, beforeCount + 100);
      expect(deleted).toBe(0);

      const { rows: after } = await ctx.pool.query(
        "SELECT COUNT(*) as cnt FROM trade_ups WHERE is_theoretical = false"
      );
      expect(parseInt(after[0].cnt, 10)).toBe(beforeCount);
    });

    it("deletes lowest-ROI trade-ups to reach cap", async () => {
      // Insert 10 trade-ups with distinct ROI values into a unique type
      const type = "covert_knife";
      const rois: number[] = [];
      for (let i = 0; i < 10; i++) {
        const ids = await insertListings(ctx.pool, `trim-roi-${i}`, 5);
        const roi = (i + 1) * 10; // 10, 20, 30, ... 100
        rois.push(roi);
        const tu = buildTradeUp(ids, {
          profit: roi * 100,
          cost: 10000,
          ev: 10000 + roi * 100,
        });
        // Override roi to be exact
        tu.roi_percentage = roi;
        await saveTradeUps(ctx.pool, [tu], false, type);
      }

      // Count total non-theoretical trade-ups
      const { rows: totalBefore } = await ctx.pool.query(
        "SELECT COUNT(*) as cnt FROM trade_ups WHERE is_theoretical = false"
      );
      const totalCount = parseInt(totalBefore[0].cnt, 10);

      // Trim to keep only (totalCount - 5) — should delete 5 lowest-ROI
      const targetKeep = totalCount - 5;
      const deleted = await trimGlobalExcess(ctx.pool, targetKeep);
      expect(deleted).toBeGreaterThanOrEqual(5);

      const { rows: totalAfter } = await ctx.pool.query(
        "SELECT COUNT(*) as cnt FROM trade_ups WHERE is_theoretical = false"
      );
      expect(parseInt(totalAfter[0].cnt, 10)).toBeLessThanOrEqual(targetKeep);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // cascadeTradeUpStatuses
  // ═══════════════════════════════════════════════════════════════════════════

  describe("cascadeTradeUpStatuses", () => {
    it("marks trade-up as partial when one listing deleted", async () => {
      const ids = await insertListings(ctx.pool, "cascade-partial", 5);
      const tu = buildTradeUp(ids, { profit: 6000 });
      await saveTradeUps(ctx.pool, [tu], false, "covert_knife");

      // Find the trade-up
      const { rows: tuRows } = await ctx.pool.query(
        "SELECT t.id FROM trade_ups t JOIN trade_up_inputs tui ON tui.trade_up_id = t.id WHERE tui.listing_id = $1 LIMIT 1",
        [ids[0]]
      );
      const tuId = tuRows[0].id;

      // Delete one listing
      await ctx.pool.query("DELETE FROM listings WHERE id = $1", [ids[0]]);

      // Cascade
      await cascadeTradeUpStatuses(ctx.pool, [ids[0]]);

      const { rows } = await ctx.pool.query(
        "SELECT listing_status FROM trade_ups WHERE id = $1", [tuId]
      );
      expect(rows[0].listing_status).toBe("partial");
    });

    it("deletes trade-up when all input listings gone", async () => {
      const ids = await insertListings(ctx.pool, "cascade-delete", 5);
      const tu = buildTradeUp(ids, { profit: 7000 });
      await saveTradeUps(ctx.pool, [tu], false, "covert_knife");

      const { rows: tuRows } = await ctx.pool.query(
        "SELECT t.id FROM trade_ups t JOIN trade_up_inputs tui ON tui.trade_up_id = t.id WHERE tui.listing_id = $1 LIMIT 1",
        [ids[0]]
      );
      const tuId = tuRows[0].id;

      // Delete ALL listings
      await ctx.pool.query("DELETE FROM listings WHERE id = ANY($1)", [ids]);

      await cascadeTradeUpStatuses(ctx.pool, ids);

      const { rows } = await ctx.pool.query(
        "SELECT id FROM trade_ups WHERE id = $1", [tuId]
      );
      expect(rows).toHaveLength(0);
    });

    it("restores active status when listing returns", async () => {
      const ids = await insertListings(ctx.pool, "cascade-restore", 5);
      const tu = buildTradeUp(ids, { profit: 8000 });
      await saveTradeUps(ctx.pool, [tu], false, "covert_knife");

      const { rows: tuRows } = await ctx.pool.query(
        "SELECT t.id FROM trade_ups t JOIN trade_up_inputs tui ON tui.trade_up_id = t.id WHERE tui.listing_id = $1 LIMIT 1",
        [ids[0]]
      );
      const tuId = tuRows[0].id;

      // Manually set to partial with preserved_at
      await ctx.pool.query(
        "UPDATE trade_ups SET listing_status = 'partial', preserved_at = NOW() WHERE id = $1",
        [tuId]
      );

      // All listings still exist — cascade should restore to active
      await cascadeTradeUpStatuses(ctx.pool, ids);

      const { rows } = await ctx.pool.query(
        "SELECT listing_status, preserved_at FROM trade_ups WHERE id = $1", [tuId]
      );
      expect(rows[0].listing_status).toBe("active");
      expect(rows[0].preserved_at).toBeNull();
    });

    it("skips actively claimed trade-ups", async () => {
      const ids = await insertListings(ctx.pool, "cascade-claimed", 5);
      const tu = buildTradeUp(ids, { profit: 9000 });
      await saveTradeUps(ctx.pool, [tu], false, "covert_knife");

      const { rows: tuRows } = await ctx.pool.query(
        "SELECT t.id FROM trade_ups t JOIN trade_up_inputs tui ON tui.trade_up_id = t.id WHERE tui.listing_id = $1 LIMIT 1",
        [ids[0]]
      );
      const tuId = tuRows[0].id;

      // Create an active claim (not expired, not released)
      await ctx.pool.query(
        "INSERT INTO trade_up_claims (trade_up_id, user_id, claimed_at, expires_at) VALUES ($1, $2, NOW(), NOW() + INTERVAL '10 minutes')",
        [tuId, "user_pro"]
      );

      // Delete a listing
      await ctx.pool.query("DELETE FROM listings WHERE id = $1", [ids[0]]);

      // Cascade — should skip because of active claim
      await cascadeTradeUpStatuses(ctx.pool, [ids[0]]);

      const { rows } = await ctx.pool.query(
        "SELECT listing_status FROM trade_ups WHERE id = $1", [tuId]
      );
      expect(rows[0].listing_status).toBe("active");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // deleteListings
  // ═══════════════════════════════════════════════════════════════════════════

  describe("deleteListings", () => {
    it("deletes listings and cascades status", async () => {
      const ids = await insertListings(ctx.pool, "del-listings", 5);
      const tu = buildTradeUp(ids, { profit: 4000 });
      await saveTradeUps(ctx.pool, [tu], false, "covert_knife");

      const { rows: tuRows } = await ctx.pool.query(
        "SELECT t.id FROM trade_ups t JOIN trade_up_inputs tui ON tui.trade_up_id = t.id WHERE tui.listing_id = $1 LIMIT 1",
        [ids[0]]
      );
      const tuId = tuRows[0].id;

      // Delete 2 of 5 listings via deleteListings
      const deletedCount = await deleteListings(ctx.pool, [ids[0], ids[1]]);
      expect(deletedCount).toBe(2);

      // Verify listings are gone
      const { rows: remainingListings } = await ctx.pool.query(
        "SELECT id FROM listings WHERE id = ANY($1)", [[ids[0], ids[1]]]
      );
      expect(remainingListings).toHaveLength(0);

      // Trade-up should be partial (2 of 5 inputs missing)
      const { rows } = await ctx.pool.query(
        "SELECT listing_status FROM trade_ups WHERE id = $1", [tuId]
      );
      expect(rows[0].listing_status).toBe("partial");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // refreshListingStatuses
  // ═══════════════════════════════════════════════════════════════════════════

  describe("refreshListingStatuses", () => {
    it("correctly reports active/partial/stale counts", async () => {
      // Set up a mix: one active (all listings exist), one with a missing listing
      const idsActive = await insertListings(ctx.pool, "refresh-active", 5);
      const tuActive = buildTradeUp(idsActive, { profit: 2000 });
      await saveTradeUps(ctx.pool, [tuActive], false, "covert_knife");

      const idsPartial = await insertListings(ctx.pool, "refresh-partial", 5);
      const tuPartial = buildTradeUp(idsPartial, { profit: 2500 });
      await saveTradeUps(ctx.pool, [tuPartial], false, "covert_knife");

      // Delete one listing from the second trade-up to make it partial
      await ctx.pool.query("DELETE FROM listings WHERE id = $1", [idsPartial[0]]);

      const result = await refreshListingStatuses(ctx.pool);

      expect(result.active).toBeGreaterThanOrEqual(1);
      expect(result.partial).toBeGreaterThanOrEqual(1);
      expect(typeof result.stale).toBe("number");
      expect(typeof result.preserved).toBe("number");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // purgeExpiredPreserved
  // ═══════════════════════════════════════════════════════════════════════════

  describe("purgeExpiredPreserved", () => {
    it("purges trade-ups preserved longer than maxDays", async () => {
      const ids = await insertListings(ctx.pool, "purge-expired", 5);
      const tu = buildTradeUp(ids, { profit: 3000 });
      await saveTradeUps(ctx.pool, [tu], false, "covert_knife");

      // Find the trade-up and set preserved_at to 3 days ago
      const { rows: tuRows } = await ctx.pool.query(
        "SELECT t.id FROM trade_ups t JOIN trade_up_inputs tui ON tui.trade_up_id = t.id WHERE tui.listing_id = $1 LIMIT 1",
        [ids[0]]
      );
      const tuId = tuRows[0].id;
      await ctx.pool.query(
        "UPDATE trade_ups SET preserved_at = NOW() - INTERVAL '3 days', listing_status = 'partial' WHERE id = $1",
        [tuId]
      );

      const purged = await purgeExpiredPreserved(ctx.pool, 2);
      expect(purged).toBeGreaterThanOrEqual(1);

      // Verify deleted
      const { rows } = await ctx.pool.query(
        "SELECT id FROM trade_ups WHERE id = $1", [tuId]
      );
      expect(rows).toHaveLength(0);
    });

    it("keeps recently preserved trade-ups", async () => {
      const ids = await insertListings(ctx.pool, "purge-recent", 5);
      const tu = buildTradeUp(ids, { profit: 3500 });
      await saveTradeUps(ctx.pool, [tu], false, "covert_knife");

      const { rows: tuRows } = await ctx.pool.query(
        "SELECT t.id FROM trade_ups t JOIN trade_up_inputs tui ON tui.trade_up_id = t.id WHERE tui.listing_id = $1 LIMIT 1",
        [ids[0]]
      );
      const tuId = tuRows[0].id;

      // Set preserved_at to 1 day ago — should survive maxDays=2
      await ctx.pool.query(
        "UPDATE trade_ups SET preserved_at = NOW() - INTERVAL '1 day', listing_status = 'partial' WHERE id = $1",
        [tuId]
      );

      await purgeExpiredPreserved(ctx.pool, 2);

      const { rows } = await ctx.pool.query(
        "SELECT id FROM trade_ups WHERE id = $1", [tuId]
      );
      expect(rows).toHaveLength(1);
    });
  });
});
