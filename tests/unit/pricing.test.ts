import { describe, it, expect, beforeEach } from "vitest";
import {
  buildAnchors, interpolatePrice, resolveOutputCapBounds,
  priceCache, refPriceCache, skinportMedianCache,
} from "../../server/engine/pricing.js";
import type { PriceAnchor } from "../../server/engine/types.js";

// ─── resolveOutputCapBounds ──────────────────────────────────────────────────

describe("resolveOutputCapBounds", () => {
  beforeEach(() => {
    priceCache.clear();
    refPriceCache.clear();
    skinportMedianCache.clear();
  });

  it("returns null when no data exists for skin+condition", () => {
    expect(resolveOutputCapBounds("Unknown Skin", "Battle-Scarred")).toBeNull();
  });

  it("uses Skinport median: trigger=3x, knnCap=1x, hardCap=3x", () => {
    skinportMedianCache.set("Sawed-Off Serenity:Battle-Scarred", 289);
    const result = resolveOutputCapBounds("Sawed-Off Serenity", "Battle-Scarred");
    expect(result).toEqual({ trigger: 867, knnCap: 289, hardCap: 867 });
  });

  it("falls back to CSFloat ref when Skinport absent: same multipliers", () => {
    priceCache.set("Skin:Battle-Scarred", 300);
    const result = resolveOutputCapBounds("Skin", "Battle-Scarred");
    expect(result).toEqual({ trigger: 900, knnCap: 300, hardCap: 900 });
  });

  it("falls back to 5x cheapest obs when both medians absent", () => {
    refPriceCache.set("Skin:Battle-Scarred", 200);
    const result = resolveOutputCapBounds("Skin", "Battle-Scarred");
    expect(result).toEqual({ trigger: 1000, knnCap: 1000, hardCap: 1000 });
  });

  it("Skinport takes priority over CSFloat ref", () => {
    skinportMedianCache.set("Skin:Field-Tested", 500);
    priceCache.set("Skin:Field-Tested", 300);
    const result = resolveOutputCapBounds("Skin", "Field-Tested");
    expect(result?.knnCap).toBe(500);
  });

  it("CSFloat ref takes priority over cheapest obs", () => {
    priceCache.set("Skin:Field-Tested", 300);
    refPriceCache.set("Skin:Field-Tested", 100);
    const result = resolveOutputCapBounds("Skin", "Field-Tested");
    expect(result?.knnCap).toBe(300);
  });

  it("ignores zero-value cache entries", () => {
    skinportMedianCache.set("Skin:Battle-Scarred", 0);
    priceCache.set("Skin:Battle-Scarred", 0);
    refPriceCache.set("Skin:Battle-Scarred", 400);
    const result = resolveOutputCapBounds("Skin", "Battle-Scarred");
    // Falls through to cheapest obs
    expect(result?.trigger).toBe(2000);
  });
});

// ─── buildAnchors ────────────────────────────────────────────────────────────

describe("buildAnchors", () => {
  it("converts condition rows to float-midpoint anchors", () => {
    const rows = [
      { condition: "Factory New", min_price_cents: 10000, avg_price_cents: 12000 },
      { condition: "Field-Tested", min_price_cents: 3000, avg_price_cents: 4000 },
    ];
    const anchors = buildAnchors(rows, 1.0);
    expect(anchors.length).toBe(2);
    // FN midpoint = 0.035, FT midpoint = 0.265
    expect(anchors[0].float).toBeCloseTo(0.035, 3);
    expect(anchors[1].float).toBeCloseTo(0.265, 3);
  });

  it("uses avg_price_cents when > 0, otherwise min_price_cents", () => {
    const rows = [
      { condition: "Factory New", min_price_cents: 5000, avg_price_cents: 8000 },
      { condition: "Minimal Wear", min_price_cents: 3000, avg_price_cents: 0 },
    ];
    const anchors = buildAnchors(rows, 1.0);
    expect(anchors[0].price).toBe(8000); // avg used
    expect(anchors[1].price).toBe(3000); // min used (avg is 0)
  });

  it("applies multiplier", () => {
    const rows = [
      { condition: "Factory New", min_price_cents: 10000, avg_price_cents: 10000 },
    ];
    const anchors = buildAnchors(rows, 0.5);
    expect(anchors[0].price).toBe(5000);
  });

  it("enforces monotonically decreasing prices (higher float = lower price)", () => {
    const rows = [
      { condition: "Factory New", min_price_cents: 5000, avg_price_cents: 5000 },
      { condition: "Minimal Wear", min_price_cents: 8000, avg_price_cents: 8000 }, // higher than FN!
      { condition: "Field-Tested", min_price_cents: 3000, avg_price_cents: 3000 },
    ];
    const anchors = buildAnchors(rows, 1.0);
    // After monotonicity enforcement: MW price capped at FN price
    for (let i = 1; i < anchors.length; i++) {
      expect(anchors[i].price).toBeLessThanOrEqual(anchors[i - 1].price);
    }
  });

  it("filters out conditions outside skin float range", () => {
    const rows = [
      { condition: "Factory New", min_price_cents: 10000, avg_price_cents: 10000 },
      { condition: "Battle-Scarred", min_price_cents: 2000, avg_price_cents: 2000 },
    ];
    // Skin only exists in FN range (0.0 - 0.07)
    const anchors = buildAnchors(rows, 1.0, { min_float: 0.0, max_float: 0.06 });
    expect(anchors.length).toBe(1);
    expect(anchors[0].float).toBeCloseTo(0.035, 3); // FN midpoint
  });

  it("skips rows with 0 price", () => {
    const rows = [
      { condition: "Factory New", min_price_cents: 0, avg_price_cents: 0 },
      { condition: "Minimal Wear", min_price_cents: 5000, avg_price_cents: 5000 },
    ];
    const anchors = buildAnchors(rows, 1.0);
    expect(anchors.length).toBe(1);
  });

  it("empty rows → empty anchors", () => {
    expect(buildAnchors([], 1.0)).toEqual([]);
  });
});

