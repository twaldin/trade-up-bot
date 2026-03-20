import { describe, it, expect } from "vitest";
import {
  effectiveBuyCostRaw,
  effectiveSellProceeds,
  effectiveBuyCost,
  MARKETPLACE_FEES,
} from "../../server/engine/fees.js";
import type { ListingWithCollection } from "../../server/engine/types.js";

function makeListing(
  priceCents: number,
  source: string = "csfloat"
): ListingWithCollection {
  return {
    id: "test-listing",
    skin_id: "skin-1",
    skin_name: "AK-47 | Redline",
    weapon: "AK-47",
    price_cents: priceCents,
    float_value: 0.15,
    paint_seed: null,
    stattrak: false,
    min_float: 0.0,
    max_float: 1.0,
    rarity: "Classified",
    source,
    collection_id: "col-1",
    collection_name: "Test Collection",
  };
}

// ─── Buyer costs ────────────────────────────────────────────────────────────

describe("effectiveBuyCostRaw", () => {
  describe("CSFloat buyer fees (2.8% + $0.30 flat)", () => {
    it("$10 item → $10 * 1.028 + $0.30 = $10.58", () => {
      // 1000 * 1.028 + 30 = 1028 + 30 = 1058
      const result = effectiveBuyCostRaw(1000, "csfloat");
      expect(result).toBe(1058);
    });

    it("$100 item → $100 * 1.028 + $0.30 = $103.10", () => {
      // 10000 * 1.028 + 30 = 10280 + 30 = 10310
      const result = effectiveBuyCostRaw(10000, "csfloat");
      expect(result).toBe(10310);
    });

    it("$1 item → $1 * 1.028 + $0.30 = $1.33 (rounded)", () => {
      // 100 * 1.028 + 30 = 102.8 + 30 = 132.8 → 133
      const result = effectiveBuyCostRaw(100, "csfloat");
      expect(result).toBe(133);
    });
  });

  describe("DMarket buyer fees (2.5%)", () => {
    it("$10 item → $10 * 1.025 = $10.25", () => {
      // 1000 * 1.025 = 1025
      const result = effectiveBuyCostRaw(1000, "dmarket");
      expect(result).toBe(1025);
    });

    it("$100 item → $100 * 1.025 = $102.50", () => {
      const result = effectiveBuyCostRaw(10000, "dmarket");
      expect(result).toBe(10250);
    });

    it("$1 item → $1 * 1.025 = $1.02 (truncated)", () => {
      // 100 * 1.025 = 102.5 → 102 (Math.round rounds 0.5 down in JS for even numbers)
      const result = effectiveBuyCostRaw(100, "dmarket");
      expect(result).toBe(102);
    });
  });

  describe("Skinport buyer fees (none)", () => {
    it("$10 item → $10.00 (no buyer fee)", () => {
      const result = effectiveBuyCostRaw(1000, "skinport");
      expect(result).toBe(1000);
    });

    it("$100 item → $100.00", () => {
      const result = effectiveBuyCostRaw(10000, "skinport");
      expect(result).toBe(10000);
    });

    it("$0.01 item → $0.01", () => {
      const result = effectiveBuyCostRaw(1, "skinport");
      expect(result).toBe(1);
    });
  });

  describe("unknown source → passthrough (no fees)", () => {
    it("$10 item from unknown source → $10.00", () => {
      const result = effectiveBuyCostRaw(1000, "unknown_marketplace");
      expect(result).toBe(1000);
    });
  });

  describe("edge cases", () => {
    it("$0.01 CSFloat (very small) → rounds correctly", () => {
      // 1 * 1.028 + 30 = 1.028 + 30 = 31.028 → 31
      const result = effectiveBuyCostRaw(1, "csfloat");
      expect(result).toBe(31);
    });

    it("$10,000 CSFloat (very large) → $10,280.30", () => {
      // 1_000_000 * 1.028 + 30 = 1_028_000 + 30 = 1_028_030
      const result = effectiveBuyCostRaw(1_000_000, "csfloat");
      expect(result).toBe(1_028_030);
    });

    it("$10,000 DMarket → $10,250.00", () => {
      const result = effectiveBuyCostRaw(1_000_000, "dmarket");
      expect(result).toBe(1_025_000);
    });

    it("0 cents → just flat fee for CSFloat", () => {
      // 0 * 1.028 + 30 = 30
      const result = effectiveBuyCostRaw(0, "csfloat");
      expect(result).toBe(30);
    });
  });
});

