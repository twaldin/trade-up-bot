import { describe, it, expect } from "vitest";
import { getFloatBucket, FLOAT_BUCKETS } from "../../server/engine/knn-pricing.js";

// ─── getFloatBucket ──────────────────────────────────────────────────────────

describe("getFloatBucket", () => {
  it("0.01 → FN-low bucket (0.00-0.03)", () => {
    const bucket = getFloatBucket(0.01);
    expect(bucket).toEqual({ min: 0.00, max: 0.03 });
  });

  it("0.05 → FN-high bucket (0.03-0.07)", () => {
    const bucket = getFloatBucket(0.05);
    expect(bucket).toEqual({ min: 0.03, max: 0.07 });
  });

  it("0.08 → MW-low bucket (0.07-0.10)", () => {
    const bucket = getFloatBucket(0.08);
    expect(bucket).toEqual({ min: 0.07, max: 0.10 });
  });

  it("0.12 → MW-high bucket (0.10-0.15)", () => {
    const bucket = getFloatBucket(0.12);
    expect(bucket).toEqual({ min: 0.10, max: 0.15 });
  });

  it("0.20 → FT-low bucket (0.15-0.25)", () => {
    const bucket = getFloatBucket(0.20);
    expect(bucket).toEqual({ min: 0.15, max: 0.25 });
  });

  it("0.30 → FT-high bucket (0.25-0.38)", () => {
    const bucket = getFloatBucket(0.30);
    expect(bucket).toEqual({ min: 0.25, max: 0.38 });
  });

  it("0.40 → WW bucket (0.38-0.45)", () => {
    const bucket = getFloatBucket(0.40);
    expect(bucket).toEqual({ min: 0.38, max: 0.45 });
  });

  it("0.50 → BS bucket (0.45-1.00)", () => {
    const bucket = getFloatBucket(0.50);
    expect(bucket).toEqual({ min: 0.45, max: 1.00 });
  });

  it("1.0 (max float) → BS bucket", () => {
    const bucket = getFloatBucket(1.0);
    expect(bucket).toEqual({ min: 0.45, max: 1.00 });
  });

  it("0.0 (min float) → FN-low bucket", () => {
    const bucket = getFloatBucket(0.0);
    expect(bucket).toEqual({ min: 0.00, max: 0.03 });
  });

  it("boundary value 0.07 → MW-low (not FN-high)", () => {
    // 0.07 is >= FN-high max, should go to MW-low
    const bucket = getFloatBucket(0.07);
    expect(bucket).toEqual({ min: 0.07, max: 0.10 });
  });

  it("boundary value 0.15 → FT-low", () => {
    const bucket = getFloatBucket(0.15);
    expect(bucket).toEqual({ min: 0.15, max: 0.25 });
  });

  it("boundary value 0.45 → BS", () => {
    const bucket = getFloatBucket(0.45);
    expect(bucket).toEqual({ min: 0.45, max: 1.00 });
  });
});

// ─── FLOAT_BUCKETS ───────────────────────────────────────────────────────────

describe("FLOAT_BUCKETS", () => {
  it("covers full float range 0-1 with no gaps", () => {
    // First bucket starts at 0
    expect(FLOAT_BUCKETS[0].min).toBe(0);
    // Last bucket ends at 1
    expect(FLOAT_BUCKETS[FLOAT_BUCKETS.length - 1].max).toBe(1);
    // No gaps between consecutive buckets
    for (let i = 1; i < FLOAT_BUCKETS.length; i++) {
      expect(FLOAT_BUCKETS[i].min).toBe(FLOAT_BUCKETS[i - 1].max);
    }
  });

  it("has 8 buckets", () => {
    expect(FLOAT_BUCKETS).toHaveLength(8);
  });

  it("each bucket has positive width", () => {
    for (const b of FLOAT_BUCKETS) {
      expect(b.max).toBeGreaterThan(b.min);
    }
  });
});
