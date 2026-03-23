import { describe, it, expect } from "vitest";
import { buildSnapshot } from "../../server/build-snapshot.js";
import type { TradeUpInput, TradeUpOutcome } from "../../shared/types.js";

describe("buildSnapshot", () => {
  const inputs: TradeUpInput[] = [
    { listing_id: "l1", skin_id: "s1", skin_name: "AK-47 | Redline", collection_name: "Col A", price_cents: 500, float_value: 0.15, condition: "Field-Tested", source: "csfloat" },
    { listing_id: "l2", skin_id: "s1", skin_name: "AK-47 | Redline", collection_name: "Col A", price_cents: 600, float_value: 0.18, condition: "Field-Tested", source: "skinport" },
  ];

  const outcomes: TradeUpOutcome[] = [
    { skin_id: "out1", skin_name: "AK-47 | Fire Serpent", collection_name: "Col A", probability: 0.7, predicted_float: 0.15, predicted_condition: "Field-Tested", estimated_price_cents: 10000 },
    { skin_id: "out2", skin_name: "M4A1-S | Chantico's Fire", collection_name: "Col A", probability: 0.3, predicted_float: 0.12, predicted_condition: "Minimal Wear", estimated_price_cents: 5000 },
  ];

  const tradeUpMeta = {
    trade_up_id: 42,
    total_cost_cents: 1100,
    expected_value_cents: 8500,
    roi_percentage: 672.73,
    chance_to_profit: 0.7,
    best_case_cents: 8900,
    worst_case_cents: 3900,
    type: "classified_covert",
  };

  it("builds snapshot_inputs with correct fields", () => {
    const snap = buildSnapshot(inputs, outcomes, tradeUpMeta);
    expect(snap.snapshot_inputs).toHaveLength(2);
    expect(snap.snapshot_inputs[0]).toEqual({
      skin_name: "AK-47 | Redline",
      collection_name: "Col A",
      price_cents: 500,
      float_value: 0.15,
      condition: "Field-Tested",
      source: "csfloat",
      stattrak: false,
    });
  });

  it("builds snapshot_outcomes with predicted_float", () => {
    const snap = buildSnapshot(inputs, outcomes, tradeUpMeta);
    expect(snap.snapshot_outcomes).toHaveLength(2);
    expect(snap.snapshot_outcomes[0]).toEqual({
      skin_name: "AK-47 | Fire Serpent",
      skin_id: "out1",
      probability: 0.7,
      price_cents: 10000,
      condition: "Field-Tested",
      predicted_float: 0.15,
    });
  });

  it("passes through trade-up metrics", () => {
    const snap = buildSnapshot(inputs, outcomes, tradeUpMeta);
    expect(snap.total_cost_cents).toBe(1100);
    expect(snap.expected_value_cents).toBe(8500);
    expect(snap.roi_percentage).toBe(672.73);
    expect(snap.chance_to_profit).toBe(0.7);
    expect(snap.best_case_cents).toBe(8900);
    expect(snap.worst_case_cents).toBe(3900);
    expect(snap.type).toBe("classified_covert");
  });

  it("filters to only confirmed listing IDs when provided", () => {
    const snap = buildSnapshot(inputs, outcomes, tradeUpMeta, ["l1"]);
    expect(snap.snapshot_inputs).toHaveLength(1);
    expect(snap.snapshot_inputs[0].price_cents).toBe(500);
    expect(snap.total_cost_cents).toBe(500);
  });

  it("handles stattrak inputs", () => {
    const stInputs: TradeUpInput[] = [{ ...inputs[0], stattrak: true }];
    const snap = buildSnapshot(stInputs, outcomes, tradeUpMeta);
    expect(snap.snapshot_inputs[0].stattrak).toBe(true);
  });
});