// ─── interpolatePrice ────────────────────────────────────────────────────────

describe("interpolatePrice", () => {
  it("interpolates linearly between two anchors", () => {
    const anchors: PriceAnchor[] = [
      { float: 0.035, price: 10000 }, // FN midpoint
      { float: 0.265, price: 4000 },  // FT midpoint
    ];
    // Midway between: float = 0.15, t = (0.15 - 0.035)/(0.265 - 0.035) = 0.5
    // price = 10000 + 0.5 * (4000 - 10000) = 7000
    expect(interpolatePrice(anchors, 0.15)).toBe(7000);
  });

  it("float below first anchor: returns anchor price if same condition", () => {
    const anchors: PriceAnchor[] = [
      { float: 0.035, price: 10000 }, // FN
    ];
    // float 0.01 is also FN → returns price
    expect(interpolatePrice(anchors, 0.01)).toBe(10000);
  });

  it("float below first anchor: returns 0 if different condition", () => {
    const anchors: PriceAnchor[] = [
      { float: 0.11, price: 5000 }, // MW midpoint
    ];
    // float 0.01 is FN, anchor is MW → returns 0
    expect(interpolatePrice(anchors, 0.01)).toBe(0);
  });

  it("float above last anchor: returns price if same condition", () => {
    const anchors: PriceAnchor[] = [
      { float: 0.265, price: 4000 }, // FT
    ];
    // float 0.30 is also FT → returns price
    expect(interpolatePrice(anchors, 0.30)).toBe(4000);
  });

  it("float above last anchor: returns 0 if different condition", () => {
    const anchors: PriceAnchor[] = [
      { float: 0.035, price: 10000 }, // FN
    ];
    // float 0.50 is BS, anchor is FN → returns 0
    expect(interpolatePrice(anchors, 0.50)).toBe(0);
  });

  it("empty anchors → 0", () => {
    expect(interpolatePrice([], 0.15)).toBe(0);
  });

  it("exact match on anchor float → returns that price", () => {
    const anchors: PriceAnchor[] = [
      { float: 0.035, price: 10000 },
      { float: 0.265, price: 4000 },
    ];
    expect(interpolatePrice(anchors, 0.035)).toBe(10000);
    expect(interpolatePrice(anchors, 0.265)).toBe(4000);
  });

  it("three anchors: interpolates between correct pair", () => {
    const anchors: PriceAnchor[] = [
      { float: 0.035, price: 10000 },
      { float: 0.11, price: 7000 },
      { float: 0.265, price: 4000 },
    ];
    // Between anchors 1 and 2: float 0.20
    // t = (0.20 - 0.11)/(0.265 - 0.11) = 0.09/0.155 ≈ 0.5806
    // price = 7000 + 0.5806 * (4000 - 7000) = 7000 - 1741.9 ≈ 5258
    const result = interpolatePrice(anchors, 0.20);
    expect(result).toBeGreaterThan(4000);
    expect(result).toBeLessThan(7000);
  });
});
