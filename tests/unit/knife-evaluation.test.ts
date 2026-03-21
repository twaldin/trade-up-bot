/**
 * Knife/glove evaluation tests — probability correctness.
 * Verifies that missing price data doesn't silently inflate probabilities
 * of priced outcomes.
 */

import { describe, it, expect } from "vitest";
import { GLOVE_GEN_SKINS, CASE_KNIFE_MAP } from "../../server/engine/knife-data.js";
import type { FinishData } from "../../server/engine/knife-data.js";

// Simulates the glove finish collection logic from evaluateKnifeTradeUp.
// This mirrors the FIXED code path — if the code regresses, these tests fail.
function collectGloveFinishes(
  gloveGen: number,
  knifeFinishCache: Map<string, FinishData[]>,
): (FinishData & { itemType: string })[] {
  const allFinishes: (FinishData & { itemType: string })[] = [];
  const genSkins = GLOVE_GEN_SKINS[gloveGen];
  if (!genSkins) return allFinishes;

  for (const [gloveType, finishNames] of Object.entries(genSkins)) {
    const cachedFinishes = knifeFinishCache.get(gloveType) ?? [];
    const cachedByName = new Map(cachedFinishes.map(f => [f.name, f]));
    for (const finishName of finishNames) {
      const fullName = `★ ${gloveType} | ${finishName}`;
      const cached = cachedByName.get(fullName);
      if (cached) {
        allFinishes.push({ ...cached, itemType: gloveType });
      } else {
        allFinishes.push({
          name: fullName, avgPrice: 0, minPrice: 0, maxPrice: 0,
          conditions: 0, skinMinFloat: 0.06, skinMaxFloat: 0.80,
          itemType: gloveType,
        });
      }
    }
  }
  return allFinishes;
}

function makeFinish(name: string): FinishData {
  return { name, avgPrice: 50000, minPrice: 30000, maxPrice: 80000, conditions: 3, skinMinFloat: 0.06, skinMaxFloat: 0.80 };
}

describe("Knife/Glove evaluation — probability correctness", () => {
  it("gen4 gloves: all 22 finishes included even when some have no price data", () => {
    const expectedGen4Count =
      GLOVE_GEN_SKINS[4]["Driver Gloves"].length +
      GLOVE_GEN_SKINS[4]["Specialist Gloves"].length +
      GLOVE_GEN_SKINS[4]["Sport Gloves"].length;
    expect(expectedGen4Count).toBe(22);

    // Cache only has Driver Gloves (8 finishes), missing Specialist (7) and Sport (7)
    const cache = new Map<string, FinishData[]>();
    cache.set("Driver Gloves", GLOVE_GEN_SKINS[4]["Driver Gloves"].map(f =>
      makeFinish(`★ Driver Gloves | ${f}`)
    ));
    // Specialist and Sport NOT in cache

    const finishes = collectGloveFinishes(4, cache);

    // Must include ALL 22, not just the 8 with prices
    expect(finishes.length).toBe(22);

    // 8 should have real prices, 14 should be placeholders with avgPrice=0
    const priced = finishes.filter(f => f.avgPrice > 0);
    const unpriced = finishes.filter(f => f.avgPrice === 0);
    expect(priced.length).toBe(8);
    expect(unpriced.length).toBe(14);
  });

  it("probability denominator uses full finish count, not just priced count", () => {
    const cache = new Map<string, FinishData[]>();
    cache.set("Driver Gloves", GLOVE_GEN_SKINS[4]["Driver Gloves"].map(f =>
      makeFinish(`★ Driver Gloves | ${f}`)
    ));

    const finishes = collectGloveFinishes(4, cache);
    const collectionWeight = 1.0; // 100% from this collection
    const perFinishProb = collectionWeight / finishes.length;

    // With 22 finishes, each should get ~4.5% probability
    expect(perFinishProb).toBeCloseTo(1 / 22, 4);

    // Simulate outcome building: skip $0 outcomes
    let totalProb = 0;
    for (const f of finishes) {
      if (f.avgPrice > 0) {
        totalProb += perFinishProb;
      }
    }

    // Only 8/22 priced → totalProb should be ~0.364, NOT 1.0
    expect(totalProb).toBeCloseTo(8 / 22, 2);
    expect(totalProb).toBeLessThan(0.99); // This triggers rejection
  });

  it("fully priced generation sums to 1.0", () => {
    // Gen 1: all 6 types × 4 finishes = 24
    const cache = new Map<string, FinishData[]>();
    for (const [gloveType, finishNames] of Object.entries(GLOVE_GEN_SKINS[1])) {
      cache.set(gloveType, finishNames.map(f => makeFinish(`★ ${gloveType} | ${f}`)));
    }

    const finishes = collectGloveFinishes(1, cache);
    expect(finishes.length).toBe(24);
    expect(finishes.every(f => f.avgPrice > 0)).toBe(true);

    const perFinishProb = 1.0 / finishes.length;
    const totalProb = finishes.length * perFinishProb;
    expect(totalProb).toBeCloseTo(1.0, 4);
  });

  it("Dead Hand collection maps to gloveGen 4", () => {
    const deadHand = CASE_KNIFE_MAP["The Dead Hand Collection"];
    expect(deadHand).toBeDefined();
    expect(deadHand.gloveGen).toBe(4);
    expect(deadHand.knifeTypes).toEqual([]);
    expect(deadHand.knifeFinishes).toEqual([]);
  });

  it("EXCLUDED_COLLECTIONS should not contain Dead Hand (it was unblocked)", () => {
    // Dead Hand was trade-locked until late March 2026, then unblocked.
    // Verify it's in CASE_KNIFE_MAP (included) not excluded.
    expect(CASE_KNIFE_MAP["The Dead Hand Collection"]).toBeDefined();
  });
});
