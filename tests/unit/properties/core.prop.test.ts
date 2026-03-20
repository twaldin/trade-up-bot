/**
 * Property-based tests for core float calculations.
 * These test invariants that must hold for ANY valid input, not specific examples.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { calculateOutputFloat, calculateOutcomeProbabilities } from "../../../server/engine/core.js";
import type { ListingWithCollection, DbSkinOutcome } from "../../../server/engine/types.js";

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const floatRange = () =>
  fc.record({
    min: fc.double({ min: 0, max: 0.99, noNaN: true }),
    max: fc.double({ min: 0.01, max: 1.0, noNaN: true }),
  }).filter(r => r.max > r.min + 0.001);

const floatInput = () =>
  floatRange().chain(range =>
    fc.record({
      float_value: fc.double({ min: range.min, max: range.max, noNaN: true }),
      min_float: fc.constant(range.min),
      max_float: fc.constant(range.max),
    })
  );

// ─── calculateOutputFloat properties ─────────────────────────────────────────

describe("calculateOutputFloat properties", () => {
  it("output is always within [outputMin, outputMax]", () => {
    fc.assert(
      fc.property(
        fc.array(floatInput(), { minLength: 1, maxLength: 10 }),
        floatRange(),
        (inputs, outRange) => {
          const result = calculateOutputFloat(inputs, outRange.min, outRange.max);
          expect(result).toBeGreaterThanOrEqual(outRange.min - 1e-10);
          expect(result).toBeLessThanOrEqual(outRange.max + 1e-10);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("all inputs at min → output at outputMin", () => {
    fc.assert(
      fc.property(
        floatRange(),
        floatRange(),
        fc.integer({ min: 1, max: 10 }),
        (inRange, outRange, count) => {
          const inputs = Array.from({ length: count }, () => ({
            float_value: inRange.min,
            min_float: inRange.min,
            max_float: inRange.max,
          }));
          const result = calculateOutputFloat(inputs, outRange.min, outRange.max);
          expect(result).toBeCloseTo(outRange.min, 5);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("all inputs at max → output at outputMax", () => {
    fc.assert(
      fc.property(
        floatRange(),
        floatRange(),
        fc.integer({ min: 1, max: 10 }),
        (inRange, outRange, count) => {
          const inputs = Array.from({ length: count }, () => ({
            float_value: inRange.max,
            min_float: inRange.min,
            max_float: inRange.max,
          }));
          const result = calculateOutputFloat(inputs, outRange.min, outRange.max);
          expect(result).toBeCloseTo(outRange.max, 5);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("identical inputs produce same result regardless of count", () => {
    fc.assert(
      fc.property(
        floatInput(),
        floatRange(),
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1, max: 10 }),
        (input, outRange, count1, count2) => {
          const inputs1 = Array.from({ length: count1 }, () => ({ ...input }));
          const inputs2 = Array.from({ length: count2 }, () => ({ ...input }));
          const r1 = calculateOutputFloat(inputs1, outRange.min, outRange.max);
          const r2 = calculateOutputFloat(inputs2, outRange.min, outRange.max);
          expect(r1).toBeCloseTo(r2, 8);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("output is deterministic (same inputs → same output)", () => {
    fc.assert(
      fc.property(
        fc.array(floatInput(), { minLength: 1, maxLength: 10 }),
        floatRange(),
        (inputs, outRange) => {
          const r1 = calculateOutputFloat(inputs, outRange.min, outRange.max);
          const r2 = calculateOutputFloat(inputs, outRange.min, outRange.max);
          expect(r1).toBe(r2);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("higher average input float → higher or equal output float", () => {
    fc.assert(
      fc.property(
        floatRange(),
        floatRange(),
        fc.integer({ min: 2, max: 10 }),
        (inRange, outRange, count) => {
          const lowInputs = Array.from({ length: count }, () => ({
            float_value: inRange.min + (inRange.max - inRange.min) * 0.2,
            min_float: inRange.min,
            max_float: inRange.max,
          }));
          const highInputs = Array.from({ length: count }, () => ({
            float_value: inRange.min + (inRange.max - inRange.min) * 0.8,
            min_float: inRange.min,
            max_float: inRange.max,
          }));
          const lowResult = calculateOutputFloat(lowInputs, outRange.min, outRange.max);
          const highResult = calculateOutputFloat(highInputs, outRange.min, outRange.max);
          expect(highResult).toBeGreaterThanOrEqual(lowResult - 1e-10);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── calculateOutcomeProbabilities properties ────────────────────────────────

describe("calculateOutcomeProbabilities properties", () => {
  function makeInputArb() {
    return fc.record({
      id: fc.string({ minLength: 1, maxLength: 10 }),
      skin_id: fc.constant("skin-1"),
      skin_name: fc.constant("Test Skin"),
      weapon: fc.constant("AK-47"),
      price_cents: fc.integer({ min: 100, max: 100000 }),
      float_value: fc.double({ min: 0, max: 1, noNaN: true }),
      paint_seed: fc.constant(null),
      stattrak: fc.constant(false),
      min_float: fc.constant(0),
      max_float: fc.constant(1),
      rarity: fc.constant("Classified"),
      source: fc.constant("csfloat"),
      collection_id: fc.oneof(fc.constant("col-1"), fc.constant("col-2"), fc.constant("col-3")),
      collection_name: fc.constant(""), // will be derived
    }).map(inp => ({ ...inp, collection_name: `Collection ${inp.collection_id}` })) as fc.Arbitrary<ListingWithCollection>;
  }

  function makeOutcomeArb() {
    return fc.record({
      id: fc.string({ minLength: 1, maxLength: 10 }),
      name: fc.string({ minLength: 1, maxLength: 20 }),
      weapon: fc.constant("AK-47"),
      min_float: fc.constant(0),
      max_float: fc.constant(1),
      rarity: fc.constant("Covert"),
      collection_id: fc.oneof(fc.constant("col-1"), fc.constant("col-2"), fc.constant("col-3")),
      collection_name: fc.constant(""),
    }).map(o => ({ ...o, collection_name: `Collection ${o.collection_id}` })) as fc.Arbitrary<DbSkinOutcome>;
  }

  it("probabilities always sum to exactly 1.0 when result is non-empty", () => {
    fc.assert(
      fc.property(
        fc.array(makeInputArb(), { minLength: 1, maxLength: 10 }),
        fc.array(makeOutcomeArb(), { minLength: 1, maxLength: 5 }),
        (inputs, outcomes) => {
          const result = calculateOutcomeProbabilities(inputs, outcomes);
          if (result.length === 0) return; // invalid combo or no matches — ok
          const total = result.reduce((s, r) => s + r.probability, 0);
          expect(total).toBeCloseTo(1.0, 8);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("returns empty when any input collection has no matching outcome", () => {
    fc.assert(
      fc.property(
        fc.array(makeInputArb(), { minLength: 1, maxLength: 10 }),
        (inputs) => {
          // Create outcomes that only cover col-1, ensuring some inputs are from col-2 or col-3
          const inputCollections = new Set(inputs.map(i => i.collection_id));
          if (inputCollections.size <= 1) return; // need 2+ collections for this test

          // Only provide outcomes for the first collection
          const firstCol = [...inputCollections][0];
          const partialOutcomes: DbSkinOutcome[] = [{
            id: "o1", name: "Test Output", weapon: "AK-47",
            min_float: 0, max_float: 1, rarity: "Covert",
            collection_id: firstCol, collection_name: `Collection ${firstCol}`,
          }];

          const result = calculateOutcomeProbabilities(inputs, partialOutcomes);
          // Should be empty because not all input collections have outcomes
          expect(result).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("all probabilities are non-negative", () => {
    fc.assert(
      fc.property(
        fc.array(makeInputArb(), { minLength: 1, maxLength: 10 }),
        fc.array(makeOutcomeArb(), { minLength: 1, maxLength: 5 }),
        (inputs, outcomes) => {
          const result = calculateOutcomeProbabilities(inputs, outcomes);
          for (const r of result) {
            expect(r.probability).toBeGreaterThanOrEqual(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("no probability exceeds 1.0", () => {
    fc.assert(
      fc.property(
        fc.array(makeInputArb(), { minLength: 1, maxLength: 10 }),
        fc.array(makeOutcomeArb(), { minLength: 1, maxLength: 5 }),
        (inputs, outcomes) => {
          const result = calculateOutcomeProbabilities(inputs, outcomes);
          for (const r of result) {
            expect(r.probability).toBeLessThanOrEqual(1.0 + 1e-10);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("outcome from collection with no inputs is excluded", () => {
    fc.assert(
      fc.property(
        fc.array(makeInputArb(), { minLength: 1, maxLength: 10 }),
        (inputs) => {
          const orphanOutcome: DbSkinOutcome = {
            id: "orphan", name: "Orphan", weapon: "M4A4",
            min_float: 0, max_float: 1, rarity: "Covert",
            collection_id: "col-orphan", collection_name: "Orphan Collection",
          };
          const result = calculateOutcomeProbabilities(inputs, [orphanOutcome]);
          expect(result.length).toBe(0);
        }
      ),
      { numRuns: 50 }
    );
  });

  it("empty inputs → empty result", () => {
    const outcome: DbSkinOutcome = {
      id: "o1", name: "Test", weapon: "AK-47",
      min_float: 0, max_float: 1, rarity: "Covert",
      collection_id: "col-1", collection_name: "Collection col-1",
    };
    expect(calculateOutcomeProbabilities([], [outcome])).toHaveLength(0);
  });
});
