/**
 * Core trade-up evaluator: computes EV, profit, ROI for a set of inputs.
 */

import Database from "better-sqlite3";
import { floatToCondition, type TradeUp, type TradeUpInput, type TradeUpOutcome } from "../../shared/types.js";
import type { ListingWithCollection, DbSkinOutcome } from "./types.js";
import { calculateOutputFloat, calculateOutcomeProbabilities } from "./core.js";
import { lookupPrice } from "./pricing.js";

export function evaluateTradeUp(
  db: Database.Database,
  inputs: ListingWithCollection[],
  outcomes: DbSkinOutcome[]
): TradeUp | null {
  const totalCost = inputs.reduce((sum, i) => sum + i.price_cents, 0);
  const inputFloats = inputs.map((i) => ({
    float_value: i.float_value,
    min_float: i.min_float,
    max_float: i.max_float,
  }));

  const probabilities = calculateOutcomeProbabilities(inputs, outcomes);
  if (probabilities.length === 0) return null;

  let ev = 0;
  const tradeUpOutcomes: TradeUpOutcome[] = [];

  for (const { outcome, probability } of probabilities) {
    const predFloat = calculateOutputFloat(inputFloats, outcome.min_float, outcome.max_float);
    const predCondition = floatToCondition(predFloat);
    const price = lookupPrice(db, outcome.name, predFloat);
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

  const tradeUpInputs: TradeUpInput[] = inputs.map((i) => ({
    listing_id: i.id,
    skin_id: i.skin_id,
    skin_name: i.skin_name,
    collection_name: i.collection_name,
    price_cents: i.price_cents,
    float_value: i.float_value,
    condition: floatToCondition(i.float_value),
  }));

  return {
    id: 0,
    inputs: tradeUpInputs,
    outcomes: tradeUpOutcomes,
    total_cost_cents: totalCost,
    expected_value_cents: evCents,
    profit_cents: profit,
    roi_percentage: Math.round(roi * 100) / 100,
    created_at: new Date().toISOString(),
  };
}
