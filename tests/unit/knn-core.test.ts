import { describe, it, expect } from "vitest";
import {
  computeKnnEstimate,
  computeConditionConfidence,
  DEFAULT_KNN_CONFIG,
} from "../../server/engine/knn-pricing.js";
import { floatToCondition } from "../../shared/types.js";
import type { KnnObservation, KnnEstimate } from "../../server/engine/types.js";

function obs(float: number, price: number, source = "sale", ageDays = 1): KnnObservation {
  const weights: Record<string, number> = { sale: 3.0, buff_sale: 2.0, skinport_sale: 0.5 };
  const ageDecay = 1 / (1 + ageDays / 20);
  return { float, price, weight: (weights[source] ?? 1.0) * ageDecay, condition: floatToCondition(float) };
}

describe("computeKnnEstimate — Tier 1 (Gaussian KNN)", () => {
  it("returns estimate when ≥3 obs within 0.04 and nearest within 0.012", () => {
    const result = computeKnnEstimate(
      [obs(0.250, 3000), obs(0.255, 2950), obs(0.260, 2900), obs(0.270, 2800)],
      0.255, DEFAULT_KNN_CONFIG
    );
    expect(result).not.toBeNull();
    expect(result!.priceCents).toBeGreaterThan(2800);
    expect(result!.priceCents).toBeLessThan(3100);
    expect(result!.confidence).toBeGreaterThan(0.3);
  });

  it("clamps MAD outlier without dropping it from neighbor count", () => {
    const result = computeKnnEstimate(
      [obs(0.250, 2800), obs(0.255, 2900), obs(0.260, 2950), obs(0.260, 16900), obs(0.265, 3000)],
      0.255, DEFAULT_KNN_CONFIG
    );
    expect(result).not.toBeNull();
    expect(result!.priceCents).toBeLessThan(5000);  // not inflated
    expect(result!.observationCount).toBeGreaterThanOrEqual(4); // all counted
  });

  it("returns null when nearest obs is not within maxNearestDist (0.012)", () => {
    // target 0.20, nearest obs at 0.215 — dist 0.015 > 0.012
    const result = computeKnnEstimate(
      [obs(0.215, 3000), obs(0.225, 2900), obs(0.235, 2800)],
      0.200, DEFAULT_KNN_CONFIG
    );
    // Tier 1 requires nearest ≤ 0.012. dist=0.015 → Tier 1 fails.
    // Tier 2 also needs obs within 0.04. 0.215 is 0.015 < 0.04, 0.225 is 0.025 < 0.04 → Tier 2 fires.
    // So result is non-null (Tier 2), confidence=0.3
    expect(result?.confidence).toBe(0.3);
  });
});

describe("computeKnnEstimate — Tier 2 (linear interpolation)", () => {
  it("fires when exactly 2 obs within 0.04 and Tier 1 not met", () => {
    // Only 2 obs within 0.04 of 0.30: at 0.280 (dist=0.02) and 0.310 (dist=0.01)
    const result = computeKnnEstimate(
      [obs(0.280, 3000), obs(0.310, 2700)],
      0.300, DEFAULT_KNN_CONFIG
    );
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe(0.3);
    // t = (0.30 - 0.28) / (0.31 - 0.28) = 0.02/0.03 ≈ 0.667
    // interpolated = 3000 + 0.667 * (2700 - 3000) = 3000 - 200 = 2800
    expect(result!.priceCents).toBeCloseTo(2800, -2);
  });

  it("averages two obs at same float", () => {
    const result = computeKnnEstimate(
      [obs(0.250, 3000), obs(0.250, 2600)],
      0.255, DEFAULT_KNN_CONFIG
    );
    expect(result).not.toBeNull();
    expect(result!.priceCents).toBeGreaterThan(2600);
    expect(result!.priceCents).toBeLessThanOrEqual(3000);
  });
});

