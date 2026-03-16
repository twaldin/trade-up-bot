// Float-targeted listing selection strategies.

import { CONDITION_BOUNDS, type ListingWithCollection, type AdjustedListing, type DbSkinOutcome } from "./types.js";

// Normalize float to [0,1] range relative to skin's min/max.
export function addAdjustedFloat(listings: ListingWithCollection[]): AdjustedListing[] {
  return listings.map(l => ({
    ...l,
    adjustedFloat: (l.max_float - l.min_float) > 0
      ? (l.float_value - l.min_float) / (l.max_float - l.min_float)
      : 0,
  }));
}

// Float values where output condition changes (FN→MW at 0.07, etc).
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

  // Fixed targets for general coverage across the float range
  for (const p of [0.01, 0.03, 0.05, 0.08, 0.12, 0.15, 0.20, 0.30, 0.40]) {
    points.add(p);
  }

  return [...points].filter(p => p > 0 && p <= 1.0).sort((a, b) => a - b);
}

// Select cheapest N listings that keep avg adjusted float within budget.
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

// Select N listings with lowest adjusted float (best output condition).
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
