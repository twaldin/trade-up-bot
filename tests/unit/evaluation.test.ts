import { describe, it, expect } from "vitest";
import { calculateOutputFloat, calculateOutcomeProbabilities } from "../../server/engine/core.js";
import { effectiveBuyCost } from "../../server/engine/fees.js";
import { floatToCondition } from "../../shared/types.js";
import type { ListingWithCollection, DbSkinOutcome } from "../../server/engine/types.js";
import type { TradeUpOutcome } from "../../shared/types.js";

/**
 * evaluateTradeUp() depends on the DB via lookupOutputPrice().
 * Rather than mocking the DB, we test the LOGIC by re-implementing the
 * evaluation pipeline with known output prices, verifying the math is correct.
 *
 * This tests: cost calculation, float prediction, probability distribution,
 * EV, profit, ROI, chance_to_profit, best_case, worst_case.
 */

function makeInput(overrides: Partial<ListingWithCollection> = {}): ListingWithCollection {
  return {
    id: "listing-1",
    skin_id: "skin-1",
    skin_name: "AK-47 | Redline",
    weapon: "AK-47",
    price_cents: 500,
    float_value: 0.15,
    paint_seed: null,
    stattrak: 0,
    min_float: 0.0,
    max_float: 1.0,
    rarity: "Classified",
    source: "csfloat",
    collection_id: "col-1",
    collection_name: "Operation Phoenix",
    ...overrides,
  };
}

function makeOutcome(overrides: Partial<DbSkinOutcome> = {}): DbSkinOutcome {
  return {
    id: "skin-out-1",
    name: "AK-47 | Fire Serpent",
    weapon: "AK-47",
    min_float: 0.06,
    max_float: 0.76,
    rarity: "Covert",
    collection_id: "col-1",
    collection_name: "Operation Phoenix",
    ...overrides,
  };
}

/**
 * Simulate evaluateTradeUp logic without DB dependency.
 * Uses provided output prices instead of lookupOutputPrice().
 */
function evaluateWithKnownPrices(
  inputs: ListingWithCollection[],
  outcomes: DbSkinOutcome[],
  outputPrices: Map<string, number> // skin name → price in cents
) {
  const totalCost = inputs.reduce((sum, i) => sum + effectiveBuyCost(i), 0);

  const inputFloats = inputs.map((i) => ({
    float_value: i.float_value,
    min_float: i.min_float,
    max_float: i.max_float,
  }));

  const probabilities = calculateOutcomeProbabilities(inputs, outcomes);

  let ev = 0;
  const tradeUpOutcomes: TradeUpOutcome[] = [];

  for (const { outcome, probability } of probabilities) {
    const predFloat = calculateOutputFloat(inputFloats, outcome.min_float, outcome.max_float);
    const predCondition = floatToCondition(predFloat);
    const price = outputPrices.get(outcome.name) ?? 0;
    ev += probability * price;
    tradeUpOutcomes.push({
      skin_id: outcome.id,
      skin_name: outcome.name,
      collection_name: outcome.collection_name,
      probability,
      predicted_float: predFloat,
      predicted_condition: predCondition,
      estimated_price_cents: price,
    });
  }

  const evCents = Math.round(ev);
  const profit = evCents - totalCost;
  const roi = totalCost > 0 ? (profit / totalCost) * 100 : 0;
  const chanceToProfit = tradeUpOutcomes.reduce(
    (sum, o) => sum + (o.estimated_price_cents > totalCost ? o.probability : 0),
    0
  );
  const bestCase = Math.max(...tradeUpOutcomes.map((o) => o.estimated_price_cents)) - totalCost;
  const worstCase = Math.min(...tradeUpOutcomes.map((o) => o.estimated_price_cents)) - totalCost;

  return {
    totalCost,
    evCents,
    profit,
    roi: Math.round(roi * 100) / 100,
    chanceToProfit: Math.round(chanceToProfit * 10000) / 10000,
    outcomes: tradeUpOutcomes,
    bestCase,
    worstCase,
  };
}

// ─── Evaluation pipeline tests ──────────────────────────────────────────────

