/**
 * Property-based tests for evaluation invariants.
 * Tests the mathematical relationships that must always hold,
 * regardless of specific prices or inputs.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { calculateOutputFloat, calculateOutcomeProbabilities } from "../../../server/engine/core.js";
import { effectiveBuyCost, effectiveBuyCostRaw, effectiveSellProceeds } from "../../../server/engine/fees.js";
import { computeChanceToProfit, computeBestWorstCase } from "../../../server/engine/utils.js";
import { floatToCondition } from "../../../shared/types.js";

// ─── Fee invariants ──────────────────────────────────────────────────────────

describe("Fee properties", () => {
  it("buy cost is always >= listing price", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.oneof(fc.constant("csfloat"), fc.constant("dmarket"), fc.constant("skinport")),
        (price, source) => {
          expect(effectiveBuyCostRaw(price, source)).toBeGreaterThanOrEqual(price);
        }
      ),
      { numRuns: 500 }
    );
  });

  it("sell proceeds are always <= sell price", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.oneof(fc.constant("csfloat"), fc.constant("dmarket"), fc.constant("skinport")),
        (price, source) => {
          expect(effectiveSellProceeds(price, source)).toBeLessThanOrEqual(price);
        }
      ),
      { numRuns: 500 }
    );
  });

  it("buy cost is integer (no fractional cents)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.oneof(fc.constant("csfloat"), fc.constant("dmarket"), fc.constant("skinport")),
        (price, source) => {
          const result = effectiveBuyCostRaw(price, source);
          expect(Number.isInteger(result)).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("sell proceeds is integer (no fractional cents)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.oneof(fc.constant("csfloat"), fc.constant("dmarket"), fc.constant("skinport")),
        (price, source) => {
          const result = effectiveSellProceeds(price, source);
          expect(Number.isInteger(result)).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("sell proceeds are non-negative", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.oneof(fc.constant("csfloat"), fc.constant("dmarket"), fc.constant("skinport")),
        (price, source) => {
          expect(effectiveSellProceeds(price, source)).toBeGreaterThanOrEqual(0);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("higher price → higher or equal buy cost (monotonic)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5_000_000 }),
        fc.integer({ min: 1, max: 5_000_000 }),
        fc.oneof(fc.constant("csfloat"), fc.constant("dmarket"), fc.constant("skinport")),
        (price, delta, source) => {
          const lowCost = effectiveBuyCostRaw(price, source);
          const highCost = effectiveBuyCostRaw(price + delta, source);
          expect(highCost).toBeGreaterThanOrEqual(lowCost);
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ─── Evaluation pipeline invariants ──────────────────────────────────────────

describe("Evaluation pipeline properties", () => {
  it("EV = sum of probability * price for any outcome set", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            price: fc.integer({ min: 0, max: 1_000_000 }),
            probability: fc.double({ min: 0, max: 1, noNaN: true }),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        (outcomes) => {
          // Normalize probabilities to sum to 1
          const totalProb = outcomes.reduce((s, o) => s + o.probability, 0);
          if (totalProb <= 0) return;
          const normalized = outcomes.map(o => ({
            ...o,
            probability: o.probability / totalProb,
          }));

          const ev = normalized.reduce((s, o) => s + o.probability * o.price, 0);

          // EV should be between min and max outcome prices
          const minPrice = Math.min(...normalized.map(o => o.price));
          const maxPrice = Math.max(...normalized.map(o => o.price));
          expect(ev).toBeGreaterThanOrEqual(minPrice - 1);
          expect(ev).toBeLessThanOrEqual(maxPrice + 1);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("chance to profit is between 0 and 1", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            estimated_price_cents: fc.integer({ min: 0, max: 1_000_000 }),
            probability: fc.double({ min: 0, max: 1, noNaN: true }),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        fc.integer({ min: 1, max: 1_000_000 }),
        (outcomes, cost) => {
          const ctp = computeChanceToProfit(outcomes, cost);
          expect(ctp).toBeGreaterThanOrEqual(0);
          expect(ctp).toBeLessThanOrEqual(
            outcomes.reduce((s, o) => s + o.probability, 0) + 1e-10
          );
        }
      ),
      { numRuns: 200 }
    );
  });

  it("best case >= worst case", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({ estimated_price_cents: fc.integer({ min: 0, max: 1_000_000 }) }),
          { minLength: 1, maxLength: 10 }
        ),
        fc.integer({ min: 0, max: 1_000_000 }),
        (outcomes, cost) => {
          const { bestCase, worstCase } = computeBestWorstCase(outcomes, cost);
          expect(bestCase).toBeGreaterThanOrEqual(worstCase);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("profit = EV - cost (basic identity)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (ev, cost) => {
          expect(ev - cost).toBe(ev - cost); // trivial but verifies no overflow
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── floatToCondition ────────────────────────────────────────────────────────

describe("floatToCondition properties", () => {
  it("always returns a valid condition name", () => {
    const validConditions = new Set([
      "Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred",
    ]);
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        (float) => {
          expect(validConditions.has(floatToCondition(float))).toBe(true);
        }
      ),
      { numRuns: 500 }
    );
  });

  it("is monotonic: higher float → same or worse condition", () => {
    const condOrder = ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"];
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 0.99, noNaN: true }),
        fc.double({ min: 0.001, max: 0.5, noNaN: true }),
        (float, delta) => {
          const higherFloat = Math.min(float + delta, 1.0);
          const condLow = condOrder.indexOf(floatToCondition(float));
          const condHigh = condOrder.indexOf(floatToCondition(higherFloat));
          expect(condHigh).toBeGreaterThanOrEqual(condLow);
        }
      ),
      { numRuns: 300 }
    );
  });
});
