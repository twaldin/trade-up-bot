import { describe, it, expect } from "vitest";
import {
  RARITY_TIERS,
  getTierById,
  getGunTiers,
  getNewTiers,
} from "../../server/engine/rarity-tiers.js";

describe("RARITY_TIERS", () => {
  it("has exactly 6 entries", () => {
    expect(RARITY_TIERS).toHaveLength(6);
  });

  it("all IDs are unique", () => {
    const ids = RARITY_TIERS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("rarity chain is correct: Consumer→Industrial→Mil-Spec→Restricted→Classified→Covert→Extraordinary", () => {
    const expectedChain = [
      { input: "Consumer Grade", output: "Industrial Grade" },
      { input: "Industrial Grade", output: "Mil-Spec" },
      { input: "Mil-Spec", output: "Restricted" },
      { input: "Restricted", output: "Classified" },
      { input: "Classified", output: "Covert" },
      { input: "Covert", output: "Extraordinary" },
    ];
    const actualChain = RARITY_TIERS.map((t) => ({
      input: t.inputRarity,
      output: t.outputRarity,
    }));
    expect(actualChain).toEqual(expectedChain);
  });

  it("only covert_knife has isKnifeTier=true", () => {
    const knifeTiers = RARITY_TIERS.filter((t) => t.isKnifeTier);
    expect(knifeTiers).toHaveLength(1);
    expect(knifeTiers[0].id).toBe("covert_knife");
  });

  it("only classified_covert has excludeKnifeOutputs=true", () => {
    const excluded = RARITY_TIERS.filter((t) => t.excludeKnifeOutputs);
    expect(excluded).toHaveLength(1);
    expect(excluded[0].id).toBe("classified_covert");
  });

  it("only covert_knife has inputCount=5, all others have 10", () => {
    for (const tier of RARITY_TIERS) {
      if (tier.id === "covert_knife") {
        expect(tier.inputCount).toBe(5);
      } else {
        expect(tier.inputCount).toBe(10);
      }
    }
  });

  it("budget fractions are non-negative and <= 1.0", () => {
    for (const tier of RARITY_TIERS) {
      expect(tier.listingBudgetFraction).toBeGreaterThanOrEqual(0);
      expect(tier.listingBudgetFraction).toBeLessThanOrEqual(1.0);
      expect(tier.saleBudgetFraction).toBeGreaterThanOrEqual(0);
      expect(tier.saleBudgetFraction).toBeLessThanOrEqual(1.0);
    }
  });

  it("consumer and industrial tiers have zero CSFloat budget (DMarket-only)", () => {
    const dmarketOnly = RARITY_TIERS.filter(
      (t) => t.id === "consumer_industrial" || t.id === "industrial_milspec"
    );
    expect(dmarketOnly).toHaveLength(2);
    for (const tier of dmarketOnly) {
      expect(tier.listingBudgetFraction).toBe(0);
      expect(tier.saleBudgetFraction).toBe(0);
    }
  });

  it("each tier id matches its tradeUpType", () => {
    for (const tier of RARITY_TIERS) {
      expect(tier.id).toBe(tier.tradeUpType);
    }
  });
});

describe("getTierById", () => {
  it("returns correct tier for each known id", () => {
    for (const tier of RARITY_TIERS) {
      const result = getTierById(tier.id);
      expect(result).toBeDefined();
      expect(result!.id).toBe(tier.id);
      expect(result).toEqual(tier);
    }
  });

  it("returns undefined for unknown id", () => {
    expect(getTierById("nonexistent")).toBeUndefined();
    expect(getTierById("")).toBeUndefined();
  });
});

describe("getGunTiers", () => {
  it("excludes covert_knife", () => {
    const gunTiers = getGunTiers();
    const ids = gunTiers.map((t) => t.id);
    expect(ids).not.toContain("covert_knife");
  });

  it("returns exactly 5 tiers", () => {
    expect(getGunTiers()).toHaveLength(5);
  });

  it("contains all non-knife tiers", () => {
    const ids = getGunTiers().map((t) => t.id);
    expect(ids).toContain("consumer_industrial");
    expect(ids).toContain("industrial_milspec");
    expect(ids).toContain("milspec_restricted");
    expect(ids).toContain("restricted_classified");
    expect(ids).toContain("classified_covert");
  });
});

describe("getNewTiers", () => {
  it("returns exactly restricted_classified and milspec_restricted", () => {
    const newTiers = getNewTiers();
    const ids = newTiers.map((t) => t.id);
    expect(ids).toHaveLength(2);
    expect(ids).toContain("restricted_classified");
    expect(ids).toContain("milspec_restricted");
  });
});