describe("Trade-up evaluation logic", () => {
  describe("cost calculation", () => {
    it("sums effective buy costs for all inputs", () => {
      // 10 CSFloat listings at $5.00 each
      // effective cost = 500 * 1.028 + 30 = 514 + 30 = 544 each
      const inputs = Array.from({ length: 10 }, (_, i) =>
        makeInput({ id: `l-${i}`, price_cents: 500, source: "csfloat" })
      );
      const totalCost = inputs.reduce((sum, i) => sum + effectiveBuyCost(i), 0);
      expect(totalCost).toBe(5440); // 544 * 10
    });

    it("handles mixed marketplace sources", () => {
      const inputs = [
        makeInput({ id: "l-1", price_cents: 1000, source: "csfloat" }),
        makeInput({ id: "l-2", price_cents: 1000, source: "dmarket" }),
        makeInput({ id: "l-3", price_cents: 1000, source: "skinport" }),
      ];
      const totalCost = inputs.reduce((sum, i) => sum + effectiveBuyCost(i), 0);
      // CSFloat: 1000*1.028+30 = 1058
      // DMarket: 1000*1.025 = 1025
      // Skinport: 1000
      expect(totalCost).toBe(1058 + 1025 + 1000);
    });
  });

  describe("profit calculation", () => {
    it("positive profit: EV exceeds cost", () => {
      const inputs = Array.from({ length: 10 }, (_, i) =>
        makeInput({ id: `l-${i}`, price_cents: 500, source: "csfloat" })
      );
      const outcomes = [makeOutcome()];
      const outputPrices = new Map([["AK-47 | Fire Serpent", 10000]]);

      const result = evaluateWithKnownPrices(inputs, outcomes, outputPrices);
      // totalCost = 5440, EV = 10000, profit = 4560
      expect(result.totalCost).toBe(5440);
      expect(result.evCents).toBe(10000);
      expect(result.profit).toBe(4560);
    });

    it("negative profit: cost exceeds EV", () => {
      const inputs = Array.from({ length: 10 }, (_, i) =>
        makeInput({ id: `l-${i}`, price_cents: 1500, source: "csfloat" })
      );
      const outcomes = [makeOutcome()];
      const outputPrices = new Map([["AK-47 | Fire Serpent", 5000]]);

      const result = evaluateWithKnownPrices(inputs, outcomes, outputPrices);
      // totalCost = (1500*1.028+30)*10 = 1572*10 = 15720
      expect(result.totalCost).toBe(15720);
      expect(result.evCents).toBe(5000);
      expect(result.profit).toBe(5000 - 15720);
      expect(result.profit).toBeLessThan(0);
    });
  });

  describe("ROI calculation", () => {
    it("ROI = profit / cost * 100", () => {
      const inputs = Array.from({ length: 10 }, (_, i) =>
        makeInput({ id: `l-${i}`, price_cents: 500, source: "skinport" }) // no buyer fee
      );
      const outcomes = [makeOutcome()];
      const outputPrices = new Map([["AK-47 | Fire Serpent", 10000]]);

      const result = evaluateWithKnownPrices(inputs, outcomes, outputPrices);
      // totalCost = 5000 (no fees), EV = 10000, profit = 5000
      // ROI = 5000/5000 * 100 = 100%
      expect(result.totalCost).toBe(5000);
      expect(result.roi).toBe(100.0);
    });

    it("50% ROI with 1.5x return", () => {
      const inputs = Array.from({ length: 10 }, (_, i) =>
        makeInput({ id: `l-${i}`, price_cents: 200, source: "skinport" })
      );
      const outcomes = [makeOutcome()];
      const outputPrices = new Map([["AK-47 | Fire Serpent", 3000]]);

      const result = evaluateWithKnownPrices(inputs, outcomes, outputPrices);
      // cost = 2000, EV = 3000, profit = 1000, ROI = 50%
      expect(result.roi).toBe(50.0);
    });
  });

  describe("chance to profit", () => {
    it("single outcome worth more than cost → 100% chance", () => {
      const inputs = Array.from({ length: 10 }, (_, i) =>
        makeInput({ id: `l-${i}`, price_cents: 200, source: "skinport" })
      );
      const outcomes = [makeOutcome()];
      const outputPrices = new Map([["AK-47 | Fire Serpent", 5000]]);

      const result = evaluateWithKnownPrices(inputs, outcomes, outputPrices);
      // cost = 2000, outcome price = 5000 > 2000 → probability 1.0
      expect(result.chanceToProfit).toBe(1.0);
    });

    it("single outcome worth less than cost → 0% chance", () => {
      const inputs = Array.from({ length: 10 }, (_, i) =>
        makeInput({ id: `l-${i}`, price_cents: 1000, source: "skinport" })
      );
      const outcomes = [makeOutcome()];
      const outputPrices = new Map([["AK-47 | Fire Serpent", 5000]]);

      const result = evaluateWithKnownPrices(inputs, outcomes, outputPrices);
      // cost = 10000, outcome price = 5000 < 10000 → 0%
      expect(result.chanceToProfit).toBe(0);
    });

    it("mixed outcomes: some profitable, some not → partial chance", () => {
      const inputs = [
        ...Array.from({ length: 5 }, (_, i) =>
          makeInput({ id: `a-${i}`, collection_id: "col-1", collection_name: "Collection A", price_cents: 600, source: "skinport" })
        ),
        ...Array.from({ length: 5 }, (_, i) =>
          makeInput({ id: `b-${i}`, collection_id: "col-2", collection_name: "Collection B", price_cents: 600, source: "skinport" })
        ),
      ];
      const outcomes = [
        makeOutcome({ id: "o1", name: "Expensive Skin", collection_id: "col-1", collection_name: "Collection A" }),
        makeOutcome({ id: "o2", name: "Cheap Skin", collection_id: "col-2", collection_name: "Collection B" }),
      ];
      const outputPrices = new Map([
        ["Expensive Skin", 10000], // profitable (10000 > 6000 total cost)
        ["Cheap Skin", 2000],      // not profitable (2000 < 6000)
      ]);

      const result = evaluateWithKnownPrices(inputs, outcomes, outputPrices);
      // Each collection has 5/10 = 50% weight, 1 outcome each
      // Expensive: prob 0.5, price 10000 > 6000 cost → adds 0.5
      // Cheap: prob 0.5, price 2000 < 6000 cost → adds 0
      expect(result.chanceToProfit).toBe(0.5);
    });
  });

  describe("best case and worst case", () => {
    it("calculates best and worst outcomes correctly", () => {
      const inputs = [
        ...Array.from({ length: 5 }, (_, i) =>
          makeInput({ id: `a-${i}`, collection_id: "col-1", collection_name: "Collection A", price_cents: 500, source: "skinport" })
        ),
        ...Array.from({ length: 5 }, (_, i) =>
          makeInput({ id: `b-${i}`, collection_id: "col-2", collection_name: "Collection B", price_cents: 500, source: "skinport" })
        ),
      ];
      const outcomes = [
        makeOutcome({ id: "o1", name: "High Skin", collection_id: "col-1", collection_name: "Collection A" }),
        makeOutcome({ id: "o2", name: "Low Skin", collection_id: "col-2", collection_name: "Collection B" }),
      ];
      const outputPrices = new Map([
        ["High Skin", 20000],
        ["Low Skin", 3000],
      ]);

      const result = evaluateWithKnownPrices(inputs, outcomes, outputPrices);
      // cost = 5000
      // best_case = 20000 - 5000 = 15000
      // worst_case = 3000 - 5000 = -2000
      expect(result.bestCase).toBe(15000);
      expect(result.worstCase).toBe(-2000);
    });

    it("all outcomes profitable → worst case still positive", () => {
      const inputs = Array.from({ length: 10 }, (_, i) =>
        makeInput({ id: `l-${i}`, price_cents: 100, source: "skinport" })
      );
      const outcomes = [
        makeOutcome({ id: "o1", name: "Skin A" }),
        makeOutcome({ id: "o2", name: "Skin B" }),
      ];
      // Need both in same collection for probabilities to work
      const outputPrices = new Map([
        ["Skin A", 5000],
        ["Skin B", 3000],
      ]);

      const result = evaluateWithKnownPrices(inputs, outcomes, outputPrices);
      // cost = 1000
      expect(result.bestCase).toBe(4000);  // 5000 - 1000
      expect(result.worstCase).toBe(2000); // 3000 - 1000
      expect(result.worstCase).toBeGreaterThan(0);
      expect(result.chanceToProfit).toBe(1.0);
    });
  });

  describe("float prediction", () => {
    it("predicted float maps to correct condition", () => {
      // Inputs at float 0.04 with range 0-1 → adjusted = 0.04
      // Output range 0.06-0.76: output = 0.06 + 0.04 * 0.70 = 0.06 + 0.028 = 0.088
      const inputs = Array.from({ length: 10 }, (_, i) =>
        makeInput({ id: `l-${i}`, float_value: 0.04 })
      );
      const outcome = makeOutcome({ min_float: 0.06, max_float: 0.76 });

      const predFloat = calculateOutputFloat(
        inputs.map((i) => ({ float_value: i.float_value, min_float: i.min_float, max_float: i.max_float })),
        outcome.min_float,
        outcome.max_float
      );
      expect(predFloat).toBeCloseTo(0.088, 5);
      expect(floatToCondition(predFloat)).toBe("Minimal Wear");
    });

    it("very low float inputs produce Factory New output", () => {
      const inputs = Array.from({ length: 10 }, (_, i) =>
        makeInput({ id: `l-${i}`, float_value: 0.001 })
      );
      const outcome = makeOutcome({ min_float: 0.0, max_float: 1.0 });
      const predFloat = calculateOutputFloat(
        inputs.map((i) => ({ float_value: i.float_value, min_float: i.min_float, max_float: i.max_float })),
        outcome.min_float,
        outcome.max_float
      );
      expect(predFloat).toBeCloseTo(0.001, 5);
      expect(floatToCondition(predFloat)).toBe("Factory New");
    });

    it("high float inputs produce Battle-Scarred output", () => {
      const inputs = Array.from({ length: 10 }, (_, i) =>
        makeInput({ id: `l-${i}`, float_value: 0.90 })
      );
      const outcome = makeOutcome({ min_float: 0.0, max_float: 1.0 });
      const predFloat = calculateOutputFloat(
        inputs.map((i) => ({ float_value: i.float_value, min_float: i.min_float, max_float: i.max_float })),
        outcome.min_float,
        outcome.max_float
      );
      expect(predFloat).toBeCloseTo(0.90, 5);
      expect(floatToCondition(predFloat)).toBe("Battle-Scarred");
    });
  });

  describe("EV with multiple weighted outcomes", () => {
    it("EV = sum of (probability * price) for each outcome", () => {
      const inputs = [
        ...Array.from({ length: 7 }, (_, i) =>
          makeInput({ id: `a-${i}`, collection_id: "col-1", collection_name: "Collection A", price_cents: 300, source: "skinport" })
        ),
        ...Array.from({ length: 3 }, (_, i) =>
          makeInput({ id: `b-${i}`, collection_id: "col-2", collection_name: "Collection B", price_cents: 300, source: "skinport" })
        ),
      ];
      const outcomes = [
        makeOutcome({ id: "o1", name: "Skin A", collection_id: "col-1", collection_name: "Collection A" }),
        makeOutcome({ id: "o2", name: "Skin B", collection_id: "col-2", collection_name: "Collection B" }),
      ];
      const outputPrices = new Map([
        ["Skin A", 10000],
        ["Skin B", 2000],
      ]);

      const result = evaluateWithKnownPrices(inputs, outcomes, outputPrices);
      // Skin A: prob = 7/10 = 0.7, price = 10000 → 7000
      // Skin B: prob = 3/10 = 0.3, price = 2000 → 600
      // EV = 7600
      expect(result.evCents).toBe(7600);
      // cost = 3000
      expect(result.profit).toBe(4600);
    });

    it("collection with multiple outcomes splits probability", () => {
      const inputs = Array.from({ length: 10 }, (_, i) =>
        makeInput({ id: `l-${i}`, price_cents: 500, source: "skinport" })
      );
      const outcomes = [
        makeOutcome({ id: "o1", name: "Skin 1" }),
        makeOutcome({ id: "o2", name: "Skin 2" }),
        makeOutcome({ id: "o3", name: "Skin 3" }),
      ];
      const outputPrices = new Map([
        ["Skin 1", 9000],
        ["Skin 2", 6000],
        ["Skin 3", 3000],
      ]);

      const result = evaluateWithKnownPrices(inputs, outcomes, outputPrices);
      // Each outcome: prob 1/3
      // EV = (9000 + 6000 + 3000) / 3 = 6000
      expect(result.evCents).toBe(6000);
      // cost = 5000, profit = 1000
      expect(result.profit).toBe(1000);
    });
  });
});

