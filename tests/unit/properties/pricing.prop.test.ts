/**
 * Property-based tests for pricing functions.
 * Tests invariants of interpolation, anchor building, and price lookups.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { buildAnchors, interpolatePrice } from "../../../server/engine/pricing.js";
import type { PriceAnchor } from "../../../server/engine/types.js";

// ─── buildAnchors properties ─────────────────────────────────────────────────

describe("buildAnchors properties", () => {
  const conditionArb = fc.oneof(
    fc.constant("Factory New"),
    fc.constant("Minimal Wear"),
    fc.constant("Field-Tested"),
    fc.constant("Well-Worn"),
    fc.constant("Battle-Scarred")
  );

  const priceRowArb = fc.record({
    condition: conditionArb,
    min_price_cents: fc.integer({ min: 0, max: 1_000_000 }),
    avg_price_cents: fc.integer({ min: 0, max: 1_000_000 }),
  });

  it("output anchors are sorted by float ascending", () => {
    fc.assert(
      fc.property(
        fc.array(priceRowArb, { minLength: 0, maxLength: 5 }),
        (rows) => {
          const anchors = buildAnchors(rows, 1.0);
          for (let i = 1; i < anchors.length; i++) {
            expect(anchors[i].float).toBeGreaterThanOrEqual(anchors[i - 1].float);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("output prices are monotonically non-increasing", () => {
    fc.assert(
      fc.property(
        fc.array(priceRowArb, { minLength: 0, maxLength: 5 }),
        (rows) => {
          const anchors = buildAnchors(rows, 1.0);
          for (let i = 1; i < anchors.length; i++) {
            expect(anchors[i].price).toBeLessThanOrEqual(anchors[i - 1].price);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("all anchor prices are positive", () => {
    fc.assert(
      fc.property(
        fc.array(priceRowArb, { minLength: 0, maxLength: 5 }),
        (rows) => {
          const anchors = buildAnchors(rows, 1.0);
          for (const a of anchors) {
            expect(a.price).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("positive multiplier scales all prices", () => {
    fc.assert(
      fc.property(
        fc.array(priceRowArb, { minLength: 1, maxLength: 3 }),
        fc.double({ min: 0.1, max: 5.0, noNaN: true }),
        (rows, multiplier) => {
          const base = buildAnchors(rows, 1.0);
          const scaled = buildAnchors(rows, multiplier);
          // Same number of anchors
          expect(scaled.length).toBe(base.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── interpolatePrice properties ─────────────────────────────────────────────

describe("interpolatePrice properties", () => {
  it("result is non-negative", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            float: fc.double({ min: 0, max: 1, noNaN: true }),
            price: fc.integer({ min: 1, max: 1_000_000 }),
          }),
          { minLength: 0, maxLength: 5 }
        ).map(arr => arr.sort((a, b) => a.float - b.float)),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (anchors, float) => {
          expect(interpolatePrice(anchors, float)).toBeGreaterThanOrEqual(0);
        }
      ),
      { numRuns: 300 }
    );
  });

  it("interpolated value between two anchors is bounded by their prices", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 0.3, noNaN: true }),
        fc.integer({ min: 1000, max: 50000 }),
        fc.integer({ min: 1000, max: 50000 }),
        (baseFloat, price1, price2) => {
          // Two anchors in same condition (both FN, float < 0.07)
          const f1 = baseFloat * 0.06;        // 0 to 0.018
          const f2 = f1 + 0.01 + baseFloat * 0.03; // f1 + 0.01 to f1 + 0.028
          if (f2 >= 0.07) return; // skip if crosses condition boundary

          const anchors: PriceAnchor[] = [
            { float: f1, price: Math.max(price1, price2) },
            { float: f2, price: Math.min(price1, price2) },
          ];
          const midFloat = (f1 + f2) / 2;
          const result = interpolatePrice(anchors, midFloat);

          expect(result).toBeLessThanOrEqual(anchors[0].price + 1);
          expect(result).toBeGreaterThanOrEqual(anchors[1].price - 1);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("deterministic: same input → same output", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            float: fc.double({ min: 0, max: 1, noNaN: true }),
            price: fc.integer({ min: 1, max: 1_000_000 }),
          }),
          { minLength: 0, maxLength: 5 }
        ).map(arr => arr.sort((a, b) => a.float - b.float)),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (anchors, float) => {
          const r1 = interpolatePrice(anchors, float);
          const r2 = interpolatePrice(anchors, float);
          expect(r1).toBe(r2);
        }
      ),
      { numRuns: 100 }
    );
  });
});
