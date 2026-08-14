/**
 * Adaptive strategy weights — strategy-count contract (It15).
 *
 * Gun tiers gained S20 (deep-rank swap), moving TOTAL_STRATEGIES 20 → 21.
 * Persisted yield histories in sync_meta still hold 20 entries, so
 * computeAdaptiveWeights must tolerate a shorter history: the padded new
 * strategy is treated exactly like a dead strategy (0-yield softmax share,
 * ~1.8% opening allocation on a production-shaped history — NOT the 0.1%
 * MIN_FLOOR, which only binds when the softmax share falls below it) until
 * it earns signal.
 */

import { describe, it, expect } from "vitest";
import {
  computeAdaptiveWeights,
  STRATEGY_COUNTS,
  FLOAT_BIASED_BY_TIER,
  type YieldHistory,
} from "../../server/daemon/adaptive-weights.js";

describe("STRATEGY_COUNTS (It15 S20 bump)", () => {
  it("gun tiers advertise 21 strategies, knife stays at 17", () => {
    expect(STRATEGY_COUNTS.classified).toBe(21);
    expect(STRATEGY_COUNTS.restricted).toBe(21);
    expect(STRATEGY_COUNTS.milspec).toBe(21);
    expect(STRATEGY_COUNTS.industrial).toBe(21);
    expect(STRATEGY_COUNTS.consumer).toBe(21);
    expect(STRATEGY_COUNTS.knife).toBe(17);
  });
});

describe("computeAdaptiveWeights with a shorter persisted history", () => {
  it("pads a 20-entry history to 21 weights, treating the new strategy as dead", () => {
    // History shaped like production classified: S16 dominates, S10 second.
    const strategies = Array.from({ length: 20 }, (_, s) => {
      if (s === 16) return { iterations: 4000, profitable: 14 };
      if (s === 10) return { iterations: 2000, profitable: 2 };
      return { iterations: 100, profitable: 0 };
    });
    const history: YieldHistory = { strategies, lastUpdated: new Date().toISOString() };

    const weights = computeAdaptiveWeights(history, 21, FLOAT_BIASED_BY_TIER.classified);

    expect(weights).toHaveLength(21);
    // every strategy keeps a positive weight (floor)
    for (const w of weights) expect(w).toBeGreaterThan(0);
    // the untested new strategy stays below the proven top strategies
    expect(weights[20]).toBeLessThan(weights[16]);
    expect(weights[20]).toBeLessThan(weights[10]);
    // padding is exactly the dead-strategy treatment: same weight as a
    // 0-yield strategy that has real iteration history (S0: 100 iters, 0 hits)
    expect(weights[20]).toBe(weights[0]);
  });
});
