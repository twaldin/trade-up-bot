import { describe, it, expect } from "vitest";
import { calculateOutputFloat, calculateOutcomeProbabilities } from "../../server/engine/core.js";
import type { ListingWithCollection, DbSkinOutcome } from "../../server/engine/types.js";

// ─── calculateOutputFloat ───────────────────────────────────────────────────

describe("calculateOutputFloat", () => {
  it("10 identical inputs with float 0.05, full range (0-1) → output 0.05", () => {
    const inputs = Array.from({ length: 10 }, () => ({
      float_value: 0.05,
      min_float: 0,
      max_float: 1,
    }));
    const result = calculateOutputFloat(inputs, 0, 1);
    expect(result).toBeCloseTo(0.05, 10);
  });

  it("10 inputs float 0.15, range 0-0.5 → adjusted 0.3, output scaled to output range", () => {
    // adjusted = (0.15 - 0) / (0.5 - 0) = 0.3
    // With output range 0-1: output = 0 + 0.3 * (1 - 0) = 0.3
    const inputs = Array.from({ length: 10 }, () => ({
      float_value: 0.15,
      min_float: 0,
      max_float: 0.5,
    }));
    const result = calculateOutputFloat(inputs, 0, 1);
    expect(result).toBeCloseTo(0.3, 10);
  });

  it("10 inputs float 0.15, range 0-0.5 → output in narrow output range 0.06-0.80", () => {
    // adjusted = 0.3 (same as above)
    // output = 0.06 + 0.3 * (0.80 - 0.06) = 0.06 + 0.3 * 0.74 = 0.06 + 0.222 = 0.282
    const inputs = Array.from({ length: 10 }, () => ({
      float_value: 0.15,
      min_float: 0,
      max_float: 0.5,
    }));
    const result = calculateOutputFloat(inputs, 0.06, 0.80);
    expect(result).toBeCloseTo(0.282, 10);
  });

  it("all inputs at min_float → output at output min_float", () => {
    const inputs = Array.from({ length: 10 }, () => ({
      float_value: 0.06,
      min_float: 0.06,
      max_float: 0.80,
    }));
    // adjusted = (0.06 - 0.06) / (0.80 - 0.06) = 0
    // output = 0.00 + 0 * (0.45 - 0.00) = 0.00
    const result = calculateOutputFloat(inputs, 0.00, 0.45);
    expect(result).toBeCloseTo(0.00, 10);
  });

  it("all inputs at max_float → output at output max_float", () => {
    const inputs = Array.from({ length: 10 }, () => ({
      float_value: 0.80,
      min_float: 0.06,
      max_float: 0.80,
    }));
    // adjusted = (0.80 - 0.06) / (0.80 - 0.06) = 1.0
    // output = 0.00 + 1.0 * (0.45 - 0.00) = 0.45
    const result = calculateOutputFloat(inputs, 0.00, 0.45);
    expect(result).toBeCloseTo(0.45, 10);
  });

  it("condition boundary: inputs producing output float 0.069 (FN)", () => {
    // We want output = 0.069 with output range 0-1
    // So avg adjusted = 0.069
    // With input range 0-1: float_value = 0.069
    const inputs = Array.from({ length: 10 }, () => ({
      float_value: 0.069,
      min_float: 0,
      max_float: 1,
    }));
    const result = calculateOutputFloat(inputs, 0, 1);
    expect(result).toBeCloseTo(0.069, 10);
    expect(result).toBeLessThan(0.07); // Factory New
  });

  it("condition boundary: inputs producing output float 0.071 (MW)", () => {
    const inputs = Array.from({ length: 10 }, () => ({
      float_value: 0.071,
      min_float: 0,
      max_float: 1,
    }));
    const result = calculateOutputFloat(inputs, 0, 1);
    expect(result).toBeCloseTo(0.071, 10);
    expect(result).toBeGreaterThanOrEqual(0.07); // Minimal Wear
  });

  it("mixed float ranges: inputs from different skins with different min/max", () => {
    const inputs = [
      // Skin A: range 0.00-0.50, float 0.10 → adjusted = 0.10/0.50 = 0.20
      { float_value: 0.10, min_float: 0.00, max_float: 0.50 },
      { float_value: 0.10, min_float: 0.00, max_float: 0.50 },
      { float_value: 0.10, min_float: 0.00, max_float: 0.50 },
      { float_value: 0.10, min_float: 0.00, max_float: 0.50 },
      { float_value: 0.10, min_float: 0.00, max_float: 0.50 },
      // Skin B: range 0.06-0.80, float 0.43 → adjusted = (0.43-0.06)/(0.80-0.06) = 0.37/0.74 = 0.50
      { float_value: 0.43, min_float: 0.06, max_float: 0.80 },
      { float_value: 0.43, min_float: 0.06, max_float: 0.80 },
      { float_value: 0.43, min_float: 0.06, max_float: 0.80 },
      { float_value: 0.43, min_float: 0.06, max_float: 0.80 },
      { float_value: 0.43, min_float: 0.06, max_float: 0.80 },
    ];
    // avg adjusted = (5*0.20 + 5*0.50) / 10 = (1.0 + 2.5) / 10 = 0.35
    // output range 0-1: output = 0.35
    const result = calculateOutputFloat(inputs, 0, 1);
    expect(result).toBeCloseTo(0.35, 10);
  });

  it("5 inputs (knife trade-up) with identical floats", () => {
    const inputs = Array.from({ length: 5 }, () => ({
      float_value: 0.20,
      min_float: 0,
      max_float: 1,
    }));
    const result = calculateOutputFloat(inputs, 0.06, 0.80);
    // adjusted = 0.20, output = 0.06 + 0.20 * (0.80 - 0.06) = 0.06 + 0.148 = 0.208
    expect(result).toBeCloseTo(0.208, 10);
  });

  it("clamped to output min when calculation would go below", () => {
    // If all adjusted values are 0, output = outputMinFloat
    const inputs = Array.from({ length: 10 }, () => ({
      float_value: 0.06,
      min_float: 0.06,
      max_float: 0.80,
    }));
    const result = calculateOutputFloat(inputs, 0.10, 0.50);
    expect(result).toBe(0.10);
  });

  it("clamped to output max when calculation would go above", () => {
    // All adjusted = 1.0, output = outputMaxFloat
    const inputs = Array.from({ length: 10 }, () => ({
      float_value: 0.80,
      min_float: 0.06,
      max_float: 0.80,
    }));
    const result = calculateOutputFloat(inputs, 0.10, 0.50);
    expect(result).toBe(0.50);
  });

  it("zero-range input (min === max) → adjusted treated as 0", () => {
    const inputs = [
      { float_value: 0.50, min_float: 0.50, max_float: 0.50 },
      { float_value: 0.20, min_float: 0.00, max_float: 1.00 },
    ];
    // First: range = 0 → adjusted = 0
    // Second: adjusted = 0.20
    // avg = (0 + 0.20) / 2 = 0.10
    // output range 0-1: output = 0.10
    const result = calculateOutputFloat(inputs, 0, 1);
    expect(result).toBeCloseTo(0.10, 10);
  });
});

