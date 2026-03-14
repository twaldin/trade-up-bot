/**
 * Float-targeted listing selection strategies.
 * Used by discovery and optimization modules to pick optimal inputs.
 */

import { CONDITION_BOUNDS, type ListingWithCollection, type AdjustedListing, type DbSkinOutcome } from "./types.js";

/**
 * Pre-compute normalized adjusted float for each listing.
 * adjustedFloat = (float - min) / (max - min), in range [0, 1].
 * Lower adjusted float = closer to Factory New output.
 */
export function addAdjustedFloat(listings: ListingWithCollection[]): AdjustedListing[] {
  return listings.map(l => ({
    ...l,
    adjustedFloat: (l.max_float - l.min_float) > 0
      ? (l.float_value - l.min_float) / (l.max_float - l.min_float)
      : 0,
  }));
}

/**
 * Compute condition transition points for a set of outcomes.
 * These are avg_adjusted values where an outcome's predicted condition changes.
 * Evaluating EV at each transition point finds the optimal float target.
 */
export function getConditionTransitions(outcomes: DbSkinOutcome[]): number[] {
  const condBoundaries = CONDITION_BOUNDS.slice(0, 4).map(b => b.max);
  const points = new Set<number>();

  for (const o of outcomes) {
    const range = o.max_float - o.min_float;
    if (range <= 0) continue;
    for (const boundary of condBoundaries) {
      const t = (boundary - o.min_float) / range;
      if (t > 0.001 && t <= 1.0) {
        // Just below the transition = better condition
        points.add(Math.round((t - 0.002) * 10000) / 10000);
      }
    }
  }

  // Add a few fixed targets for general coverage
  points.add(0.01);  // Very low = best possible conditions
  points.add(0.05);
  points.add(0.15);

  return [...points].filter(p => p > 0 && p <= 1.0).sort((a, b) => a - b);
}

/**
 * Select the cheapest N listings that keep avg_adjusted within budget.
 *
 * Uses merged greedy selection: pool all eligible listings from all collections,
 * sort by price, greedily pick respecting per-collection quotas and float budget.
 *
 * @param byCol - listings per collection, pre-sorted by price ASC
 * @param quotas - how many listings needed from each collection
 * @param maxAvgAdjusted - the target: avg of adjusted floats must be <= this
 * @param count - total number of inputs to select (default 10)
 * @returns selected listings or null if impossible
 */
export function selectForFloatTarget(
  byCol: Map<string, AdjustedListing[]>,
  quotas: Map<string, number>,
  maxAvgAdjusted: number,
  count: number = 10
): AdjustedListing[] | null {
  const totalBudget = count * maxAvgAdjusted;

  // Merge eligible listings from all collections
  const candidates: AdjustedListing[] = [];
  for (const [colId, quota] of quotas) {
    if (quota <= 0) continue;
    const pool = byCol.get(colId);
    if (!pool || pool.length < quota) return null;
    for (const l of pool) {
      // Individual listing can't exceed remaining possible budget
      if (l.adjustedFloat <= totalBudget) {
        candidates.push(l);
      }
    }
  }

  // Sort by price ascending
  candidates.sort((a, b) => a.price_cents - b.price_cents);

  // Greedy selection respecting quotas and float budget
  const picked = new Map<string, number>();
  const result: AdjustedListing[] = [];
  let usedFloat = 0;
  const usedIds = new Set<string>();

  for (const l of candidates) {
    if (result.length >= count) break;

    const colPicked = picked.get(l.collection_name) ?? 0;
    const colQuota = quotas.get(l.collection_name) ?? 0;
    if (colPicked >= colQuota) continue;
    if (usedIds.has(l.id)) continue;

    if (usedFloat + l.adjustedFloat <= totalBudget) {
      result.push(l);
      usedFloat += l.adjustedFloat;
      picked.set(l.collection_name, colPicked + 1);
      usedIds.add(l.id);
    }
  }

  // Verify all quotas met
  for (const [colId, quota] of quotas) {
    if ((picked.get(colId) ?? 0) < quota) return null;
  }

  return result.length === count ? result : null;
}

