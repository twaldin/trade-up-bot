import { describe, expect, it } from "vitest";
import { repricedInputCost, storedInputCost } from "../../server/engine/fees.js";
import { formatHealCycleLog } from "../../server/daemon/leaked-tradeup-heal.js";
import { REPRICE_DROPS_BUYER_FEE, boardFeeLine } from "../../src/preview/lib/fees.js";

const RAW = 1000;
const MARKETS = ["csfloat", "dmarket", "buff"] as const;

describe("reprice keeps the buyer fee by default", () => {
  it("matches the PR 166 backfill helper for csfloat, dmarket, and buff", () => {
    expect(REPRICE_DROPS_BUYER_FEE).toBe(false);
    const env = {};
    for (const source of MARKETS) {
      const backfill = storedInputCost(RAW, source);
      expect(backfill).toBeGreaterThan(RAW);
      expect(repricedInputCost(RAW, source, env)).toBe(backfill);
    }
  });

  it("stores the raw listing price when REPRICE_DROPS_BUYER_FEE=true", () => {
    const env = { REPRICE_DROPS_BUYER_FEE: "true" };
    for (const source of MARKETS) {
      expect(repricedInputCost(RAW, source, env)).toBe(RAW);
      expect(repricedInputCost(RAW, source, env)).not.toBe(storedInputCost(RAW, source));
    }
    expect(boardFeeLine([], true).cost).toContain("count at their listed price");
  });
});

describe("heal cycle log", () => {
  it("prints one line with the counts, including zeros", () => {
    expect(formatHealCycleLog({ updated: 0, partial: 0, stale: 0, cacheFlushed: false }))
      .toBe("[heal] cycle ok updated=0 partial=0 stale=0 cacheFlushed=false");
    expect(formatHealCycleLog({ updated: 2, partial: 1, stale: 1, cacheFlushed: true }))
      .toBe("[heal] cycle ok updated=2 partial=1 stale=1 cacheFlushed=true");
  });
});
