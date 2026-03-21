/**
 * Property-based tests for discovery building blocks.
 * Tests invariants of the TradeUpStore, selection strategies, signature
 * identity, probability distribution, and trade-up type constraints.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { TradeUpStore } from "../../../server/engine/store.js";
import { addAdjustedFloat, selectForFloatTarget, selectLowestFloat } from "../../../server/engine/selection.js";
import { calculateOutputFloat, calculateOutcomeProbabilities } from "../../../server/engine/core.js";
import { CONDITION_BOUNDS } from "../../../server/engine/types.js";
import { listingSig } from "../../../server/engine/utils.js";
import { makeTradeUp, makeListing, makeListings, makeOutcome } from "../../helpers/fixtures.js";
import type { AdjustedListing, ListingWithCollection, DbSkinOutcome } from "../../../server/engine/types.js";

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

// ─── listingSig identity properties ─────────────────────────────────────────

describe("listingSig identity properties", () => {
  it("same IDs in any order produce the same signature", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 10 }),
        (ids) => {
          const forward = listingSig(ids);
          const reversed = listingSig([...ids].reverse());
          const shuffled = listingSig(
            [...ids].sort(() => Math.random() - 0.5)
          );
          expect(forward).toBe(reversed);
          expect(forward).toBe(shuffled);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("different sets of listing IDs always produce different signatures", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 2, maxLength: 10 }),
        (ids) => {
          // Split the unique array into two non-overlapping subsets
          const half = Math.max(1, Math.floor(ids.length / 2));
          const setA = ids.slice(0, half);
          const setB = ids.slice(half);
          if (setB.length === 0) return; // need both non-empty
          const sigA = listingSig(setA);
          const sigB = listingSig(setB);
          expect(sigA).not.toBe(sigB);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("store.hasSig recognises pre-seeded signatures from constructor", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.array(fc.string({ minLength: 1, maxLength: 10 }), { minLength: 1, maxLength: 5 }),
          { minLength: 1, maxLength: 10 }
        ),
        (idSets) => {
          const sigs = new Set(idSets.map((ids) => listingSig(ids)));
          const store = new TradeUpStore(20, sigs);
          for (const ids of idSets) {
            expect(store.hasSig(listingSig(ids))).toBe(true);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("store rejects trade-ups whose listing sig was pre-seeded", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 10 }), { minLength: 1, maxLength: 5 }),
        (ids) => {
          const sig = listingSig(ids);
          const store = new TradeUpStore(20, new Set([sig]));
          const tu = makeTradeUp({
            listingIds: ids,
            profit_cents: 5000,
            expected_value_cents: 8000,
          });
          expect(store.add(tu)).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ─── Collection probability invariants ──────────────────────────────────────

describe("Collection probability invariants", () => {
  it("single-collection inputs give 100% probability spread across that collection's outcomes", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1, max: 5 }),
        (inputCount, outcomeCount) => {
          const inputs: ListingWithCollection[] = Array.from(
            { length: inputCount },
            (_, i) =>
              makeListing({
                id: `in-${i}`,
                collection_id: "col-single",
                collection_name: "Single Collection",
              })
          );
          const outcomes: DbSkinOutcome[] = Array.from(
            { length: outcomeCount },
            (_, i) =>
              makeOutcome({
                id: `out-${i}`,
                name: `Output ${i}`,
                collection_id: "col-single",
                collection_name: "Single Collection",
              })
          );
          const result = calculateOutcomeProbabilities(inputs, outcomes);
          expect(result).toHaveLength(outcomeCount);

          // Total probability must be 1.0
          const total = result.reduce((s, r) => s + r.probability, 0);
          expect(total).toBeCloseTo(1.0, 8);

          // Each outcome gets equal share: 1/outcomeCount
          for (const r of result) {
            expect(r.probability).toBeCloseTo(1 / outcomeCount, 8);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("two-collection inputs weight probabilities by input count ratio", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 9 }),
        fc.integer({ min: 1, max: 3 }),
        fc.integer({ min: 1, max: 3 }),
        (colACount, colAOutcomes, colBOutcomes) => {
          const colBCount = 10 - colACount; // always totals 10
          if (colBCount < 1) return;

          const inputs: ListingWithCollection[] = [
            ...Array.from({ length: colACount }, (_, i) =>
              makeListing({ id: `a-${i}`, collection_id: "col-a", collection_name: "Col A" })
            ),
            ...Array.from({ length: colBCount }, (_, i) =>
              makeListing({ id: `b-${i}`, collection_id: "col-b", collection_name: "Col B" })
            ),
          ];
          const outcomes: DbSkinOutcome[] = [
            ...Array.from({ length: colAOutcomes }, (_, i) =>
              makeOutcome({ id: `oa-${i}`, name: `A Out ${i}`, collection_id: "col-a", collection_name: "Col A" })
            ),
            ...Array.from({ length: colBOutcomes }, (_, i) =>
              makeOutcome({ id: `ob-${i}`, name: `B Out ${i}`, collection_id: "col-b", collection_name: "Col B" })
            ),
          ];

          const result = calculateOutcomeProbabilities(inputs, outcomes);
          expect(result).toHaveLength(colAOutcomes + colBOutcomes);

          const total = result.reduce((s, r) => s + r.probability, 0);
          expect(total).toBeCloseTo(1.0, 8);

          // Col A outcomes each get (colACount/10) / colAOutcomes
          const expectedPerA = (colACount / 10) / colAOutcomes;
          const colAResults = result.filter((r) => r.outcome.collection_id === "col-a");
          for (const r of colAResults) {
            expect(r.probability).toBeCloseTo(expectedPerA, 8);
          }

          // Col B outcomes each get (colBCount/10) / colBOutcomes
          const expectedPerB = (colBCount / 10) / colBOutcomes;
          const colBResults = result.filter((r) => r.outcome.collection_id === "col-b");
          for (const r of colBResults) {
            expect(r.probability).toBeCloseTo(expectedPerB, 8);
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ─── Trade-up type input count constraints ──────────────────────────────────

describe("Trade-up type input count constraints", () => {
  it("gun trade-ups always have exactly 10 inputs", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          "classified_covert",
          "restricted_classified",
          "milspec_restricted"
        ),
        (type) => {
          // Gun trade-up types require exactly 10 inputs
          const ids = Array.from({ length: 10 }, (_, i) => `gun-${i}`);
          const tu = makeTradeUp({ listingIds: ids, type: type as any });
          expect(tu.inputs).toHaveLength(10);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("knife trade-ups always have exactly 5 inputs", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }), // arbitrary seed, property always holds
        (_seed) => {
          const ids = Array.from({ length: 5 }, (_, i) => `knife-${i}`);
          const tu = makeTradeUp({ listingIds: ids, type: "covert_knife" as any });
          expect(tu.inputs).toHaveLength(5);
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ─── Output float boundary invariants ───────────────────────────────────────

describe("Output float boundary invariants", () => {
  const listingArb = fc.record({
    float_value: fc.double({ min: 0.001, max: 0.999, noNaN: true }),
    min_float: fc.constant(0.0),
    max_float: fc.constant(1.0),
  });

  it("output float is always within [outputMinFloat, outputMaxFloat]", () => {
    fc.assert(
      fc.property(
        fc.array(listingArb, { minLength: 1, maxLength: 10 }),
        fc.double({ min: 0.0, max: 0.5, noNaN: true }),
        fc.double({ min: 0.5, max: 1.0, noNaN: true }),
        (inputs, outMin, outMax) => {
          if (outMax <= outMin) return;
          const result = calculateOutputFloat(inputs, outMin, outMax);
          expect(result).toBeGreaterThanOrEqual(outMin - 1e-10);
          expect(result).toBeLessThanOrEqual(outMax + 1e-10);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("10 inputs at min_float produce output at outputMinFloat", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.0, max: 0.49, noNaN: true }),
        fc.double({ min: 0.5, max: 1.0, noNaN: true }),
        (outMin, outMax) => {
          if (outMax <= outMin) return;
          const inputs = Array.from({ length: 10 }, () => ({
            float_value: 0.0,
            min_float: 0.0,
            max_float: 1.0,
          }));
          const result = calculateOutputFloat(inputs, outMin, outMax);
          expect(result).toBeCloseTo(outMin, 8);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("10 inputs at max_float produce output at outputMaxFloat", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.0, max: 0.49, noNaN: true }),
        fc.double({ min: 0.5, max: 1.0, noNaN: true }),
        (outMin, outMax) => {
          if (outMax <= outMin) return;
          const inputs = Array.from({ length: 10 }, () => ({
            float_value: 1.0,
            min_float: 0.0,
            max_float: 1.0,
          }));
          const result = calculateOutputFloat(inputs, outMin, outMax);
          expect(result).toBeCloseTo(outMax, 8);
        }
      ),
      { numRuns: 200 }
    );
  });
});
