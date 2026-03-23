import { describe, it, expect, beforeEach } from "vitest";
import * as fc from "fast-check";
import { computeMADClampBounds } from "../../../server/engine/knn-pricing.js";
import { applyMonotonicityGuard, priceCache } from "../../../server/engine/pricing.js";

describe("computeMADClampBounds properties", () => {
  it("upper bound is always >= median", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 2, maxLength: 20 }),
        (prices) => {
          const bounds = computeMADClampBounds(prices);
          if (bounds === null) return true; // MAD=0, all identical — skip
          const sorted = [...prices].sort((a, b) => a - b);
          const median = sorted[Math.floor(sorted.length / 2)];
          return bounds.upper >= median;
        }
      )
    );
  });

  it("lower bound is always <= median", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 2, maxLength: 20 }),
        (prices) => {
          const bounds = computeMADClampBounds(prices);
          if (bounds === null) return true;
          const sorted = [...prices].sort((a, b) => a - b);
          const median = sorted[Math.floor(sorted.length / 2)];
          return bounds.lower <= median;
        }
      )
    );
  });

  it("lower bound is always >= 0", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 2, maxLength: 20 }),
        (prices) => {
          const bounds = computeMADClampBounds(prices);
          if (bounds === null) return true;
          return bounds.lower >= 0;
        }
      )
    );
  });

  it("clamping never changes the median value itself", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 3, maxLength: 20 }),
        (prices) => {
          const bounds = computeMADClampBounds(prices);
          if (bounds === null) return true;
          const sorted = [...prices].sort((a, b) => a - b);
          const median = sorted[Math.floor(sorted.length / 2)];
          const clamped = Math.min(Math.max(median, bounds.lower), bounds.upper);
          return clamped === median;
        }
      )
    );
  });
});

describe("applyMonotonicityGuard properties", () => {
  beforeEach(() => {
    priceCache.clear();
  });

  it("output is never higher than input", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (grossPrice, betterPrice) => {
          priceCache.set("TestSkin:Well-Worn", betterPrice);
          const result = applyMonotonicityGuard(grossPrice, "TestSkin", 0.55); // BS
          return result <= grossPrice;
        }
      )
    );
  });

  it("output never exceeds better condition price when it exists", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (grossPrice, betterPrice) => {
          priceCache.set("TestSkin:Well-Worn", betterPrice);
          const result = applyMonotonicityGuard(grossPrice, "TestSkin", 0.55);
          return result <= betterPrice || grossPrice <= betterPrice;
        }
      )
    );
  });
});