// ─── calculateOutcomeProbabilities ──────────────────────────────────────────

describe("calculateOutcomeProbabilities", () => {
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
      collection_name: "Collection A",
      ...overrides,
    };
  }

  function makeOutcome(overrides: Partial<DbSkinOutcome> = {}): DbSkinOutcome {
    return {
      id: "skin-out-1",
      name: "AK-47 | Fire Serpent",
      weapon: "AK-47",
      min_float: 0.0,
      max_float: 1.0,
      rarity: "Covert",
      collection_id: "col-1",
      collection_name: "Collection A",
      ...overrides,
    };
  }

  it("single collection, single outcome → probability 1.0", () => {
    const inputs = Array.from({ length: 10 }, (_, i) =>
      makeInput({ id: `l-${i}` })
    );
    const outcomes = [makeOutcome()];
    const result = calculateOutcomeProbabilities(inputs, outcomes);
    expect(result).toHaveLength(1);
    expect(result[0].probability).toBeCloseTo(1.0, 10);
  });

  it("single collection, two outcomes → each gets 0.5", () => {
    const inputs = Array.from({ length: 10 }, (_, i) =>
      makeInput({ id: `l-${i}` })
    );
    const outcomes = [
      makeOutcome({ id: "out-1", name: "AK-47 | Fire Serpent" }),
      makeOutcome({ id: "out-2", name: "M4A4 | Howl" }),
    ];
    const result = calculateOutcomeProbabilities(inputs, outcomes);
    expect(result).toHaveLength(2);
    expect(result[0].probability).toBeCloseTo(0.5, 10);
    expect(result[1].probability).toBeCloseTo(0.5, 10);
  });

  it("two collections equally split → outcomes weighted by collection share", () => {
    const inputs = [
      ...Array.from({ length: 5 }, (_, i) =>
        makeInput({ id: `a-${i}`, collection_id: "col-1", collection_name: "Collection A" })
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        makeInput({ id: `b-${i}`, collection_id: "col-2", collection_name: "Collection B" })
      ),
    ];
    const outcomes = [
      makeOutcome({ id: "out-1", collection_id: "col-1", collection_name: "Collection A" }),
      makeOutcome({ id: "out-2", collection_id: "col-2", collection_name: "Collection B" }),
    ];
    const result = calculateOutcomeProbabilities(inputs, outcomes);
    expect(result).toHaveLength(2);
    // Each collection has 5/10 = 0.5 weight, 1 outcome each → 0.5
    expect(result[0].probability).toBeCloseTo(0.5, 10);
    expect(result[1].probability).toBeCloseTo(0.5, 10);
  });

  it("uneven collection split → probabilities reflect input distribution", () => {
    const inputs = [
      ...Array.from({ length: 7 }, (_, i) =>
        makeInput({ id: `a-${i}`, collection_id: "col-1", collection_name: "Collection A" })
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        makeInput({ id: `b-${i}`, collection_id: "col-2", collection_name: "Collection B" })
      ),
    ];
    const outcomes = [
      makeOutcome({ id: "out-1", collection_id: "col-1", collection_name: "Collection A" }),
      makeOutcome({ id: "out-2", collection_id: "col-2", collection_name: "Collection B" }),
    ];
    const result = calculateOutcomeProbabilities(inputs, outcomes);
    expect(result).toHaveLength(2);
    const probA = result.find((r) => r.outcome.collection_id === "col-1")!.probability;
    const probB = result.find((r) => r.outcome.collection_id === "col-2")!.probability;
    expect(probA).toBeCloseTo(0.7, 10);
    expect(probB).toBeCloseTo(0.3, 10);
  });

  it("collection with 2 outcomes splits its probability evenly among them", () => {
    const inputs = Array.from({ length: 10 }, (_, i) =>
      makeInput({ id: `l-${i}`, collection_id: "col-1" })
    );
    const outcomes = [
      makeOutcome({ id: "out-1", name: "Skin 1", collection_id: "col-1" }),
      makeOutcome({ id: "out-2", name: "Skin 2", collection_id: "col-1" }),
      makeOutcome({ id: "out-3", name: "Skin 3", collection_id: "col-1" }),
    ];
    const result = calculateOutcomeProbabilities(inputs, outcomes);
    expect(result).toHaveLength(3);
    for (const r of result) {
      expect(r.probability).toBeCloseTo(1 / 3, 10);
    }
  });

  it("probabilities sum to 1.0", () => {
    const inputs = [
      ...Array.from({ length: 6 }, (_, i) =>
        makeInput({ id: `a-${i}`, collection_id: "col-1", collection_name: "Collection A" })
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        makeInput({ id: `b-${i}`, collection_id: "col-2", collection_name: "Collection B" })
      ),
    ];
    const outcomes = [
      makeOutcome({ id: "out-1", name: "S1", collection_id: "col-1", collection_name: "Collection A" }),
      makeOutcome({ id: "out-2", name: "S2", collection_id: "col-1", collection_name: "Collection A" }),
      makeOutcome({ id: "out-3", name: "S3", collection_id: "col-2", collection_name: "Collection B" }),
    ];
    const result = calculateOutcomeProbabilities(inputs, outcomes);
    const totalProb = result.reduce((s, r) => s + r.probability, 0);
    expect(totalProb).toBeCloseTo(1.0, 10);
  });

  it("empty inputs → empty result", () => {
    const result = calculateOutcomeProbabilities([], [makeOutcome()]);
    expect(result).toHaveLength(0);
  });

  it("outcome collection with no matching inputs → excluded", () => {
    const inputs = Array.from({ length: 10 }, (_, i) =>
      makeInput({ id: `l-${i}`, collection_id: "col-1" })
    );
    const outcomes = [
      makeOutcome({ id: "out-1", collection_id: "col-1" }),
      makeOutcome({ id: "out-2", collection_id: "col-999" }), // no inputs from this collection
    ];
    const result = calculateOutcomeProbabilities(inputs, outcomes);
    expect(result).toHaveLength(1);
    expect(result[0].outcome.collection_id).toBe("col-1");
    expect(result[0].probability).toBeCloseTo(1.0, 10);
  });
});
