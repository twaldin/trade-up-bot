import { describe, it, expect } from "vitest";
import { computeMADClampBounds } from "../../server/engine/knn-pricing.js";

describe("computeMADClampBounds", () => {
  it("returns null for empty array", () => {
    expect(computeMADClampBounds([])).toBeNull();
  });

  it("returns null when all prices are identical (MAD=0)", () => {
    expect(computeMADClampBounds([500, 500, 500, 500])).toBeNull();
  });

  it("computes correct bounds for normal distribution of prices", () => {
    // Prices: 26, 29, 30, 30, 33 — typical BS sales
    const bounds = computeMADClampBounds([2600, 2900, 3000, 3000, 3300]);
    expect(bounds).not.toBeNull();
    // Median = 3000, deviations = [400, 100, 0, 0, 300], sorted = [0, 0, 100, 300, 400]
    // MAD = 100, scale = 3 * 100 * 1.4826 = 444.78
    expect(bounds!.upper).toBeCloseTo(3000 + 444.78, 0);
    expect(bounds!.lower).toBeCloseTo(3000 - 444.78, 0);
  });

  it("detects sticker outlier in Radiation Hazard BS scenario", () => {
    // Real data: $26.28, $29.60, $169.00 (sticker sale)
    const bounds = computeMADClampBounds([2628, 2960, 16900]);
    expect(bounds).not.toBeNull();
    // Median = 2960, deviations = [332, 0, 13940], MAD = 332
    // upper = 2960 + 3 * 332 * 1.4826 = 2960 + 1476.55 = 4436.55
    expect(bounds!.upper).toBeLessThan(16900); // sticker sale exceeds upper
    expect(bounds!.upper).toBeGreaterThan(2960); // median is within bounds
  });

  it("preserves legitimate float premiums (wide but non-outlier spread)", () => {
    // M249 Downtown FN: prices from $2.64 to $15.30
    const prices = [428, 1100, 1080, 1530, 1240, 865, 264, 875, 405, 640, 265, 282];
    const bounds = computeMADClampBounds(prices);
    expect(bounds).not.toBeNull();
    // All prices should be within bounds (no false positives)
    for (const p of prices) {
      expect(p).toBeLessThanOrEqual(bounds!.upper);
      expect(p).toBeGreaterThanOrEqual(bounds!.lower);
    }
  });

  it("lower bound floors at 0", () => {
    // Prices where MAD-based lower bound would go negative without the floor:
    // median=5, deviations=[0,0,95,195,295], MAD=95, scale=3*95*1.4826=422.54
    // lower = 5 - 422.54 = -417.54 → floored to 0
    const bounds = computeMADClampBounds([5, 5, 100, 200, 300]);
    expect(bounds).not.toBeNull();
    expect(bounds!.lower).toBe(0);
  });
});

describe("MAD clamping integration", () => {
  it("clamps values outside bounds to threshold", () => {
    const bounds = computeMADClampBounds([2628, 2960, 16900]);
    expect(bounds).not.toBeNull();
    // Simulate clamping
    const prices = [2628, 2960, 16900];
    const clamped = prices.map(p =>
      Math.min(Math.max(p, bounds!.lower), bounds!.upper)
    );
    // Sticker sale should be clamped down to upper bound
    expect(clamped[2]).toBeCloseTo(bounds!.upper, 0);
    // Normal sales untouched
    expect(clamped[0]).toBe(2628);
    expect(clamped[1]).toBe(2960);
  });
});
