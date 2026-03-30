import { describe, it, expect, beforeEach } from "vitest";
import { resolvePriceWithFallbacks, priceCache, skinportMedianCache, refPriceCache } from "../../server/engine/pricing.js";
import type { FallbackParams, KnnEstimate } from "../../server/engine/types.js";

function knn(overrides: Partial<KnnEstimate> = {}): KnnEstimate {
  return {
    priceCents: 1000, confidence: 0.8, observationCount: 12,
    avgDistance: 0.015, conditionObsCount: 12, floatCoverage: 0.8,
    ...overrides,
  };
}

function p(overrides: Partial<FallbackParams> = {}): FallbackParams {
  return {
    knn: null, refPrice: 0, listingFloor: null, spMedian: null,
    floatCeiling: null, crossConditionEstimate: null,
    skinName: "AK-47 | Redline", predictedFloat: 0.25, isStarSkin: false,
    ...overrides,
  };
}

beforeEach(() => { priceCache.clear(); skinportMedianCache.clear(); refPriceCache.clear(); });

// ── KNN path ───────────────────────────────────────────────────────────────

describe("KNN usable path", () => {
  it("returns KNN price when high confidence", () => {
    expect(resolvePriceWithFallbacks(p({ knn: knn({ priceCents: 5000 }) })).grossPrice).toBe(5000);
  });

  it("applies 2x ref cap when ≤3 obs", () => {
    const r = resolvePriceWithFallbacks(p({ knn: knn({ priceCents: 10000, observationCount: 2 }), refPrice: 3000 }));
    expect(r.grossPrice).toBe(3000); // 10000 > 2×3000 → capped to refPrice
  });

  it("applies 3x ref cap when 4–5 obs", () => {
    const r = resolvePriceWithFallbacks(p({ knn: knn({ priceCents: 10000, observationCount: 5 }), refPrice: 3000 }));
    expect(r.grossPrice).toBe(3000); // 10000 > 3×3000 → capped
  });

  it("applies 5x ref cap when 6+ obs", () => {
    const r = resolvePriceWithFallbacks(p({ knn: knn({ priceCents: 12000, observationCount: 8 }), refPrice: 2000 }));
    expect(r.grossPrice).toBe(2000); // 12000 > 5×2000 → capped
  });

  it("does not cap when within 5x limit", () => {
    const r = resolvePriceWithFallbacks(p({ knn: knn({ priceCents: 5000, observationCount: 8 }), refPrice: 2000 }));
    expect(r.grossPrice).toBe(5000); // 5000 < 5×2000
  });

  it("SP median cap fires when KNN > 3× spMedian", () => {
    const r = resolvePriceWithFallbacks(p({ knn: knn({ priceCents: 5000 }), spMedian: 1000 }));
    expect(r.grossPrice).toBeLessThanOrEqual(3000);
  });
});

// ── SP bypass regression (GH #51) ─────────────────────────────────────────

describe("SP median silent bypass regression (GH #51)", () => {
  it("hard cap uses refPrice when spMedian is null — WILL FAIL until Task 10", () => {
    const r = resolvePriceWithFallbacks(p({ knn: knn({ priceCents: 50000 }), spMedian: null, refPrice: 5000 }));
    expect(r.grossPrice).toBeLessThanOrEqual(5000 * 3);
  });

  it("hard cap uses refPrice when spMedian is 0 — WILL FAIL until Task 10", () => {
    const r = resolvePriceWithFallbacks(p({ knn: knn({ priceCents: 50000 }), spMedian: 0, refPrice: 5000 }));
    expect(r.grossPrice).toBeLessThanOrEqual(15000);
  });
});

// ── Fallback path ──────────────────────────────────────────────────────────

describe("fallback path (KNN null or thin)", () => {
  it("uses min(ref, floor) when both present", () => {
    expect(resolvePriceWithFallbacks(p({ refPrice: 1500, listingFloor: 1200 })).grossPrice).toBe(1200);
  });

  it("uses listing floor when ref is 0", () => {
    expect(resolvePriceWithFallbacks(p({ listingFloor: 800 })).grossPrice).toBe(800);
  });

  it("uses refPrice when floor is null", () => {
    expect(resolvePriceWithFallbacks(p({ refPrice: 1000 })).grossPrice).toBe(1000);
  });

  it("returns 0 when no price data at all", () => {
    expect(resolvePriceWithFallbacks(p()).grossPrice).toBe(0);
  });

  it("★ skin with conditionConfidence < 0.1 bypasses KNN and uses fallback", () => {
    // conditionObsCount=0, floatCoverage=0 → conditionConfidence=0 < 0.1 → bypass
    const r = resolvePriceWithFallbacks(p({
      knn: knn({ priceCents: 9000, observationCount: 5, conditionObsCount: 0, floatCoverage: 0.0 }),
      refPrice: 3000,
      isStarSkin: true,
    }));
    expect(r.grossPrice).toBe(3000); // conditionConfidence=0 → uses refPrice
  });
});

// ── Float ceiling ──────────────────────────────────────────────────────────

