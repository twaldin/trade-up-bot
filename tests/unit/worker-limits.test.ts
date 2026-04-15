import { describe, it, expect } from "vitest";
import { makeTradeUp } from "../helpers/fixtures.js";
import {
  WORKER_MAX_RESULTS_BY_TASK,
  WORKER_MAX_EXISTING_SIGS_BY_TASK,
  capWorkerTradeUps,
} from "../../server/daemon/worker-limits.js";

describe("worker-limits", () => {
  it("defines positive caps for every worker task", () => {
    for (const cap of Object.values(WORKER_MAX_RESULTS_BY_TASK)) {
      expect(cap).toBeGreaterThan(0);
    }
    for (const cap of Object.values(WORKER_MAX_EXISTING_SIGS_BY_TASK)) {
      expect(cap).toBeGreaterThan(0);
    }
  });

  it("returns the original array when under cap", () => {
    const tradeUps = [
      makeTradeUp({ listingIds: ["a"], profit_cents: 500, expected_value_cents: 1500 }),
      makeTradeUp({ listingIds: ["b"], profit_cents: 300, expected_value_cents: 1300 }),
    ];
    const result = capWorkerTradeUps(tradeUps, 10);
    expect(result).toBe(tradeUps);
    expect(result).toHaveLength(2);
  });

  it("caps and prioritizes profitable + high-chance trade-ups", () => {
    const profitable = makeTradeUp({
      listingIds: ["p1"],
      profit_cents: 1200,
      expected_value_cents: 2200,
      chance_to_profit: 0.05,
    });
    const highChance = makeTradeUp({
      listingIds: ["h1"],
      profit_cents: -10,
      expected_value_cents: 990,
      chance_to_profit: 0.4,
    });
    const lowValue = makeTradeUp({
      listingIds: ["l1"],
      profit_cents: -100,
      expected_value_cents: 900,
      chance_to_profit: 0.05,
    });

    const capped = capWorkerTradeUps([lowValue, profitable, highChance], 2);
    expect(capped).toHaveLength(2);
    expect(capped).toContain(profitable);
    expect(capped).toContain(highChance);
    expect(capped).not.toContain(lowValue);
  });
});