// ─── effectiveBuyCost (listing wrapper) ────────────────────────────────────

describe("effectiveBuyCost", () => {
  it("uses listing source for fee calculation", () => {
    const listing = makeListing(1000, "dmarket");
    expect(effectiveBuyCost(listing)).toBe(1025);
  });

  it("defaults to csfloat when source is undefined", () => {
    const listing = makeListing(1000);
    listing.source = undefined as unknown as string; // simulate missing source
    // effectiveBuyCost uses listing.source ?? "csfloat"
    const result = effectiveBuyCost(listing);
    expect(result).toBe(1058); // CSFloat fees
  });
});

// ─── Seller proceeds ───────────────────────────────────────────────────────

describe("effectiveSellProceeds", () => {
  describe("CSFloat seller fee (2%)", () => {
    it("$100 sell → $98.00", () => {
      const result = effectiveSellProceeds(10000, "csfloat");
      expect(result).toBe(9800);
    });

    it("$10 sell → $9.80", () => {
      const result = effectiveSellProceeds(1000, "csfloat");
      expect(result).toBe(980);
    });
  });

  describe("DMarket seller fee (2%)", () => {
    it("$100 sell → $98.00", () => {
      const result = effectiveSellProceeds(10000, "dmarket");
      expect(result).toBe(9800);
    });

    it("$50 sell → $49.00", () => {
      const result = effectiveSellProceeds(5000, "dmarket");
      expect(result).toBe(4900);
    });
  });

  describe("Skinport seller fee (8%)", () => {
    it("$100 sell → $92.00", () => {
      const result = effectiveSellProceeds(10000, "skinport");
      expect(result).toBe(9200);
    });

    it("$10 sell → $9.20", () => {
      const result = effectiveSellProceeds(1000, "skinport");
      expect(result).toBe(920);
    });

    it("$1 sell → $0.92", () => {
      const result = effectiveSellProceeds(100, "skinport");
      expect(result).toBe(92);
    });
  });

  describe("unknown source → default 2% seller fee", () => {
    it("$100 from unknown → $98.00 (2% default)", () => {
      const result = effectiveSellProceeds(10000, "unknown");
      expect(result).toBe(9800);
    });
  });

  describe("edge cases", () => {
    it("$0.01 sell on CSFloat → rounds to 1 cent", () => {
      // 1 * 0.98 = 0.98 → Math.round(0.98) = 1
      const result = effectiveSellProceeds(1, "csfloat");
      expect(result).toBe(1);
    });

    it("$0.01 sell on Skinport → rounds to 1 cent", () => {
      // 1 * 0.92 = 0.92 → Math.round(0.92) = 1
      const result = effectiveSellProceeds(1, "skinport");
      expect(result).toBe(1);
    });

    it("$10,000 sell on CSFloat → $9,800.00", () => {
      const result = effectiveSellProceeds(1_000_000, "csfloat");
      expect(result).toBe(980_000);
    });

    it("$10,000 sell on Skinport → $9,200.00", () => {
      const result = effectiveSellProceeds(1_000_000, "skinport");
      expect(result).toBe(920_000);
    });
  });
});

// ─── Fee constants sanity checks ────────────────────────────────────────────

describe("MARKETPLACE_FEES constants", () => {
  it("CSFloat buyer: 2.8% + $0.30 flat", () => {
    expect(MARKETPLACE_FEES.csfloat.buyerFeePct).toBe(0.028);
    expect(MARKETPLACE_FEES.csfloat.buyerFeeFlat).toBe(30);
  });

  it("CSFloat seller: 2%", () => {
    expect(MARKETPLACE_FEES.csfloat.sellerFee).toBe(0.02);
  });

  it("DMarket buyer: 2.5%, no flat fee", () => {
    expect(MARKETPLACE_FEES.dmarket.buyerFeePct).toBe(0.025);
    expect(MARKETPLACE_FEES.dmarket.buyerFeeFlat).toBe(0);
  });

  it("DMarket seller: 2%", () => {
    expect(MARKETPLACE_FEES.dmarket.sellerFee).toBe(0.02);
  });

  it("Skinport buyer: no fee", () => {
    expect(MARKETPLACE_FEES.skinport.buyerFeePct).toBe(0);
    expect(MARKETPLACE_FEES.skinport.buyerFeeFlat).toBe(0);
  });

  it("Skinport seller: 8%", () => {
    expect(MARKETPLACE_FEES.skinport.sellerFee).toBe(0.08);
  });
});
