/**
 * Adaptive strategy weights — dynamically allocate exploration budget
 * based on per-strategy yield data.
 *
 * Each cycle, the daemon collects yield stats (profitable / iterations) per strategy
 * from worker results. These are persisted to sync_meta with exponential decay
 * (20-cycle half-life), then converted to allocation weights via softmax.
 *
 * Strategies that consistently find profitable trade-ups get more iterations.
 * Dead strategies (0% yield) decay toward MIN_FLOOR but never reach zero,
 * preserving a small exploration budget for regime changes.
 */

import pg from "pg";
import { getSyncMeta, setSyncMeta } from "../db.js";
import type { StrategyYieldEntry } from "../engine.js";

/** Exponential decay half-life in cycles. After 20 cycles, old data has 50% weight. */
const DECAY_HALFLIFE = 20;
const DECAY_FACTOR = Math.pow(2, -1 / DECAY_HALFLIFE); // ~0.966

/** Minimum allocation weight — no strategy goes to absolute zero. */
const MIN_FLOOR = 0.001;

/**
 * Softmax scaling factor. Yield rates are small (0-0.10), so we scale up
 * to create meaningful differentiation. Scale=50 means:
 *   7.8% yield → logit 3.9 → exp(3.9) ≈ 49x a 0% strategy
 */
const SOFTMAX_SCALE = 50;

interface StrategyHistory {
  iterations: number; // decayed cumulative
  profitable: number; // decayed cumulative
}

export interface YieldHistory {
  strategies: StrategyHistory[];
  lastUpdated: string;
}

/** sync_meta key for a tier's yield history. */
function yieldKey(tier: string): string {
  return `strategy_yield_${tier}`;
}

/** Load persisted yield history for a tier. Returns null if none exists. */
export async function loadYieldHistory(pool: pg.Pool, tier: string): Promise<YieldHistory | null> {
  const raw = await getSyncMeta(pool, yieldKey(tier));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as YieldHistory;
  } catch {
    return null;
  }
}

/**
 * Update yield history with new cycle data.
 * Applies exponential decay to existing data, then adds new observations.
 */
export async function updateYieldHistory(
  pool: pg.Pool,
  tier: string,
  newYield: StrategyYieldEntry[],
  totalStrategies: number,
): Promise<YieldHistory> {
  const existing = await loadYieldHistory(pool, tier);

  // Initialize or decay existing strategies
  const strategies: StrategyHistory[] = [];
  for (let s = 0; s < totalStrategies; s++) {
    const prev = existing?.strategies[s];
    strategies.push({
      iterations: (prev?.iterations ?? 0) * DECAY_FACTOR,
      profitable: (prev?.profitable ?? 0) * DECAY_FACTOR,
    });
  }

  // Add new cycle's data
  for (const entry of newYield) {
    if (entry.strategyId < totalStrategies) {
      strategies[entry.strategyId].iterations += entry.iterations;
      strategies[entry.strategyId].profitable += entry.profitableFound;
    }
  }

  const history: YieldHistory = {
    strategies,
    lastUpdated: new Date().toISOString(),
  };

  await setSyncMeta(pool, yieldKey(tier), JSON.stringify(history));
  return history;
}

/**
 * Compute adaptive weights from yield history using softmax allocation.
 *
 * Returns an array of raw weights (not normalized to sum=1) suitable for
 * pickWeightedStrategy. Strategies with higher yield rates get proportionally
 * more weight; dead strategies get MIN_FLOOR.
 *
 * Falls back to static float-biased weights if no history exists.
 */
export function computeAdaptiveWeights(
  history: YieldHistory | null,
  totalStrategies: number,
  floatBiasedCases: number[],
): number[] {
  // No history — use static weights
  if (!history || history.strategies.length === 0) {
    return buildStaticWeights(totalStrategies, floatBiasedCases);
  }

  // Check if we have enough data to be meaningful (at least 100 total iterations)
  const totalIters = history.strategies.reduce((s, h) => s + h.iterations, 0);
  if (totalIters < 100) {
    return buildStaticWeights(totalStrategies, floatBiasedCases);
  }

  // Compute yield rates
  const yieldRates: number[] = [];
  for (let s = 0; s < totalStrategies; s++) {
    const h = history.strategies[s];
    if (h && h.iterations > 10) {
      yieldRates.push(h.profitable / h.iterations);
    } else {
      // Not enough data for this strategy — give it a prior (median yield rate)
      yieldRates.push(-1); // sentinel, will be replaced below
    }
  }

  // Replace sentinels with median of observed rates (optimistic prior for untried strategies)
  const observedRates = yieldRates.filter(r => r >= 0);
  const medianRate = observedRates.length > 0
    ? observedRates.sort((a, b) => a - b)[Math.floor(observedRates.length / 2)]
    : 0;
  for (let s = 0; s < totalStrategies; s++) {
    if (yieldRates[s] < 0) yieldRates[s] = medianRate;
  }

  // Softmax: logit = rate * scale, then softmax
  const logits = yieldRates.map(r => r * SOFTMAX_SCALE);
  const maxLogit = Math.max(...logits);
  const expLogits = logits.map(l => Math.exp(l - maxLogit)); // subtract max for numerical stability
  const sumExp = expLogits.reduce((s, e) => s + e, 0);

  // Normalize to probabilities, then apply floor
  const probs = expLogits.map(e => Math.max(e / sumExp, MIN_FLOOR));

  // Renormalize after flooring
  const sumProbs = probs.reduce((s, p) => s + p, 0);
  const normalized = probs.map(p => p / sumProbs);

  // Convert to weights usable by pickWeightedStrategy (scale up for precision)
  // Use 1000x scale so the weighted picker has good resolution
  return normalized.map(p => Math.max(p * 1000, 1));
}

/** Build static weights from float-biased cases (fallback). */
function buildStaticWeights(totalStrategies: number, floatBiasedCases: number[]): number[] {
  return Array.from({ length: totalStrategies }, (_, i) =>
    floatBiasedCases.includes(i) ? 2 : 1
  );
}

/**
 * Format yield history for logging.
 * Shows per-strategy yield rates and computed weights.
 */
export function formatYieldSummary(
  history: YieldHistory,
  weights: number[],
  totalStrategies: number,
): string {
  const parts: string[] = [];
  const totalWeight = weights.reduce((s, w) => s + w, 0);

  for (let s = 0; s < totalStrategies; s++) {
    const h = history.strategies[s];
    if (!h || h.iterations < 1) {
      parts.push(`S${s}:--`);
      continue;
    }
    const rate = (h.profitable / h.iterations * 100).toFixed(1);
    const alloc = (weights[s] / totalWeight * 100).toFixed(1);
    parts.push(`S${s}:${rate}%→${alloc}%`);
  }
  return parts.join(" ");
}

/** Strategy counts per tier type. */
export const STRATEGY_COUNTS: Record<string, number> = {
  knife: 13,
  classified: 16,
  restricted: 16,
  milspec: 16,
  industrial: 16,
  consumer: 16,
};

/** Float-biased strategy indices per tier (used as fallback). */
export const FLOAT_BIASED_BY_TIER: Record<string, number[]> = {
  knife: [5, 7, 8, 10, 11],
  classified: [0, 2],          // preferHighFloat
  restricted: [0, 2],          // preferHighFloat
  milspec: [5, 7, 8, 12, 13, 15, 15],
  industrial: [5, 7, 8, 12, 13, 15, 15],
  consumer: [5, 7, 8, 12, 13, 15, 15],
};