// ─── floatToCondition ───────────────────────────────────────────────────────

describe("floatToCondition", () => {
  it("0.00 → Factory New", () => {
    expect(floatToCondition(0.00)).toBe("Factory New");
  });

  it("0.069 → Factory New (just below boundary)", () => {
    expect(floatToCondition(0.069)).toBe("Factory New");
  });

  it("0.07 → Minimal Wear (at boundary)", () => {
    expect(floatToCondition(0.07)).toBe("Minimal Wear");
  });

  it("0.10 → Minimal Wear", () => {
    expect(floatToCondition(0.10)).toBe("Minimal Wear");
  });

  it("0.15 → Field-Tested (at boundary)", () => {
    expect(floatToCondition(0.15)).toBe("Field-Tested");
  });

  it("0.30 → Field-Tested", () => {
    expect(floatToCondition(0.30)).toBe("Field-Tested");
  });

  it("0.38 → Well-Worn (at boundary)", () => {
    expect(floatToCondition(0.38)).toBe("Well-Worn");
  });

  it("0.44 → Well-Worn", () => {
    expect(floatToCondition(0.44)).toBe("Well-Worn");
  });

  it("0.45 → Battle-Scarred (at boundary)", () => {
    expect(floatToCondition(0.45)).toBe("Battle-Scarred");
  });

  it("0.99 → Battle-Scarred", () => {
    expect(floatToCondition(0.99)).toBe("Battle-Scarred");
  });

  it("1.0 → Battle-Scarred (max float)", () => {
    expect(floatToCondition(1.0)).toBe("Battle-Scarred");
  });
});
