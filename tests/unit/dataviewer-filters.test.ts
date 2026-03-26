import { describe, it, expect } from "vitest";
import {
  filterByFloatRange,
  filterByTimeRange,
  filterBucketsByFloatRange,
  getAvailableConditions,
  CONDITION_RANGES,
} from "../../src/components/data-viewer/filter-utils.js";

// ─── CONDITION_RANGES ────────────────────────────────────────────────────────

describe("CONDITION_RANGES", () => {
  it("covers all five conditions", () => {
    expect(Object.keys(CONDITION_RANGES)).toEqual([
      "Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred",
    ]);
  });

  it("Factory New is 0–0.07", () => {
    expect(CONDITION_RANGES["Factory New"]).toEqual({ min: 0, max: 0.07 });
  });

  it("Battle-Scarred is 0.45–1.0", () => {
    expect(CONDITION_RANGES["Battle-Scarred"]).toEqual({ min: 0.45, max: 1 });
  });
});

// ─── getAvailableConditions ──────────────────────────────────────────────────

describe("getAvailableConditions", () => {
  it("returns only conditions that overlap the skin's float range", () => {
    const result = getAvailableConditions(0.06, 0.80);
    expect(result.map(c => c.name)).toEqual([
      "Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred",
    ]);
  });

  it("excludes FN for a skin with min_float 0.08", () => {
    const result = getAvailableConditions(0.08, 1.0);
    expect(result.map(c => c.name)).not.toContain("Factory New");
  });

  it("excludes BS and WW for a skin with max_float 0.38", () => {
    const result = getAvailableConditions(0.0, 0.38);
    expect(result.map(c => c.name)).not.toContain("Battle-Scarred");
    expect(result.map(c => c.name)).not.toContain("Well-Worn");
    expect(result.map(c => c.name)).toContain("Field-Tested");
  });

  it("returns only FT for a skin with range 0.15–0.38", () => {
    const result = getAvailableConditions(0.15, 0.38);
    expect(result.map(c => c.name)).toEqual(["Field-Tested"]);
  });
});

// ─── filterByFloatRange ──────────────────────────────────────────────────────

describe("filterByFloatRange", () => {
  const items = [
    { float_value: 0.01 },
    { float_value: 0.10 },
    { float_value: 0.25 },
    { float_value: 0.50 },
    { float_value: 0.90 },
  ];

  it("returns all items when both bounds are null", () => {
    expect(filterByFloatRange(items, null, null)).toHaveLength(5);
  });

  it("filters by min only", () => {
    const result = filterByFloatRange(items, 0.20, null);
    expect(result.map(i => i.float_value)).toEqual([0.25, 0.50, 0.90]);
  });

  it("filters by max only", () => {
    const result = filterByFloatRange(items, null, 0.30);
    expect(result.map(i => i.float_value)).toEqual([0.01, 0.10, 0.25]);
  });

  it("filters by both min and max", () => {
    const result = filterByFloatRange(items, 0.05, 0.30);
    expect(result.map(i => i.float_value)).toEqual([0.10, 0.25]);
  });

  it("inclusive on both boundaries", () => {
    const result = filterByFloatRange(items, 0.10, 0.50);
    expect(result.map(i => i.float_value)).toEqual([0.10, 0.25, 0.50]);
  });

  it("returns empty array when range excludes all", () => {
    expect(filterByFloatRange(items, 0.95, 0.99)).toHaveLength(0);
  });
});

// ─── filterByTimeRange ───────────────────────────────────────────────────────

describe("filterByTimeRange", () => {
  const items = [
    { dateField: "2026-03-01T00:00:00Z" },
    { dateField: "2026-03-10T00:00:00Z" },
    { dateField: "2026-03-20T00:00:00Z" },
    { dateField: "2026-03-25T00:00:00Z" },
  ];

  it("returns all items when both bounds are null", () => {
    expect(filterByTimeRange(items, "dateField", null, null)).toHaveLength(4);
  });

  it("filters by from date", () => {
    const from = new Date("2026-03-15T00:00:00Z");
    const result = filterByTimeRange(items, "dateField", from, null);
    expect(result).toHaveLength(2);
    expect(result[0].dateField).toBe("2026-03-20T00:00:00Z");
  });

  it("filters by to date", () => {
    const to = new Date("2026-03-15T00:00:00Z");
    const result = filterByTimeRange(items, "dateField", null, to);
    expect(result).toHaveLength(2);
    expect(result[0].dateField).toBe("2026-03-01T00:00:00Z");
  });

  it("filters by both from and to", () => {
    const from = new Date("2026-03-05T00:00:00Z");
    const to = new Date("2026-03-22T00:00:00Z");
    const result = filterByTimeRange(items, "dateField", from, to);
    expect(result).toHaveLength(2);
  });
});

// ─── filterBucketsByFloatRange ───────────────────────────────────────────────

describe("filterBucketsByFloatRange", () => {
  const buckets = [
    { float_min: 0.00, float_max: 0.07, avg_price_cents: 1000, listing_count: 5 },
    { float_min: 0.07, float_max: 0.15, avg_price_cents: 800, listing_count: 10 },
    { float_min: 0.15, float_max: 0.38, avg_price_cents: 500, listing_count: 20 },
    { float_min: 0.38, float_max: 0.45, avg_price_cents: 300, listing_count: 8 },
    { float_min: 0.45, float_max: 1.00, avg_price_cents: 200, listing_count: 15 },
  ];

  it("returns all buckets when both bounds are null", () => {
    expect(filterBucketsByFloatRange(buckets, null, null)).toHaveLength(5);
  });

  it("uses overlap check — partial overlap is included", () => {
    const result = filterBucketsByFloatRange(buckets, 0.10, 0.20);
    expect(result).toHaveLength(2);
    expect(result[0].float_min).toBe(0.07);
    expect(result[1].float_min).toBe(0.15);
  });

  it("excludes buckets with no overlap", () => {
    const result = filterBucketsByFloatRange(buckets, 0.50, 0.80);
    expect(result).toHaveLength(1);
    expect(result[0].float_min).toBe(0.45);
  });

  it("min-only filter", () => {
    const result = filterBucketsByFloatRange(buckets, 0.40, null);
    expect(result).toHaveLength(2);
  });

  it("max-only filter", () => {
    const result = filterBucketsByFloatRange(buckets, null, 0.10);
    expect(result).toHaveLength(2);
  });
});
