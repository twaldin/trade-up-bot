import { describe, it, expect } from "vitest";
import { TradeUpStore } from "../../server/engine/store.js";
import type { TradeUp, TradeUpInput, TradeUpOutcome } from "../../shared/types.js";

function makeTradeUp(overrides: Partial<TradeUp> & {
  listingIds?: string[];
  collectionName?: string;
} = {}): TradeUp {
  const { listingIds, collectionName, ...rest } = overrides;
  const ids = listingIds ?? ["l1", "l2", "l3", "l4", "l5"];
  const col = collectionName ?? "Test Collection";

  const inputs: TradeUpInput[] = ids.map((id) => ({
    listing_id: id,
    skin_id: "skin-1",
    skin_name: "AK-47 | Redline",
    collection_name: col,
    price_cents: 500,
    float_value: 0.15,
    condition: "Field-Tested" as const,
    source: "csfloat",
  }));

  const outcomes: TradeUpOutcome[] = [
    {
      skin_id: "out-1",
      skin_name: "AK-47 | Fire Serpent",
      collection_name: col,
      probability: 1.0,
      predicted_float: 0.15,
      predicted_condition: "Field-Tested" as const,
      estimated_price_cents: 10000,
    },
  ];

  return {
    id: 0,
    inputs,
    outcomes,
    total_cost_cents: ids.length * 500,
    expected_value_cents: 10000,
    profit_cents: 10000 - ids.length * 500,
    roi_percentage: ((10000 - ids.length * 500) / (ids.length * 500)) * 100,
    created_at: new Date().toISOString(),
    ...rest,
  };
}

// ─── TradeUpStore ───────────────────────────────────────────────────────────