describe("computeKnnEstimate — null returns", () => {
  it("returns null for empty obs", () => {
    expect(computeKnnEstimate([], 0.25, DEFAULT_KNN_CONFIG)).toBeNull();
  });

  it("returns null when no same-condition obs", () => {
    // target FT (0.25), obs only in BS (0.55)
    expect(computeKnnEstimate([obs(0.55, 500)], 0.25, DEFAULT_KNN_CONFIG)).toBeNull();
  });

  it("returns null when all same-condition obs are >0.04 away", () => {
    // target 0.35 (FT), obs at 0.16 (dist=0.19) and 0.18 (dist=0.17) — both > 0.04
    expect(computeKnnEstimate([obs(0.16, 3000), obs(0.18, 2900)], 0.35, DEFAULT_KNN_CONFIG)).toBeNull();
  });
});

describe("computeKnnEstimate — conditionObsCount and floatCoverage", () => {
  it("conditionObsCount counts all same-condition obs regardless of distance", () => {
    // 4 FT obs: 2 far (>0.04 from 0.35), 2 close
    const result = computeKnnEstimate(
      [obs(0.17, 3000), obs(0.19, 2900), obs(0.34, 2500), obs(0.36, 2450)],
      0.35, DEFAULT_KNN_CONFIG
    );
    // Tier 1: 2 obs within 0.04 → not enough (need 3). Tier 2: 2 obs → fires.
    expect(result).not.toBeNull();
    expect(result!.conditionObsCount).toBe(4); // all 4 FT obs counted
  });

  it("floatCoverage reflects obs in one bucket", () => {
    // All FT obs clustered at 0.15–0.19 (same 0.04 bucket from condMin=0.15)
    const result = computeKnnEstimate(
      [obs(0.151, 3000), obs(0.155, 2950), obs(0.160, 2900)],
      0.155, DEFAULT_KNN_CONFIG
    );
    expect(result).not.toBeNull();
    // All 3 obs in bucket 0 of FT range → floatCoverage = 1/6 ≈ 0.167
    expect(result!.floatCoverage).toBeCloseTo(1 / 6, 2);
  });

  it("floatCoverage increases when obs span multiple buckets", () => {
    // r1: all obs near 0.255 (single FT bucket)
    const r1 = computeKnnEstimate([obs(0.251, 3000), obs(0.255, 2950), obs(0.260, 2900)], 0.255, DEFAULT_KNN_CONFIG);
    // r2: obs spread across FT (0.17, 0.255, 0.335)
    const r2 = computeKnnEstimate(
      [obs(0.170, 3000), obs(0.255, 2800), obs(0.335, 2500), obs(0.255, 2850), obs(0.260, 2900)],
      0.255, DEFAULT_KNN_CONFIG
    );
    expect(r1!.floatCoverage).toBeLessThan(r2!.floatCoverage);
  });
});

describe("computeConditionConfidence", () => {
  function est(conditionObsCount: number, floatCoverage: number): KnnEstimate {
    return { priceCents: 1000, confidence: 0.8, observationCount: conditionObsCount,
             avgDistance: 0.01, conditionObsCount, floatCoverage };
  }

  it("returns 0.0 when 0 obs and 0 coverage", () => {
    expect(computeConditionConfidence(est(0, 0))).toBe(0);
  });

  it("returns 1.0 when 10+ obs and 50%+ coverage", () => {
    expect(computeConditionConfidence(est(10, 0.5))).toBe(1.0);
    expect(computeConditionConfidence(est(20, 1.0))).toBe(1.0);
  });

  it("partial count, no coverage → 0.3 (5 obs, 0 coverage)", () => {
    // countFactor = 5/10 = 0.5, coverageFactor = 0/0.5 = 0
    // confidence = 0.5*0.6 + 0*0.4 = 0.30
    expect(computeConditionConfidence(est(5, 0))).toBeCloseTo(0.3, 5);
  });

  it("increases with more obs", () => {
    expect(computeConditionConfidence(est(3, 0.2)))
      .toBeLessThan(computeConditionConfidence(est(8, 0.2)));
  });
});
