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

  // Merge eligible listings from all collections, tagging each candidate with
  // its quota key (the byCol/quotas map key — collection_id for gun tiers,
  // collection_name for knife). The greedy loop must key off this, NOT
  // l.collection_name, or id-keyed gun tiers silently match 0 quota → null.
  const candidates: { listing: AdjustedListing; colId: string }[] = [];
  for (const [colId, quota] of quotas) {
    if (quota <= 0) continue;
    const pool = byCol.get(colId);
    if (!pool || pool.length < quota) return null;
    for (const l of pool) {
      // Individual listing can't exceed remaining possible budget
      if (l.adjustedFloat <= totalBudget) {
        candidates.push({ listing: l, colId });
      }
    }
  }

  // Sort by price ascending
  candidates.sort((a, b) => a.listing.price_cents - b.listing.price_cents);

  // Greedy selection respecting quotas and float budget
  const picked = new Map<string, number>();
  const result: AdjustedListing[] = [];
  let usedFloat = 0;
  const usedIds = new Set<string>();

  for (const { listing: l, colId } of candidates) {
    if (result.length >= count) break;

    const colPicked = picked.get(colId) ?? 0;
    const colQuota = quotas.get(colId) ?? 0;
    if (colPicked >= colQuota) continue;
    if (usedIds.has(l.id)) continue;

    if (usedFloat + l.adjustedFloat <= totalBudget) {
      result.push(l);
      usedFloat += l.adjustedFloat;
      picked.set(colId, colPicked + 1);
      usedIds.add(l.id);
    }
  }

  // Verify all quotas met
  for (const [colId, quota] of quotas) {
    if ((picked.get(colId) ?? 0) < quota) return null;
  }

  return result.length === count ? result : null;
}