describe("TradeUpStore", () => {
  describe("add()", () => {
    it("adds a profitable trade-up successfully", () => {
      const store = new TradeUpStore(20);
      const tu = makeTradeUp({ profit_cents: 500 });
      const result = store.add(tu);
      expect(result).toBe(true);
      expect(store.total).toBe(1);
    });

    it("rejects null", () => {
      const store = new TradeUpStore(20);
      expect(store.add(null)).toBe(false);
      expect(store.total).toBe(0);
    });

    it("rejects trade-up with 0 EV", () => {
      const store = new TradeUpStore(20);
      const tu = makeTradeUp({ expected_value_cents: 0, profit_cents: -2500 });
      expect(store.add(tu)).toBe(false);
      expect(store.total).toBe(0);
    });

    it("rejects duplicate (same listing IDs)", () => {
      const store = new TradeUpStore(20);
      const tu1 = makeTradeUp({ listingIds: ["a", "b", "c"] });
      const tu2 = makeTradeUp({ listingIds: ["a", "b", "c"] }); // same IDs
      expect(store.add(tu1)).toBe(true);
      expect(store.add(tu2)).toBe(false);
      expect(store.total).toBe(1);
    });

    it("rejects duplicate regardless of order (sorted key)", () => {
      const store = new TradeUpStore(20);
      const tu1 = makeTradeUp({ listingIds: ["c", "a", "b"] });
      const tu2 = makeTradeUp({ listingIds: ["a", "b", "c"] }); // same IDs, different order
      expect(store.add(tu1)).toBe(true);
      expect(store.add(tu2)).toBe(false);
    });

    it("accepts different listing IDs even for same collection", () => {
      const store = new TradeUpStore(20);
      const tu1 = makeTradeUp({ listingIds: ["a", "b", "c"] });
      const tu2 = makeTradeUp({ listingIds: ["d", "e", "f"] });
      expect(store.add(tu1)).toBe(true);
      expect(store.add(tu2)).toBe(true);
      expect(store.total).toBe(2);
    });

    it("rejects negative profit with low chance to profit", () => {
      const store = new TradeUpStore(20);
      // negative profit, <25% chance to profit
      const tu = makeTradeUp({
        profit_cents: -100,
        expected_value_cents: 2400,
        total_cost_cents: 2500,
        chance_to_profit: 0.10,
      });
      // The outcome price (10000) > total_cost (2500), so computeChanceToProfit = 1.0
      // But chance_to_profit is set explicitly to 0.10... let's check the code behavior.
      // Actually, looking at the code: if tu.chance_to_profit is undefined, it computes it.
      // If set, it uses the set value. But the check is:
      //   if (tu.profit_cents <= 0 && (tu.chance_to_profit ?? 0) < 0.25) return false;
      // Since we set chance_to_profit to 0.10, this should be rejected.
      expect(store.add(tu)).toBe(false);
    });

    it("keeps negative profit trade-up with >25% chance to profit", () => {
      const store = new TradeUpStore(20);
      const tu = makeTradeUp({
        profit_cents: -100,
        expected_value_cents: 2400,
        total_cost_cents: 2500,
        chance_to_profit: 0.30,
      });
      expect(store.add(tu)).toBe(true);
      expect(store.total).toBe(1);
    });

    it("computes chance_to_profit when not pre-set", () => {
      const store = new TradeUpStore(20);
      const tu = makeTradeUp({
        profit_cents: -100,
        expected_value_cents: 2400,
        total_cost_cents: 2500,
      });
      // chance_to_profit is undefined, will be computed from outcomes
      // outcome price = 10000, total_cost = 2500: 10000 > 2500 → probability = 1.0
      // So computeChanceToProfit returns 1.0, which is > 0.25 → should be kept
      delete tu.chance_to_profit;
      expect(store.add(tu)).toBe(true);
    });
  });

  describe("signature-based bucketing", () => {
    it("21st trade-up with same collection combo replaces worst when better", () => {
      const store = new TradeUpStore(20);

      // Add 20 trade-ups to fill the bucket
      for (let i = 0; i < 20; i++) {
        const tu = makeTradeUp({
          listingIds: [`a${i}`, `b${i}`, `c${i}`],
          profit_cents: 100 + i, // profits: 100-119
          expected_value_cents: 2600 + i,
        });
        expect(store.add(tu)).toBe(true);
      }
      expect(store.total).toBe(20);

      // 21st with higher profit → should replace the worst (profit=100)
      const better = makeTradeUp({
        listingIds: ["x", "y", "z"],
        profit_cents: 200,
        expected_value_cents: 2700,
      });
      const replaced = store.add(better);
      expect(replaced).toBe(true);
      // total stays 20 since it replaced, not added
      expect(store.total).toBe(20);
    });

    it("21st trade-up worse than all existing → rejected", () => {
      const store = new TradeUpStore(20);

      for (let i = 0; i < 20; i++) {
        const tu = makeTradeUp({
          listingIds: [`a${i}`, `b${i}`, `c${i}`],
          profit_cents: 500 + i,
          expected_value_cents: 3000 + i,
        });
        store.add(tu);
      }

      // Worse than the worst (profit=500)
      const worse = makeTradeUp({
        listingIds: ["x", "y", "z"],
        profit_cents: 1,
        expected_value_cents: 2501,
      });
      expect(store.add(worse)).toBe(false);
    });

    it("different collection signatures use separate buckets", () => {
      const store = new TradeUpStore(2); // small bucket size

      // Fill bucket for "Collection A"
      store.add(makeTradeUp({ listingIds: ["a1", "a2"], collectionName: "Collection A", profit_cents: 100, expected_value_cents: 1100 }));
      store.add(makeTradeUp({ listingIds: ["a3", "a4"], collectionName: "Collection A", profit_cents: 200, expected_value_cents: 1200 }));

      // "Collection B" should have its own bucket
      const resultB = store.add(
        makeTradeUp({ listingIds: ["b1", "b2"], collectionName: "Collection B", profit_cents: 50, expected_value_cents: 1050 })
      );
      expect(resultB).toBe(true);
      expect(store.getSignatureCount()).toBe(2);
    });
  });

  describe("hasSig()", () => {
    it("returns true for existing listing-ID signature", () => {
      const store = new TradeUpStore(20);
      store.add(makeTradeUp({ listingIds: ["a", "b", "c"] }));
      // The key is sorted listing IDs joined by comma
      expect(store.hasSig("a,b,c")).toBe(true);
    });

    it("returns false for unknown signature", () => {
      const store = new TradeUpStore(20);
      store.add(makeTradeUp({ listingIds: ["a", "b", "c"] }));
      expect(store.hasSig("x,y,z")).toBe(false);
    });

    it("recognizes pre-loaded existingSignatures", () => {
      const existing = new Set(["pre-1,pre-2,pre-3"]);
      const store = new TradeUpStore(20, existing);
      expect(store.hasSig("pre-1,pre-2,pre-3")).toBe(true);
      expect(store.hasSig("other")).toBe(false);
    });

    it("pre-loaded signature blocks add()", () => {
      const existing = new Set(["a,b,c"]);
      const store = new TradeUpStore(20, existing);
      const tu = makeTradeUp({ listingIds: ["a", "b", "c"] });
      expect(store.add(tu)).toBe(false);
    });

    it("reuses existingSignatures set to avoid duplicate memory", () => {
      const existing = new Set<string>(["a,b,c"]);
      const store = new TradeUpStore(20, existing);
      const tu = makeTradeUp({ listingIds: ["d", "e", "f"] });
      expect(store.add(tu)).toBe(true);
      expect(existing.has("d,e,f")).toBe(true);
    });
  });

  describe("getAll()", () => {
    it("returns trade-ups sorted by score (highest first)", () => {
      const store = new TradeUpStore(20);
      store.add(makeTradeUp({ listingIds: ["a1", "a2"], profit_cents: 100, expected_value_cents: 1100 }));
      store.add(makeTradeUp({ listingIds: ["b1", "b2"], profit_cents: 500, expected_value_cents: 1500 }));
      store.add(makeTradeUp({ listingIds: ["c1", "c2"], profit_cents: 300, expected_value_cents: 1300 }));

      const results = store.getAll(10);
      expect(results).toHaveLength(3);
      expect(results[0].profit_cents).toBe(500);
      expect(results[1].profit_cents).toBe(300);
      expect(results[2].profit_cents).toBe(100);
    });

    it("respects limit parameter", () => {
      const store = new TradeUpStore(20);
      for (let i = 0; i < 10; i++) {
        store.add(makeTradeUp({ listingIds: [`x${i}`], profit_cents: 100 + i, expected_value_cents: 600 + i }));
      }
      const results = store.getAll(3);
      expect(results).toHaveLength(3);
    });

    it("empty store returns empty array", () => {
      const store = new TradeUpStore(20);
      expect(store.getAll(100)).toHaveLength(0);
    });
  });

  describe("getSignatureCount()", () => {
    it("counts distinct collection-combo signatures", () => {
      const store = new TradeUpStore(20);
      store.add(makeTradeUp({ listingIds: ["a1"], collectionName: "Alpha", profit_cents: 100, expected_value_cents: 600 }));
      store.add(makeTradeUp({ listingIds: ["a2"], collectionName: "Alpha", profit_cents: 200, expected_value_cents: 700 }));
      store.add(makeTradeUp({ listingIds: ["b1"], collectionName: "Beta", profit_cents: 100, expected_value_cents: 600 }));

      expect(store.getSignatureCount()).toBe(2); // "Alpha" and "Beta"
    });
  });

  describe("maxTotal cap", () => {
    it("caps total stored trade-ups when maxTotal is reached", () => {
      const store = new TradeUpStore(20, undefined, 2);
      expect(store.add(makeTradeUp({ listingIds: ["a1"], collectionName: "A", profit_cents: 100 }))).toBe(true);
      expect(store.add(makeTradeUp({ listingIds: ["b1"], collectionName: "B", profit_cents: 100 }))).toBe(true);
      expect(store.add(makeTradeUp({ listingIds: ["c1"], collectionName: "C", profit_cents: 100 }))).toBe(false);
      expect(store.total).toBe(2);
    });
  });
});
