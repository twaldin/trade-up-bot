/**
 * Property-based tests for discovery building blocks.
 * Tests invariants of the TradeUpStore and selection strategies.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { TradeUpStore } from "../../../server/engine/store.js";
import { addAdjustedFloat, selectForFloatTarget, selectLowestFloat } from "../../../server/engine/selection.js";
import { listingSig } from "../../../server/engine/utils.js";
import { makeTradeUp, makeListing } from "../../helpers/fixtures.js";
import type { AdjustedListing } from "../../../server/engine/types.js";

// ─── TradeUpStore properties ─────────────────────────────────────────────────

describe("TradeUpStore properties", () => {
  it("total never exceeds maxPerSignature * number of distinct signatures", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.array(
          fc.record({
            listingIds: fc.array(fc.string({ minLength: 1, maxLength: 5 }), { minLength: 1, maxLength: 5 }),
            collectionName: fc.oneof(fc.constant("Alpha"), fc.constant("Beta"), fc.constant("Gamma")),
            profit: fc.integer({ min: 1, max: 100000 }),
          }),
          { minLength: 1, maxLength: 50 }
        ),
        (maxPer, entries) => {
          const store = new TradeUpStore(maxPer);
          for (const entry of entries) {
            store.add(makeTradeUp({
              listingIds: entry.listingIds,
              collectionName: entry.collectionName,
              profit_cents: entry.profit,
              expected_value_cents: entry.profit + 1000,
            }));
          }
          expect(store.total).toBeLessThanOrEqual(maxPer * store.getSignatureCount());
        }
      ),
      { numRuns: 100 }
    );
  });

  it("duplicate listing IDs are always rejected", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 5 }), { minLength: 1, maxLength: 5 }),
        (ids) => {
          const store = new TradeUpStore(20);
          const tu1 = makeTradeUp({ listingIds: ids, profit_cents: 100, expected_value_cents: 1100 });
          store.add(tu1);
          const tu2 = makeTradeUp({ listingIds: [...ids], profit_cents: 200, expected_value_cents: 1200 });
          expect(store.add(tu2)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("hasSig returns true for any added trade-up", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 5 }), { minLength: 1, maxLength: 5 }),
        (ids) => {
          const store = new TradeUpStore(20);
          store.add(makeTradeUp({ listingIds: ids, profit_cents: 100, expected_value_cents: 1100 }));
          expect(store.hasSig(listingSig(ids))).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("getAll returns results sorted by score descending", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.integer({ min: 0, max: 1000 }),
            profit: fc.integer({ min: 1, max: 100000 }),
          }),
          { minLength: 2, maxLength: 20 }
        ),
        (entries) => {
          const store = new TradeUpStore(100);
          for (const entry of entries) {
            store.add(makeTradeUp({
              listingIds: [`${entry.id}`],
              profit_cents: entry.profit,
              expected_value_cents: entry.profit + 500,
            }));
          }
          const results = store.getAll(1000);
          for (let i = 1; i < results.length; i++) {
            // Score = profit + (ctp > 0.25 ? ctp * 5000 : 0)
            // Since all our test trade-ups have ctp = 1.0 (outcome price > cost):
            // score = profit + 5000
            // So results should be sorted by profit descending
            expect(results[i].profit_cents).toBeLessThanOrEqual(results[i - 1].profit_cents);
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ─── Selection strategy properties ───────────────────────────────────────────

describe("Selection strategy properties", () => {
  function makePoolArb(colName: string) {
    return fc.array(
      fc.record({
        float: fc.double({ min: 0.01, max: 0.99, noNaN: true }),
        price: fc.integer({ min: 100, max: 50000 }),
      }),
      { minLength: 10, maxLength: 30 }
    ).map(entries =>
      entries.map((e, i) => ({
        ...makeListing({
          id: `${colName}-${i}`,
          collection_name: colName,
          float_value: e.float,
          price_cents: e.price,
          min_float: 0,
          max_float: 1,
        }),
        adjustedFloat: e.float,
      })) as AdjustedListing[]
    );
  }

  it("selectLowestFloat returns lowest-float listings", () => {
    fc.assert(
      fc.property(
        makePoolArb("Col A"),
        (pool) => {
          const byCol = new Map([["Col A", pool]]);
          const quotas = new Map([["Col A", 5]]);
          const result = selectLowestFloat(byCol, quotas, 5);
          if (!result) return; // skip if not enough

          // All selected should have float <= the 5th-lowest float in pool
          const sortedFloats = [...pool].map(l => l.adjustedFloat).sort((a, b) => a - b);
          const maxAllowed = sortedFloats[4]; // 5th lowest (0-indexed)
          for (const l of result) {
            expect(l.adjustedFloat).toBeLessThanOrEqual(maxAllowed + 1e-10);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("addAdjustedFloat produces values in [0, 1]", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 0.99, noNaN: true }),
        fc.double({ min: 0.01, max: 1.0, noNaN: true }),
        (minFloat, range) => {
          const maxFloat = Math.min(minFloat + range, 1.0);
          if (maxFloat <= minFloat) return;
          const floatVal = minFloat + (maxFloat - minFloat) * 0.5;
          const listings = [makeListing({ float_value: floatVal, min_float: minFloat, max_float: maxFloat })];
          const result = addAdjustedFloat(listings);
          expect(result[0].adjustedFloat).toBeGreaterThanOrEqual(-1e-10);
          expect(result[0].adjustedFloat).toBeLessThanOrEqual(1 + 1e-10);
        }
      ),
      { numRuns: 200 }
    );
  });
});
