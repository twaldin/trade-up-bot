import { describe, it, expect } from "vitest";
import {
  computeRepriceDecision,
  repriceRowOrTouch,
  mapRepriceDecisions,
  buildBulkRepriceUpdate,
  type RepriceRow,
  type OutputLookup,
} from "../../server/engine/db-stats.js";
import type { OutputPriceResult } from "../../server/engine/pricing.js";

// Build a price lookup stub from a skin_name → priceCents map.
function lookupFrom(prices: Record<string, number>): OutputLookup {
  return async (skinName: string): Promise<OutputPriceResult> => ({
    priceCents: prices[skinName] ?? 0,
    marketplace: "csfloat",
    grossPrice: prices[skinName] ?? 0,
    feePct: 0.02,
  });
}

function row(outcomes: object[], cost = 1000, ev = 1000): RepriceRow {
  return {
    id: 42,
    total_cost_cents: cost,
    expected_value_cents: ev,
    outcomes_json: JSON.stringify(outcomes),
  };
}

const mkOutcome = (skin_name: string, probability: number) => ({
  skin_id: skin_name, skin_name, collection_name: "C", probability,
  predicted_float: 0.1, predicted_condition: "Minimal Wear",
  estimated_price_cents: 0, sell_marketplace: "csfloat",
});

// ─── computeRepriceDecision ──────────────────────────────────────────────────

describe("computeRepriceDecision", () => {
  it("empty outcomes → touch", async () => {
    const d = await computeRepriceDecision(row([]), lookupFrom({}));
    expect(d).toEqual({ kind: "touch", id: 42 });
  });

  it("any unpriceable outcome → touch (no partial repricing)", async () => {
    const outcomes = [mkOutcome("A", 0.5), mkOutcome("B", 0.5)];
    const d = await computeRepriceDecision(row(outcomes), lookupFrom({ A: 2000, B: 0 }));
    expect(d.kind).toBe("touch");
  });

  it("EV change within 1% → touch (matches existing >1% guard)", async () => {
    const outcomes = [mkOutcome("A", 0.5), mkOutcome("B", 0.5)];
    // newEv = 0.5*1000 + 0.5*1000 = 1000, equal to expected_value_cents → no update
    const d = await computeRepriceDecision(row(outcomes, 1000, 1000), lookupFrom({ A: 1000, B: 1000 }));
    expect(d.kind).toBe("touch");
  });

  it("EV change >1% → update with correct profit/roi/chance/best/worst", async () => {
    const outcomes = [mkOutcome("A", 0.5), mkOutcome("B", 0.5)];
    // newEv = 0.5*2000 + 0.5*1000 = 1500 (was 1000) → +50% → update
    const d = await computeRepriceDecision(row(outcomes, 1000, 1000), lookupFrom({ A: 2000, B: 1000 }));
    expect(d.kind).toBe("update");
    if (d.kind !== "update") return;
    expect(d.id).toBe(42);
    expect(d.expected_value_cents).toBe(1500);
    expect(d.profit_cents).toBe(500);
    expect(d.roi_percentage).toBe(50);
    // chance = prob mass where price strictly > cost(1000): only A (2000) → 0.5
    expect(d.chance_to_profit).toBeCloseTo(0.5, 10);
    expect(d.best_case_cents).toBe(1000); // 2000 - 1000
    expect(d.worst_case_cents).toBe(0);   // 1000 - 1000
    // new outcome prices are baked into the persisted JSON
    const persisted = JSON.parse(d.outcomes_json);
    expect(persisted[0].estimated_price_cents).toBe(2000);
    expect(persisted[1].estimated_price_cents).toBe(1000);
  });

  it("is deterministic regardless of call order (pure over the lookup)", async () => {
    const outcomes = [mkOutcome("A", 0.5), mkOutcome("B", 0.5)];
    const lk = lookupFrom({ A: 2000, B: 1000 });
    const a = await computeRepriceDecision(row(outcomes), lk);
    const b = await computeRepriceDecision(row(outcomes), lk);
    expect(a).toEqual(b);
  });
});

// ─── crash vs survive (pg-pool connect timeout) ──────────────────────────────

function connectTimeout(): Error {
  return new Error("timeout exceeded when trying to connect");
}

