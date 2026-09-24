import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { makeTradeUp } from "../../helpers/fixtures.js";
import { heroProof } from "../../../src/preview/lib/hero-proof.js";
import type { TradeUpOutcome } from "../../../shared/types.js";

const outcomeArb = fc.record({
  name: fc.constantFrom("A", "B", "C", "D", "E", "F", "G"),
  weight: fc.integer({ min: 1, max: 100 }),
  price: fc.integer({ min: 0, max: 500_000 }),
});

describe("heroProof invariants", () => {
  it("shown + hidden odds never exceed 1, P/L stays integer cents, and odds are ranked", () => {
    fc.assert(fc.property(
      fc.array(outcomeArb, { minLength: 1, maxLength: 12 }),
      fc.integer({ min: 1, max: 500_000 }),
      (rows, cost) => {
        const total = rows.reduce((sum, row) => sum + row.weight, 0);
        const outcomes: TradeUpOutcome[] = rows.map((row) => ({
          skin_id: row.name,
          skin_name: row.name,
          collection_name: "C",
          probability: row.weight / total,
          predicted_float: 0.2,
          predicted_condition: "Field-Tested",
          estimated_price_cents: row.price,
        }));
        const proof = heroProof(makeTradeUp({ outcomes, total_cost_cents: cost }));
        expect(proof).not.toBeNull();
        if (!proof) return;
        const shown = proof.outcomes.reduce((sum, row) => sum + row.probability, 0);
        expect(shown).toBeLessThanOrEqual(1 + 1e-9);
        for (const row of proof.outcomes) {
          expect(Number.isInteger(row.profitCents)).toBe(true);
          expect(row.profitCents).toBe(row.priceCents - cost);
        }
        for (let i = 1; i < proof.outcomes.length; i++) {
          expect(proof.outcomes[i - 1].probability).toBeGreaterThanOrEqual(proof.outcomes[i].probability);
        }
        const distinct = new Set(rows.map((row) => row.name)).size;
        expect(proof.outcomes.length + proof.hiddenOutcomes).toBe(distinct);
        expect(proof.chance === null || (proof.chance >= 0 && proof.chance <= 1 + 1e-9)).toBe(true);
      },
    ));
  });
});
