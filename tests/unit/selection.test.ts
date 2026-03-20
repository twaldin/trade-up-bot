import { describe, it, expect } from "vitest";
import {
  addAdjustedFloat,
  getConditionTransitions,
  selectForFloatTarget,
  selectLowestFloat,
} from "../../server/engine/selection.js";
import { makeListing, makeOutcome } from "../helpers/fixtures.js";
import type { AdjustedListing } from "../../server/engine/types.js";

// ─── addAdjustedFloat ────────────────────────────────────────────────────────

describe("addAdjustedFloat", () => {
  it("normalizes float to [0,1] within skin range", () => {
    const listings = [makeListing({ float_value: 0.25, min_float: 0.0, max_float: 0.5 })];
    const result = addAdjustedFloat(listings);
    expect(result[0].adjustedFloat).toBeCloseTo(0.5, 10);
  });

  it("float at min → adjustedFloat = 0", () => {
    const listings = [makeListing({ float_value: 0.06, min_float: 0.06, max_float: 0.80 })];
    const result = addAdjustedFloat(listings);
    expect(result[0].adjustedFloat).toBeCloseTo(0, 10);
  });

  it("float at max → adjustedFloat = 1", () => {
    const listings = [makeListing({ float_value: 0.80, min_float: 0.06, max_float: 0.80 })];
    const result = addAdjustedFloat(listings);
    expect(result[0].adjustedFloat).toBeCloseTo(1, 10);
  });

  it("zero-range skin → adjustedFloat = 0", () => {
    const listings = [makeListing({ float_value: 0.5, min_float: 0.5, max_float: 0.5 })];
    const result = addAdjustedFloat(listings);
    expect(result[0].adjustedFloat).toBe(0);
  });

  it("preserves all original listing fields", () => {
    const listings = [makeListing({ id: "test-id", price_cents: 999 })];
    const result = addAdjustedFloat(listings);
    expect(result[0].id).toBe("test-id");
    expect(result[0].price_cents).toBe(999);
  });
});

// ─── getConditionTransitions ─────────────────────────────────────────────────

describe("getConditionTransitions", () => {
  it("returns sorted unique float targets", () => {
    const outcomes = [makeOutcome({ min_float: 0.0, max_float: 1.0 })];
    const result = getConditionTransitions(outcomes);
    for (let i = 1; i < result.length; i++) {
      expect(result[i]).toBeGreaterThan(result[i - 1]);
    }
  });

  it("includes fixed coverage targets", () => {
    const outcomes = [makeOutcome({ min_float: 0.0, max_float: 1.0 })];
    const result = getConditionTransitions(outcomes);
    // Should include some of the fixed targets
    expect(result).toContain(0.01);
    expect(result).toContain(0.05);
  });

  it("includes condition boundary-derived targets", () => {
    // With range 0-1, boundaries at 0.07, 0.15, 0.38, 0.45
    // Transition at t = (boundary - min) / range, then t - 0.002
    const outcomes = [makeOutcome({ min_float: 0.0, max_float: 1.0 })];
    const result = getConditionTransitions(outcomes);
    // Should have targets near condition boundaries
    expect(result.some(t => Math.abs(t - 0.068) < 0.005)).toBe(true);
    expect(result.some(t => Math.abs(t - 0.148) < 0.005)).toBe(true);
  });

  it("all values between 0 and 1 (exclusive, inclusive)", () => {
    const outcomes = [
      makeOutcome({ min_float: 0.06, max_float: 0.80 }),
      makeOutcome({ min_float: 0.0, max_float: 0.45 }),
    ];
    const result = getConditionTransitions(outcomes);
    for (const t of result) {
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThanOrEqual(1.0);
    }
  });

  it("zero-range outcome contributes no transition points", () => {
    const outcomes = [makeOutcome({ min_float: 0.5, max_float: 0.5 })];
    const result = getConditionTransitions(outcomes);
    // Should still have fixed coverage targets
    expect(result.length).toBeGreaterThan(0);
  });
});

// ─── selectForFloatTarget ────────────────────────────────────────────────────