/**
 * Alternative float-targeted selection: prioritize lowest adjusted float,
 * then break ties by price. Finds the lowest-float trade-up possible.
 */
export function selectLowestFloat(
  byCol: Map<string, AdjustedListing[]>,
  quotas: Map<string, number>,
  count: number = 10
): AdjustedListing[] | null {
  const result: AdjustedListing[] = [];
  const usedIds = new Set<string>();

  for (const [colId, quota] of quotas) {
    if (quota <= 0) continue;
    const pool = byCol.get(colId);
    if (!pool || pool.length < quota) return null;

    // Sort by adjusted float ascending, then price ascending
    const sorted = [...pool].sort(
      (a, b) => a.adjustedFloat - b.adjustedFloat || a.price_cents - b.price_cents
    );

    let picked = 0;
    for (const l of sorted) {
      if (picked >= quota) break;
      if (usedIds.has(l.id)) continue;
      result.push(l);
      usedIds.add(l.id);
      picked++;
    }

    if (picked < quota) return null;
  }

  return result.length === count ? result : null;
}

/**
 * Float-greedy selection within a float budget: prioritizes LOW FLOAT over price.
 * Sorts by adjustedFloat ascending within budget, maximizing chance of better-condition outputs.
 * Counterpart to selectForFloatTarget which is price-greedy.
 */
export function selectForFloatTargetFloatGreedy(
  byCol: Map<string, AdjustedListing[]>,
  quotas: Map<string, number>,
  maxAvgAdjusted: number,
  count: number = 10
): AdjustedListing[] | null {
  const totalBudget = count * maxAvgAdjusted;

  const candidates: AdjustedListing[] = [];
  for (const [colId, quota] of quotas) {
    if (quota <= 0) continue;
    const pool = byCol.get(colId);
    if (!pool || pool.length < quota) return null;
    for (const l of pool) {
      if (l.adjustedFloat <= totalBudget) candidates.push(l);
    }
  }

  candidates.sort((a, b) => a.adjustedFloat - b.adjustedFloat || a.price_cents - b.price_cents);

  const picked = new Map<string, number>();
  const result: AdjustedListing[] = [];
  let usedFloat = 0;
  const usedIds = new Set<string>();

  for (const l of candidates) {
    if (result.length >= count) break;
    const colPicked = picked.get(l.collection_name) ?? 0;
    const colQuota = quotas.get(l.collection_name) ?? 0;
    if (colPicked >= colQuota) continue;
    if (usedIds.has(l.id)) continue;
    if (usedFloat + l.adjustedFloat <= totalBudget) {
      result.push(l);
      usedFloat += l.adjustedFloat;
      picked.set(l.collection_name, colPicked + 1);
      usedIds.add(l.id);
    }
  }

  for (const [colId, quota] of quotas) {
    if ((picked.get(colId) ?? 0) < quota) return null;
  }
  return result.length === count ? result : null;
}

/**
 * Try multiple selection strategies and return all valid results.
 * Callers can evaluate each and pick the most profitable.
 */
export function selectMultiStrategy(
  byCol: Map<string, AdjustedListing[]>,
  quotas: Map<string, number>,
  maxAvgAdjusted: number,
  count: number = 10
): AdjustedListing[][] {
  const results: AdjustedListing[][] = [];

  const priceGreedy = selectForFloatTarget(byCol, quotas, maxAvgAdjusted, count);
  if (priceGreedy) results.push(priceGreedy);

  const floatGreedy = selectForFloatTargetFloatGreedy(byCol, quotas, maxAvgAdjusted, count);
  if (floatGreedy) results.push(floatGreedy);

  const relaxed = selectForFloatTarget(byCol, quotas, maxAvgAdjusted * 1.15, count);
  if (relaxed) results.push(relaxed);

  const lowest = selectLowestFloat(byCol, quotas, count);
  if (lowest) results.push(lowest);

  return results;
}
