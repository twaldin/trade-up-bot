import type { TradeUpInput, TradeUpOutcome } from "../shared/types.js";
import type { SnapshotInput, SnapshotOutcome } from "../shared/my-trade-ups-types.js";

interface TradeUpMeta {
  trade_up_id: number;
  total_cost_cents: number;
  expected_value_cents: number;
  roi_percentage: number;
  chance_to_profit: number;
  best_case_cents: number;
  worst_case_cents: number;
  type: string;
}

interface SnapshotResult {
  snapshot_inputs: SnapshotInput[];
  snapshot_outcomes: SnapshotOutcome[];
  total_cost_cents: number;
  expected_value_cents: number;
  roi_percentage: number;
  chance_to_profit: number;
  best_case_cents: number;
  worst_case_cents: number;
  type: string;
}

export function buildSnapshot(
  inputs: TradeUpInput[],
  outcomes: TradeUpOutcome[],
  meta: TradeUpMeta,
  confirmedListingIds?: string[],
): SnapshotResult {
  const filteredInputs = confirmedListingIds
    ? inputs.filter(i => confirmedListingIds.includes(i.listing_id))
    : inputs;

  const snapshotInputs: SnapshotInput[] = filteredInputs.map(i => ({
    skin_name: i.skin_name,
    collection_name: i.collection_name,
    price_cents: i.price_cents,
    float_value: i.float_value,
    condition: i.condition,
    source: i.source,
    stattrak: i.stattrak ?? false,
  }));

  const snapshotOutcomes: SnapshotOutcome[] = outcomes.map(o => ({
    skin_name: o.skin_name,
    skin_id: o.skin_id,
    probability: o.probability,
    price_cents: o.estimated_price_cents,
    condition: o.predicted_condition,
    predicted_float: o.predicted_float,
  }));

  const totalCost = confirmedListingIds
    ? snapshotInputs.reduce((sum, i) => sum + i.price_cents, 0)
    : meta.total_cost_cents;

  return {
    snapshot_inputs: snapshotInputs,
    snapshot_outcomes: snapshotOutcomes,
    total_cost_cents: totalCost,
    expected_value_cents: meta.expected_value_cents,
    roi_percentage: meta.roi_percentage,
    chance_to_profit: meta.chance_to_profit,
    best_case_cents: meta.best_case_cents,
    worst_case_cents: meta.worst_case_cents,
    type: meta.type,
  };
}