describe("repriceRowOrTouch — connect timeout must not throw", () => {
  it("retries a connect timeout then returns the successful decision", async () => {
    const outcomes = [mkOutcome("A", 1)];
    let attempts = 0;
    const lookup: OutputLookup = async () => {
      attempts++;
      if (attempts < 3) throw connectTimeout();
      return { priceCents: 2000, marketplace: "csfloat", grossPrice: 2000, feePct: 0.02 };
    };
    const d = await repriceRowOrTouch(row(outcomes, 1000, 1000), lookup, { maxRetries: 3, backoffMs: 0 });
    expect(attempts).toBe(3);
    expect(d.kind).toBe("update");
    if (d.kind === "update") expect(d.expected_value_cents).toBe(2000);
  });

  it("fails the item as a touch after retries — does not throw (daemon stays alive)", async () => {
    const outcomes = [mkOutcome("A", 1)];
    const lookup: OutputLookup = async () => {
      throw connectTimeout();
    };
    const d = await repriceRowOrTouch(row(outcomes), lookup, { maxRetries: 1, backoffMs: 0 });
    expect(d).toEqual({ kind: "touch", id: 42 });
  });

  it("still throws non-transient lookup errors (not a blanket swallow)", async () => {
    const outcomes = [mkOutcome("A", 1)];
    const lookup: OutputLookup = async () => {
      throw new Error("unexpected pricing bug");
    };
    await expect(repriceRowOrTouch(row(outcomes), lookup, { maxRetries: 1, backoffMs: 0 }))
      .rejects.toThrow("unexpected pricing bug");
  });
});

describe("mapRepriceDecisions — one timeout does not abort the batch", () => {
  it("continues other items when one lookup hits a connect timeout", async () => {
    const mkRow = (id: number, skin: string): RepriceRow => ({
      id,
      total_cost_cents: 1000,
      expected_value_cents: 1000,
      outcomes_json: JSON.stringify([mkOutcome(skin, 1)]),
    });
    const rows = [mkRow(1, "ok-a"), mkRow(2, "vanilla-timeout"), mkRow(3, "ok-b")];
    const seen: string[] = [];
    const lookup: OutputLookup = async (skinName) => {
      seen.push(skinName);
      if (skinName === "vanilla-timeout") throw connectTimeout();
      return { priceCents: 2000, marketplace: "csfloat", grossPrice: 2000, feePct: 0.02 };
    };

    const decisions = await mapRepriceDecisions(rows, lookup, { concurrency: 3, maxRetries: 1, backoffMs: 0 });

    expect(decisions).toHaveLength(3);
    expect(decisions[0]).toMatchObject({ kind: "update", id: 1, expected_value_cents: 2000 });
    expect(decisions[1]).toEqual({ kind: "touch", id: 2 });
    expect(decisions[2]).toMatchObject({ kind: "update", id: 3, expected_value_cents: 2000 });
    // The timed-out item must not prevent later items from being looked up.
    expect(seen).toContain("ok-a");
    expect(seen).toContain("ok-b");
    expect(seen).toContain("vanilla-timeout");
  });

  it("bare computeRepriceDecision still rejects on connect timeout (isolation lives in the wrapper)", async () => {
    const lookup: OutputLookup = async () => {
      throw connectTimeout();
    };
    await expect(computeRepriceDecision(row([mkOutcome("A", 1)]), lookup))
      .rejects.toThrow("timeout exceeded when trying to connect");
  });
});

// ─── buildBulkRepriceUpdate ──────────────────────────────────────────────────

describe("buildBulkRepriceUpdate", () => {
  const upd = (id: number) => ({
    kind: "update" as const, id,
    expected_value_cents: 1500, profit_cents: 500, roi_percentage: 50,
    chance_to_profit: 0.5, best_case_cents: 1000, worst_case_cents: 0,
    outcomes_json: "[]",
  });

  it("returns null for empty input", () => {
    expect(buildBulkRepriceUpdate([])).toBeNull();
  });

  it("builds one statement with 8 params per row", () => {
    const sql = buildBulkRepriceUpdate([upd(1), upd(2)]);
    expect(sql).not.toBeNull();
    expect(sql!.text).toMatch(/UPDATE\s+trade_ups/i);
    expect(sql!.text).toMatch(/output_repriced_at\s*=\s*NOW\(\)/i);
    expect(sql!.values).toHaveLength(16); // 2 rows × 8 fields
    // highest placeholder is $16
    expect(sql!.text).toContain("$16");
    expect(sql!.text).not.toContain("$17");
  });

  it("preserves id ordering in values", () => {
    const sql = buildBulkRepriceUpdate([upd(7), upd(3)]);
    expect(sql!.values[0]).toBe(7);
    expect(sql!.values[8]).toBe(3);
  });
});
