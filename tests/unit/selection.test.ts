import { describe, it, expect } from "vitest";
import {
  addAdjustedFloat,
  getConditionTransitions,
  selectForFloatTarget,
  selectLowestFloat,
  selectKnapsackUnderBoundary,
} from "../../server/engine/selection.js";
import { makeListing, makeOutcome, makeAdjustedListing } from "../helpers/fixtures.js";
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

// ─── selectForFloatTarget — id-keyed quotas (gun-tier regression, Lever A) ───

describe("selectForFloatTarget with id-keyed quotas (gun tiers)", () => {
  // Gun tiers materialize byCol/quotas keyed by collection_id, which differs
  // from each listing's collection_name. This guards the silent key-mismatch
  // bug that disabled float-targeting on ~1M gun-tier trade-ups: the greedy
  // picker read l.collection_name while quotas were id-keyed → 0 quota → null.
  function makeIdKeyedPool(colId: string, colName: string, count: number): AdjustedListing[] {
    return Array.from({ length: count }, (_, i) =>
      makeAdjustedListing({
        id: `${colId}-${i}`,
        collection_id: colId,
        collection_name: colName,
        float_value: 0.05 + i * 0.01,
        price_cents: 500 + i * 10,
        min_float: 0,
        max_float: 1,
      })
    );
  }

  it("selects listings when quotas are keyed by collection_id (≠ collection_name)", () => {
    const byCol = new Map([["col-123", makeIdKeyedPool("col-123", "Fever", 20)]]);
    const quotas = new Map([["col-123", 10]]);
    const result = selectForFloatTarget(byCol, quotas, 0.5, 10);
    expect(result).not.toBeNull();
    expect(result!).toHaveLength(10);
    expect(result!.every(l => l.collection_id === "col-123")).toBe(true);
  });

  it("respects multi-collection id-keyed quotas", () => {
    const byCol = new Map([
      ["col-1", makeIdKeyedPool("col-1", "Alpha", 15)],
      ["col-2", makeIdKeyedPool("col-2", "Beta", 15)],
    ]);
    const quotas = new Map([["col-1", 6], ["col-2", 4]]);
    const result = selectForFloatTarget(byCol, quotas, 0.5, 10);
    expect(result).not.toBeNull();
    expect(result!.filter(l => l.collection_id === "col-1")).toHaveLength(6);
    expect(result!.filter(l => l.collection_id === "col-2")).toHaveLength(4);
  });

  it("still honors the float budget under id-keyed quotas", () => {
    const byCol = new Map([["col-x", makeIdKeyedPool("col-x", "Xenon", 20)]]);
    const quotas = new Map([["col-x", 10]]);
    const result = selectForFloatTarget(byCol, quotas, 0.5, 10);
    expect(result).not.toBeNull();
    const avgFloat = result!.reduce((s, l) => s + l.adjustedFloat, 0) / result!.length;
    expect(avgFloat).toBeLessThanOrEqual(0.5);
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

// ─── selectKnapsackUnderBoundary (E3: boundary-knapsack) ─────────────────────

describe("selectKnapsackUnderBoundary", () => {
  const mk = (id: string, price: number, adjFloat: number, col = "colA"): AdjustedListing =>
    makeAdjustedListing({ id, price_cents: price, adjustedFloat: adjFloat, collection_id: col });
  const sumFloat = (xs: AdjustedListing[]) => xs.reduce((s, l) => s + l.adjustedFloat, 0);
  const sumCost = (xs: AdjustedListing[]) => xs.reduce((s, l) => s + l.price_cents, 0);

  it("returns count items within the float budget (basic)", () => {
    const pool = Array.from({ length: 12 }, (_, i) => mk(`a${i}`, 100 + i, 0.05));
    const byCol = new Map([["colA", pool]]);
    const quotas = new Map([["colA", 10]]);
    const res = selectKnapsackUnderBoundary(byCol, quotas, 0.05, 10); // budget 0.50
    expect(res).not.toBeNull();
    expect(res!).toHaveLength(10);
    expect(sumFloat(res!)).toBeLessThanOrEqual(0.5 + 1e-9);
  });

  it("recovers a feasible low-float set that the price-greedy misses (additive)", () => {
    // budget 0.30: ten low-float-but-pricey items + two cheap-but-high-float ones.
    const good = Array.from({ length: 10 }, (_, i) => mk(`g${i}`, 100, 0.02)); // sum 0.20
    const cheapHigh = [mk("c0", 10, 0.15), mk("c1", 10, 0.15)];
    const byCol = new Map([["colA", [...cheapHigh, ...good]]]);
    const quotas = new Map([["colA", 10]]);

    // Price-greedy grabs the two cheap-high items first, then can't fit 8 more → null.
    expect(selectForFloatTarget(byCol, quotas, 0.03, 10)).toBeNull();

    const res = selectKnapsackUnderBoundary(byCol, quotas, 0.03, 10);
    expect(res).not.toBeNull();
    expect(res!).toHaveLength(10);
    expect(sumFloat(res!)).toBeLessThanOrEqual(0.30 + 1e-9);
  });

  it("respects per-collection quotas and the budget (multi-collection)", () => {
    const a = Array.from({ length: 6 }, (_, i) => mk(`a${i}`, 50 + i, 0.03, "colA"));
    const b = Array.from({ length: 8 }, (_, i) => mk(`b${i}`, 70 + i, 0.04, "colB"));
    const byCol = new Map([["colA", a], ["colB", b]]);
    const quotas = new Map([["colA", 3], ["colB", 7]]);
    const res = selectKnapsackUnderBoundary(byCol, quotas, 0.05, 10); // budget 0.50
    expect(res).not.toBeNull();
    expect(res!).toHaveLength(10);
    expect(res!.filter(l => l.collection_id === "colA")).toHaveLength(3);
    expect(res!.filter(l => l.collection_id === "colB")).toHaveLength(7);
    expect(sumFloat(res!)).toBeLessThanOrEqual(0.5 + 1e-9);
  });

  it("returns null when even the lowest-float set exceeds the budget", () => {
    const pool = Array.from({ length: 12 }, (_, i) => mk(`a${i}`, 100, 0.20)); // 10×0.20 = 2.0
    const byCol = new Map([["colA", pool]]);
    const quotas = new Map([["colA", 10]]);
    expect(selectKnapsackUnderBoundary(byCol, quotas, 0.05, 10)).toBeNull(); // budget 0.50
  });

  it("returns null when a pool is smaller than its quota", () => {
    const pool = Array.from({ length: 5 }, (_, i) => mk(`a${i}`, 100, 0.02));
    const byCol = new Map([["colA", pool]]);
    const quotas = new Map([["colA", 10]]);
    expect(selectKnapsackUnderBoundary(byCol, quotas, 0.5, 10)).toBeNull();
  });

  it("is feasibility-complete: returns a valid set whenever the greedy does", () => {
    // E3 is additive — tried alongside the greedy, never replacing it. Its
    // contract is feasibility-completeness, not cost-dominance: whenever the
    // price-greedy succeeds, E3 must also return a valid in-budget count-set.
    const pool = [
      ...Array.from({ length: 10 }, (_, i) => mk(`hi${i}`, 10, 0.40)),  // cheap, high float
      ...Array.from({ length: 10 }, (_, i) => mk(`lo${i}`, 100, 0.02)), // pricey, low float
    ];
    const byCol = new Map([["colA", pool]]);
    const quotas = new Map([["colA", 10]]);
    const greedy = selectForFloatTarget(byCol, quotas, 0.25, 10); // budget 2.5
    expect(greedy).not.toBeNull();
    const res = selectKnapsackUnderBoundary(byCol, quotas, 0.25, 10);
    expect(res).not.toBeNull();
    expect(res!).toHaveLength(10);
    expect(sumFloat(res!)).toBeLessThanOrEqual(2.5 + 1e-9);
  });

  it("on the cheapest frontier, never costlier than the lowest-float fallback", () => {
    // The parametric pick should be no worse on cost than the naive lowest-float
    // set (α=1 extreme): when α=0 (cheapest) already fits, it must be returned.
    const pool = [
      ...Array.from({ length: 10 }, (_, i) => mk(`cheap${i}`, 10, 0.03)),  // cheap AND low float
      ...Array.from({ length: 10 }, (_, i) => mk(`pricey${i}`, 500, 0.02)),
    ];
    const byCol = new Map([["colA", pool]]);
    const quotas = new Map([["colA", 10]]);
    const lowestFloat = selectLowestFloat(byCol, quotas, 10);
    const res = selectKnapsackUnderBoundary(byCol, quotas, 0.05, 10); // budget 0.5; 10 cheap = 0.30 fits
    expect(res).not.toBeNull();
    expect(sumCost(res!)).toBeLessThanOrEqual(sumCost(lowestFloat!));
    // α=0 fits (10 cheap, float 0.30 ≤ 0.5) → should pick the 10 cheap items.
    expect(sumCost(res!)).toBe(100);
  });

  it("is deterministic across calls", () => {
    const pool = Array.from({ length: 20 }, (_, i) =>
      mk(`a${i}`, 50 + (i % 5), 0.02 + (i % 7) * 0.01));
    const byCol = new Map([["colA", pool]]);
    const quotas = new Map([["colA", 10]]);
    const r1 = selectKnapsackUnderBoundary(byCol, quotas, 0.10, 10);
    const r2 = selectKnapsackUnderBoundary(byCol, quotas, 0.10, 10);
    expect(r1).not.toBeNull();
    expect(r1!.map(l => l.id).sort()).toEqual(r2!.map(l => l.id).sort());
  });
});

// ─── selectKnapsackUnderBoundary — fixes from adversarial review ─────────────

describe("selectKnapsackUnderBoundary review-fix invariants", () => {
  const mk = (id: string, price: number, adjFloat: number, col = "colA"): AdjustedListing =>
    makeAdjustedListing({ id, price_cents: price, adjustedFloat: adjFloat, collection_id: col });

  it("never returns the same listing twice even if a pool has duplicate rows", () => {
    const base = Array.from({ length: 10 }, (_, i) => mk(`a${i}`, 100 + i, 0.03));
    const dupes = [base[0], base[1]]; // same ids repeated
    const byCol = new Map([["colA", [...dupes, ...base]]]);
    const quotas = new Map([["colA", 10]]);
    const res = selectKnapsackUnderBoundary(byCol, quotas, 0.05, 10);
    expect(res).not.toBeNull();
    expect(res!).toHaveLength(10);
    expect(new Set(res!.map(l => l.id)).size).toBe(10);
  });

  it("prefilter still finds the feasible low-float set hidden in a large pool", () => {
    // 200 cheap BUT high-float items + 10 pricey low-float ones. Only the
    // low-float set fits the budget; those items are NOT among the cheapest-N,
    // so this guards that the lowest-float candidates survive the prefilter.
    const cheapHigh = Array.from({ length: 200 }, (_, i) => mk(`h${i}`, 1, 0.50));
    const priceyLow = Array.from({ length: 10 }, (_, i) => mk(`l${i}`, 5000, 0.02));
    const byCol = new Map([["colA", [...cheapHigh, ...priceyLow]]]);
    const quotas = new Map([["colA", 10]]);
    const res = selectKnapsackUnderBoundary(byCol, quotas, 0.03, 10); // budget 0.30
    expect(res).not.toBeNull();
    expect(res!).toHaveLength(10);
    expect(res!.reduce((s, l) => s + l.adjustedFloat, 0)).toBeLessThanOrEqual(0.30 + 1e-9);
    // must be the low-float items (the only feasible set)
    expect(res!.every(l => l.id.startsWith("l"))).toBe(true);
  });
});