describe("float ceiling", () => {
  it("caps at ceiling when grossPrice > ceiling", () => {
    expect(resolvePriceWithFallbacks(p({ refPrice: 5000, floatCeiling: 3000 })).grossPrice).toBe(3000);
  });

  it("no cap when grossPrice ≤ ceiling", () => {
    expect(resolvePriceWithFallbacks(p({ refPrice: 2000, floatCeiling: 3000 })).grossPrice).toBe(2000);
  });
});

// ── Monotonicity guard ─────────────────────────────────────────────────────

describe("monotonicity guard", () => {
  it("clamps BS price when WW is in priceCache", () => {
    priceCache.set("AK-47 | Redline:Well-Worn", 2000);
    const r = resolvePriceWithFallbacks(p({
      refPrice: 5000,
      skinName: "AK-47 | Redline",
      predictedFloat: 0.55,
    }));
    expect(r.grossPrice).toBeLessThanOrEqual(2000);
  });
});

// ── Cross-condition estimate (step 6 — will fail until Task 13) ────────────

describe("cross-condition estimate", () => {
  it("uses crossConditionEstimate for ★ when KNN null — WILL FAIL until Task 13", () => {
    const r = resolvePriceWithFallbacks(p({
      knn: null,
      crossConditionEstimate: 8000,
      isStarSkin: true,
      skinName: "★ Sport Gloves | Emerald Web",
      predictedFloat: 0.25,
    }));
    expect(r.grossPrice).toBe(8000);
  });

  it("ignores crossConditionEstimate for non-★ skins — WILL FAIL until Task 13", () => {
    const r = resolvePriceWithFallbacks(p({
      knn: null,
      crossConditionEstimate: 8000,
      isStarSkin: false,
      refPrice: 1000,
    }));
    expect(r.grossPrice).toBe(1000); // uses refPrice
  });
});

// ── Confidence blend (step 5 — will fail until Task 12) ──────────────────

describe("confidence-weighted attractor blend", () => {
  it("blends KNN with SP median for ★ sparse — WILL FAIL until Task 12", () => {
    // conditionObsCount=5, floatCoverage=0 → conditionConfidence = 5/10*0.6 + 0 = 0.30
    const r = resolvePriceWithFallbacks(p({
      knn: knn({ priceCents: 4000, observationCount: 5, conditionObsCount: 5, floatCoverage: 0 }),
      spMedian: 8000,
      isStarSkin: true,
      skinName: "★ Sport Gloves | Spearmint",
      predictedFloat: 0.25,
    }));
    // blend = 0.30*4000 + 0.70*8000 = 1200 + 5600 = 6800
    expect(r.grossPrice).toBeGreaterThan(4000);
    expect(r.grossPrice).toBeLessThan(8000);
  });

  it("uses refPrice as attractor when spMedian missing — WILL FAIL until Task 12", () => {
    const r = resolvePriceWithFallbacks(p({
      knn: knn({ priceCents: 4000, observationCount: 3, conditionObsCount: 3, floatCoverage: 0 }),
      spMedian: null,
      refPrice: 6000,
      isStarSkin: true,
      skinName: "★ Moto Gloves | Spearmint",
      predictedFloat: 0.25,
    }));
    expect(r.grossPrice).toBeGreaterThan(4000);
    expect(r.grossPrice).toBeLessThanOrEqual(6000);
  });
});

// ── Sparse-condition cap (GH #54) ─────────────────────────────────────────

describe("sparse-condition cap (GH #54)", () => {
  it("caps to spMedian when conditionObsCount < 10 and no CSFloat ref", () => {
    // Nova | Ocular BS scenario: 4 obs, KNN extrapolates to $3.68 vs spMedian $2.45
    const r = resolvePriceWithFallbacks(p({
      knn: knn({ priceCents: 368, observationCount: 2, conditionObsCount: 4, floatCoverage: 0.1 }),
      refPrice: 0,
      spMedian: 245,
    }));
    expect(r.grossPrice).toBe(245);
    expect(r.source).toBe("knn (sparse-capped)");
  });

  it("caps to spMedian when conditionObsCount is 0 and no CSFloat ref", () => {
    // Sawed-Off | Serenity BS scenario: 0 obs, KNN extrapolates to $34.79 vs spMedian $2.89
    const r = resolvePriceWithFallbacks(p({
      knn: knn({ priceCents: 3479, observationCount: 2, conditionObsCount: 0, floatCoverage: 0 }),
      refPrice: 0,
      spMedian: 289,
    }));
    expect(r.grossPrice).toBe(289);
    expect(r.source).toBe("knn (sparse-capped)");
  });

  it("does not cap when KNN price is already at or below spMedian", () => {
    const r = resolvePriceWithFallbacks(p({
      knn: knn({ priceCents: 200, observationCount: 2, conditionObsCount: 4, floatCoverage: 0.1 }),
      refPrice: 0,
      spMedian: 245,
    }));
    expect(r.grossPrice).toBe(200);
  });

  it("does not sparse-cap when conditionObsCount >= 10", () => {
    // Dense data — normal 3x cap applies, not sparse cap
    const r = resolvePriceWithFallbacks(p({
      knn: knn({ priceCents: 600, observationCount: 12, conditionObsCount: 15, floatCoverage: 0.6 }),
      refPrice: 0,
      spMedian: 245,
    }));
    // 600 > 245 but conditionObsCount=15 ≥ 10 → sparse cap does NOT fire
    // 600 < 3×245=735 → 3x cap also doesn't fire → returns KNN price
    expect(r.grossPrice).toBe(600);
  });

  it("does not sparse-cap when refPrice > 0 (obs-count cap covers this case)", () => {
    const r = resolvePriceWithFallbacks(p({
      knn: knn({ priceCents: 600, observationCount: 2, conditionObsCount: 4, floatCoverage: 0.1 }),
      refPrice: 250,
      spMedian: 245,
    }));
    // refPrice>0 → uses obs-count cap (2×refPrice=500), not sparse cap
    expect(r.grossPrice).toBe(250); // 600 > 2×250=500 → ref-capped
  });
});