// E3 — boundary-knapsack selector (frontier heuristic).
//
// Return a CHEAP, in-budget set of `count` listings (respecting per-collection
// quotas) whose total adjusted float stays under the budget, so the output
// lands just below a high-value condition boundary. Its purpose is to recover
// feasible low-float sets that the price-greedy `selectForFloatTarget` misses:
// the greedy sorts by price and spends the float budget on cheap high-float
// items first, so it can return null even when a feasible set exists.
//
// HARD GUARANTEE: feasibility-completeness — returns an in-budget set of
// exactly `count` UNIQUE listings whenever one exists, else null. It is NOT an
// exact min-cost knapsack solver: it explores the price/float Pareto frontier
// via a Lagrangian blend (key `(1-α)·price/maxPrice + α·float`) and binary-
// searches the smallest α whose total float fits, yielding a CHEAP (frequently
// but not provably minimal) feasible set. That is sufficient because it is used
// ADDITIVELY: in gun discovery it is evaluated ALONGSIDE the greedy (both
// candidates scored, store keeps the best); in knife discovery it is a fallback
// used only when the greedy returns null. Either way it only ADDS coverage —
// it never removes or alters an existing candidate — so a non-optimal pick here
// never makes results worse.
//
// "In budget" means total float ≤ budget within floating-point tolerance (EPS),
// a shift far below any condition-boundary granularity.
export function selectKnapsackUnderBoundary(
  byCol: Map<string, AdjustedListing[]>,
  quotas: Map<string, number>,
  maxAvgAdjusted: number,
  count: number = 10
): AdjustedListing[] | null {
  const EPS = 1e-9;
  const totalBudget = count * maxAvgAdjusted;

  const idCmp = (a: AdjustedListing, b: AdjustedListing) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

  // Validate quotas / pools and build a BOUNDED per-collection candidate set:
  // the union of each pool's `quota + 12` cheapest and `quota + 12` lowest-float
  // items (deduped by listing id). Building it sorts the pool twice — O(P log P),
  // the same order as the existing greedy selector this runs beside — but it
  // caps the candidate set to ~2·(quota+12) items, so the inner 22-iteration
  // parametric search below is O(1) in pool size. The union always contains the
  // min-float feasibility floor, so it preserves feasibility-completeness.
  const cols: { colId: string; quota: number; pool: AdjustedListing[] }[] = [];
  let totalQuota = 0;
  let maxPrice = 1;
  for (const [colId, quota] of quotas) {
    if (quota <= 0) continue;
    const raw = byCol.get(colId);
    if (!raw || raw.length < quota) return null;

    // Dedup by listing id (defensive — never return the same listing twice).
    const seen = new Set<string>();
    const unique: AdjustedListing[] = [];
    for (const l of raw) {
      if (!seen.has(l.id)) { seen.add(l.id); unique.push(l); }
    }
    if (unique.length < quota) return null;

    const N = quota + 12;
    const byPrice = [...unique].sort(
      (a, b) => a.price_cents - b.price_cents || a.adjustedFloat - b.adjustedFloat || idCmp(a, b)
    );
    const byFloatPre = [...unique].sort(
      (a, b) => a.adjustedFloat - b.adjustedFloat || a.price_cents - b.price_cents || idCmp(a, b)
    );
    const candMap = new Map<string, AdjustedListing>();
    for (let i = 0; i < N && i < byPrice.length; i++) candMap.set(byPrice[i].id, byPrice[i]);
    for (let i = 0; i < N && i < byFloatPre.length; i++) candMap.set(byFloatPre[i].id, byFloatPre[i]);
    const pool = [...candMap.values()];

    cols.push({ colId, quota, pool });
    totalQuota += quota;
    for (const l of pool) if (l.price_cents > maxPrice) maxPrice = l.price_cents;
  }
  if (cols.length === 0 || totalQuota !== count) return null;

  // Feasibility floor: the minimum achievable total float is the sum of each
  // collection's `quota` lowest-float items. If that exceeds the budget, no
  // selection can fit → null (this is the α=1 extreme).
  let minTotalFloat = 0;
  for (const { quota, pool } of cols) {
    const byFloat = [...pool].sort(
      (a, b) =>
        a.adjustedFloat - b.adjustedFloat ||
        a.price_cents - b.price_cents ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );
    for (let i = 0; i < quota; i++) minTotalFloat += byFloat[i].adjustedFloat;
  }
  if (minTotalFloat > totalBudget + EPS) return null;

  // Pick each collection's `quota` items minimizing the α-blended key.
  const pickAt = (alpha: number): { picks: AdjustedListing[]; totalFloat: number } => {
    const picks: AdjustedListing[] = [];
    let totalFloat = 0;
    for (const { pool, quota } of cols) {
      const sorted = [...pool].sort((a, b) => {
        const ka = (1 - alpha) * (a.price_cents / maxPrice) + alpha * a.adjustedFloat;
        const kb = (1 - alpha) * (b.price_cents / maxPrice) + alpha * b.adjustedFloat;
        return (
          ka - kb ||
          a.adjustedFloat - b.adjustedFloat ||
          a.price_cents - b.price_cents ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
        );
      });
      for (let i = 0; i < quota; i++) {
        picks.push(sorted[i]);
        totalFloat += sorted[i].adjustedFloat;
      }
    }
    return { picks, totalFloat };
  };

  // α=0 (cheapest). If it already fits the budget, it's the cheapest feasible.
  const cheapest = pickAt(0);
  if (cheapest.totalFloat <= totalBudget + EPS) return cheapest.picks;

  // Otherwise binary-search the smallest α whose total float fits the budget.
  // α=1 is feasible (it equals the min-float floor we checked above).
  let lo = 0;
  let hi = 1;
  let best = pickAt(1);
  // 22 iterations → α precision ~2.4e-7, ample to separate distinct picks while
  // keeping this cheap enough to run in the hot discovery loop.
  for (let iter = 0; iter < 22; iter++) {
    const mid = (lo + hi) / 2;
    const r = pickAt(mid);
    if (r.totalFloat <= totalBudget + EPS) {
      hi = mid;
      best = r;
    } else {
      lo = mid;
    }
  }
  // Final guard: exactly `count` distinct listings (defends against any pool
  // overlap across quota keys; pickAt selects per-collection without a global
  // used-id set).
  if (best.picks.length !== count) return null;
  const ids = new Set(best.picks.map(l => l.id));
  return ids.size === count ? best.picks : null;
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