describe("selectForFloatTarget", () => {
  function makePool(
    colName: string,
    count: number,
    floatStart: number = 0.1,
    priceStart: number = 500
  ): AdjustedListing[] {
    return Array.from({ length: count }, (_, i) => ({
      ...makeListing({
        id: `${colName}-${i}`,
        collection_name: colName,
        float_value: floatStart + i * 0.01,
        price_cents: priceStart + i * 10,
        min_float: 0,
        max_float: 1,
      }),
      adjustedFloat: floatStart + i * 0.01,
    }));
  }

  it("selects cheapest listings within float budget", () => {
    const byCol = new Map([["Col A", makePool("Col A", 20)]]);
    const quotas = new Map([["Col A", 10]]);
    const result = selectForFloatTarget(byCol, quotas, 0.5, 10);
    expect(result).not.toBeNull();
    expect(result!).toHaveLength(10);
    // Average adjusted float should be within budget
    const avgFloat = result!.reduce((s, l) => s + l.adjustedFloat, 0) / result!.length;
    expect(avgFloat).toBeLessThanOrEqual(0.5);
  });

  it("returns null when collection has too few listings", () => {
    const byCol = new Map([["Col A", makePool("Col A", 3)]]);
    const quotas = new Map([["Col A", 10]]);
    const result = selectForFloatTarget(byCol, quotas, 0.5, 10);
    expect(result).toBeNull();
  });

  it("returns null when float budget too tight", () => {
    // All listings have adjustedFloat >= 0.1, budget only allows avg of 0.001
    const byCol = new Map([["Col A", makePool("Col A", 20, 0.5)]]);
    const quotas = new Map([["Col A", 10]]);
    const result = selectForFloatTarget(byCol, quotas, 0.001, 10);
    expect(result).toBeNull();
  });

  it("respects per-collection quotas", () => {
    const byCol = new Map([
      ["Col A", makePool("Col A", 15, 0.05, 100)],
      ["Col B", makePool("Col B", 15, 0.05, 100)],
    ]);
    const quotas = new Map([["Col A", 6], ["Col B", 4]]);
    const result = selectForFloatTarget(byCol, quotas, 0.5, 10);
    expect(result).not.toBeNull();
    const colACnt = result!.filter(l => l.collection_name === "Col A").length;
    const colBCnt = result!.filter(l => l.collection_name === "Col B").length;
    expect(colACnt).toBe(6);
    expect(colBCnt).toBe(4);
  });

  it("no duplicate listings in result", () => {
    const byCol = new Map([["Col A", makePool("Col A", 20)]]);
    const quotas = new Map([["Col A", 10]]);
    const result = selectForFloatTarget(byCol, quotas, 0.5, 10);
    expect(result).not.toBeNull();
    const ids = result!.map(l => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ─── selectLowestFloat ───────────────────────────────────────────────────────

describe("selectLowestFloat", () => {
  function makePool(colName: string, n: number, baseFloat: number = 0.1): AdjustedListing[] {
    return Array.from({ length: n }, (_, i) => ({
      ...makeListing({
        id: `${colName}-${i}`,
        collection_name: colName,
        float_value: baseFloat + i * 0.02,
        price_cents: 500 + i * 100,
        min_float: 0,
        max_float: 1,
      }),
      adjustedFloat: baseFloat + i * 0.02,
    }));
  }

  it("selects lowest-float listings per collection", () => {
    const pool = makePool("Col A", 20, 0.05);
    const byCol = new Map([["Col A", pool]]);
    const quotas = new Map([["Col A", 5]]);
    const result = selectLowestFloat(byCol, quotas, 5);
    expect(result).not.toBeNull();
    // Should pick the 5 with lowest adjustedFloat
    const floats = result!.map(l => l.adjustedFloat);
    for (let i = 1; i < floats.length; i++) {
      expect(floats[i]).toBeGreaterThanOrEqual(floats[i - 1]);
    }
    expect(floats[floats.length - 1]).toBeLessThanOrEqual(pool[4].adjustedFloat);
  });

  it("returns null when not enough listings", () => {
    const byCol = new Map([["Col A", makePool("Col A", 2)]]);
    const quotas = new Map([["Col A", 5]]);
    expect(selectLowestFloat(byCol, quotas, 5)).toBeNull();
  });

  it("respects multi-collection quotas", () => {
    const byCol = new Map([
      ["Col A", makePool("Col A", 10)],
      ["Col B", makePool("Col B", 10)],
    ]);
    const quotas = new Map([["Col A", 3], ["Col B", 2]]);
    const result = selectLowestFloat(byCol, quotas, 5);
    expect(result).not.toBeNull();
    expect(result!.filter(l => l.collection_name === "Col A")).toHaveLength(3);
    expect(result!.filter(l => l.collection_name === "Col B")).toHaveLength(2);
  });

  it("no duplicate listings", () => {
    const byCol = new Map([["Col A", makePool("Col A", 20)]]);
    const quotas = new Map([["Col A", 10]]);
    const result = selectLowestFloat(byCol, quotas, 10);
    expect(result).not.toBeNull();
    const ids = new Set(result!.map(l => l.id));
    expect(ids.size).toBe(10);
  });
});