// ── Listing floor cap bounds (GH #61) ────────────────────────────────────────

describe("listing floor cap bounds (GH #61)", () => {
  it("caps inflated listing floor to skinportMedianCache knnCap when KNN null and refPrice 0", () => {
    // Sawed-Off | Serenity BS: stale listing at 3479¢, but spMedian=289¢
    // Bug: listing floor was used uncapped → 3479¢. Fix: cap to spMedian (289¢).
    skinportMedianCache.set("Sawed-Off | Serenity:Battle-Scarred", 289);
    const r = resolvePriceWithFallbacks(p({
      knn: null,
      refPrice: 0,
      listingFloor: 3479,
      skinName: "Sawed-Off | Serenity",
      predictedFloat: 0.55, // Battle-Scarred
    }));
    expect(r.grossPrice).toBe(289);
    expect(r.source).toBe("cap-bounded (listing floor)");
  });

  it("caps inflated listing floor to refPriceCache (5x cheapest) when spMedian also missing", () => {
    // No spMedian, but refPriceCache has cheapest obs → cap = 5× cheapest
    refPriceCache.set("Sawed-Off | Serenity:Battle-Scarred", 100);
    const r = resolvePriceWithFallbacks(p({
      knn: null,
      refPrice: 0,
      listingFloor: 3479,
      skinName: "Sawed-Off | Serenity",
      predictedFloat: 0.55,
    }));
    expect(r.grossPrice).toBe(500); // 5× cheapest = 5×100
    expect(r.source).toBe("cap-bounded (listing floor)");
  });

  it("does not cap listing floor when it is within the knnCap", () => {
    // Listing floor is already below spMedian → use it as-is
    skinportMedianCache.set("AK-47 | Redline:Field-Tested", 500);
    const r = resolvePriceWithFallbacks(p({
      knn: null,
      refPrice: 0,
      listingFloor: 400,
      skinName: "AK-47 | Redline",
      predictedFloat: 0.25, // Field-Tested
    }));
    expect(r.grossPrice).toBe(400);
    expect(r.source).toBe("listing floor");
  });

  it("does not cap listing floor when resolveOutputCapBounds returns null (no market reference)", () => {
    // skinportMedianCache, priceCache, refPriceCache all empty → no cap available
    const r = resolvePriceWithFallbacks(p({
      knn: null,
      refPrice: 0,
      listingFloor: 3479,
      skinName: "Some Rare Skin | With No Data",
      predictedFloat: 0.55,
    }));
    expect(r.grossPrice).toBe(3479);
    expect(r.source).toBe("listing floor");
  });

  it("does not cap ★ skin listing floor at Skinport median (GH #67)", () => {
    // ★ Karambit | Fade FT: CSFloat listing floor $200, Skinport median $170.
    // Bug (PR #62): listing floor was capped at spMedian ($170) for all skins.
    // Fix: skip Skinport cap for ★ skins — CSFloat knife prices run above Skinport.
    skinportMedianCache.set("★ Karambit | Fade:Field-Tested", 17000);
    const r = resolvePriceWithFallbacks(p({
      knn: null,
      refPrice: 0,
      listingFloor: 20000,
      skinName: "★ Karambit | Fade",
      predictedFloat: 0.20, // Field-Tested
      isStarSkin: true,
    }));
    expect(r.grossPrice).toBe(20000);
    expect(r.source).toBe("listing floor");
  });

  it("non-★ skin listing floor is still capped at Skinport median (regression guard)", () => {
    // Sawed-Off | Serenity BS: stale listing at 3479¢, but spMedian=289¢.
    // Non-★ skins must still apply the Skinport cap (PR #62 fix preserved).
    skinportMedianCache.set("Sawed-Off | Serenity:Battle-Scarred", 289);
    const r = resolvePriceWithFallbacks(p({
      knn: null,
      refPrice: 0,
      listingFloor: 3479,
      skinName: "Sawed-Off | Serenity",
      predictedFloat: 0.55,
      isStarSkin: false,
    }));
    expect(r.grossPrice).toBe(289);
    expect(r.source).toBe("cap-bounded (listing floor)");
  });
});
