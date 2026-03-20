/**
 * Core float calculation and probability math.
 * Pure functions with no DB or external dependencies.
 */

import type { ListingWithCollection, DbSkinOutcome } from "./types.js";

export function calculateOutputFloat(
  inputs: { float_value: number; min_float: number; max_float: number }[],
  outputMinFloat: number,
  outputMaxFloat: number
): number {
  let sum = 0;
  for (const input of inputs) {
    const range = input.max_float - input.min_float;
    const adjusted = range > 0 ? (input.float_value - input.min_float) / range : 0;
    sum += adjusted;
  }
  const avgAdjusted = sum / inputs.length;
  const outputFloat = outputMinFloat + avgAdjusted * (outputMaxFloat - outputMinFloat);
  return Math.max(outputMinFloat, Math.min(outputMaxFloat, outputFloat));
}

export function calculateOutcomeProbabilities(
  inputs: ListingWithCollection[],
  outcomes: DbSkinOutcome[]
): { outcome: DbSkinOutcome; probability: number }[] {
  const totalInputs = inputs.length;
  if (totalInputs === 0) return [];

  const inputsPerCollection = new Map<string, number>();
  for (const input of inputs) {
    inputsPerCollection.set(
      input.collection_id,
      (inputsPerCollection.get(input.collection_id) ?? 0) + 1
    );
  }

  const outcomesPerCollection = new Map<string, DbSkinOutcome[]>();
  for (const outcome of outcomes) {
    const list = outcomesPerCollection.get(outcome.collection_id) ?? [];
    list.push(outcome);
    outcomesPerCollection.set(outcome.collection_id, list);
  }

  // Every input collection must have at least one outcome — otherwise the
  // trade-up is invalid (CS2 requires every input collection to contribute
  // to the outcome pool at the next rarity tier).
  for (const colId of inputsPerCollection.keys()) {
    if (!outcomesPerCollection.has(colId)) return [];
  }

  const result: { outcome: DbSkinOutcome; probability: number }[] = [];
  for (const [colId, colOutcomes] of outcomesPerCollection) {
    const inputCount = inputsPerCollection.get(colId) ?? 0;
    if (inputCount === 0) continue;
    const collectionProb = inputCount / totalInputs;
    const perOutcomeProb = collectionProb / colOutcomes.length;
    for (const outcome of colOutcomes) {
      result.push({ outcome, probability: perOutcomeProb });
    }
  }

  return result;
}
