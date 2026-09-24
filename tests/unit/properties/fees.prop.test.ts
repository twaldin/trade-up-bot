/**
 * Property-based tests for storedInputCost — the single conversion from a raw
 * marketplace listing price to the stored trade-up input cost.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { effectiveBuyCost, effectiveBuyCostRaw, storedInputCost } from "../../../server/engine/fees.js";
import { makeListing } from "../../helpers/fixtures.js";

const sources = fc.constantFrom("csfloat", "dmarket", "skinport", "buff", "calculator", "unknown");
const rawPrice = fc.integer({ min: 1, max: 10_000_000 });

describe("storedInputCost properties", () => {
  it("is integer cents and never below the raw listing price", () => {
    fc.assert(
      fc.property(rawPrice, sources, (raw, source) => {
        const stored = storedInputCost(raw, source);
        expect(Number.isInteger(stored)).toBe(true);
        expect(stored).toBeGreaterThanOrEqual(raw);
      }),
      { numRuns: 500 }
    );
  });

  it("matches the discovery conversion (effectiveBuyCost) for every source", () => {
    fc.assert(
      fc.property(rawPrice, sources, (raw, source) => {
        expect(storedInputCost(raw, source)).toBe(effectiveBuyCost(makeListing({ price_cents: raw, source })));
        expect(storedInputCost(raw, source)).toBe(effectiveBuyCostRaw(raw, source));
      }),
      { numRuns: 500 }
    );
  });

  it("is strictly above raw for fee-charging marketplaces at every realistic price", () => {
    // DMarket's 2.5% rounds away at 20¢ and below (20 * 1.025 is 20.4999… in floating point).
    fc.assert(
      fc.property(fc.integer({ min: 21, max: 10_000_000 }), fc.constantFrom("csfloat", "dmarket", "buff"), (raw, source) => {
        expect(storedInputCost(raw, source)).toBeGreaterThan(raw);
      }),
      { numRuns: 500 }
    );
  });

  it("is monotonic in the raw price", () => {
    fc.assert(
      fc.property(rawPrice, fc.integer({ min: 0, max: 100_000 }), sources, (raw, delta, source) => {
        expect(storedInputCost(raw + delta, source)).toBeGreaterThanOrEqual(storedInputCost(raw, source));
      }),
      { numRuns: 500 }
    );
  });
});
