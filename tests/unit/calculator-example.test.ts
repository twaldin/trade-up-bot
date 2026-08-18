import { describe, it, expect } from "vitest";
import { makeTradeUp } from "../helpers/fixtures.js";
import {
  PREFERRED_EXAMPLE_TRADE_UP_ID,
  emptyCalculatorSlots,
  slotsFromCurrentListings,
  pickCheapestNamedClassified,
  exampleHasUsableListings,
  buildExamplePayload,
  type CalculatorExampleListing,
} from "../../shared/calculator-example.js";

function makeListing(overrides: Partial<CalculatorExampleListing> = {}): CalculatorExampleListing {
  return {
    skin_name: "AK-47 | Redline",
    float_value: 0.1523,
    price_cents: 32100,
    weapon: "AK-47",
    rarity: "Classified",
    min_float: 0.1,
    max_float: 0.7,
    collection_name: "The Phoenix Collection",
    ...overrides,
  };
}

describe("calculator example payload", () => {
  it("pins the preferred live contract id without baking prices", () => {
    expect(PREFERRED_EXAMPLE_TRADE_UP_ID).toBe(776986117);
  });

  it("hydrates the empty widget as one cents-priced slot", () => {
    expect(emptyCalculatorSlots()).toEqual([
      { skinName: "", floatValue: "", priceCents: "", resolved: null },
    ]);
  });

  it("prefills existing calculator fields from current listings in cents", () => {
    const slots = slotsFromCurrentListings([
      makeListing({ skin_name: "USP-S | Orion", float_value: 0.0412, price_cents: 8900 }),
      makeListing({ price_cents: 150 }),
    ]);

    expect(slots).toHaveLength(2);
    expect(slots[0].skinName).toBe("USP-S | Orion");
    expect(slots[0].floatValue).toBe("0.0412");
    expect(slots[0].priceCents).toBe("8900");
    expect(slots[0].resolved?.name).toBe("USP-S | Orion");
    expect(slots[0].resolved?.rarity).toBe("Classified");
    expect(slots[1].priceCents).toBe("150");
    expect(slots.every((slot) => !slot.priceCents.includes("."))).toBe(true);
  });

  it("requires 10 named current listings before treating a contract as usable", () => {
    const nine = Array.from({ length: 9 }, (_, i) => makeListing({ skin_name: `Skin ${i}` }));
    expect(exampleHasUsableListings(nine)).toBe(false);
    expect(exampleHasUsableListings([...nine, makeListing({ skin_name: "Skin 9" })])).toBe(true);
    expect(exampleHasUsableListings([...nine, makeListing({ skin_name: "   " })])).toBe(false);
  });

  it("picks the cheapest named Classified row and ignores unnamed or other types", () => {
    const expensiveNamed = makeTradeUp({
      id: 2,
      type: "classified_covert",
      total_cost_cents: 9000,
      input_summary: { skins: [{ name: "AK-47 | Redline", count: 10, condition: "FT" }], collections: [], input_count: 10 },
    });
    const cheapestNamed = makeTradeUp({
      id: 3,
      type: "classified_covert",
      total_cost_cents: 2500,
      input_summary: { skins: [{ name: "M4A4 | Desolate Space", count: 10, condition: "FT" }], collections: [], input_count: 10 },
    });
    const unnamed = makeTradeUp({
      id: 4,
      type: "classified_covert",
      total_cost_cents: 1000,
      input_summary: { skins: [{ name: "  ", count: 10, condition: "FT" }], collections: [], input_count: 10 },
    });
    const restricted = makeTradeUp({
      id: 5,
      type: "restricted_classified",
      total_cost_cents: 500,
      input_summary: { skins: [{ name: "AK-47 | Blue Laminate", count: 10, condition: "FT" }], collections: [], input_count: 10 },
    });

    expect(pickCheapestNamedClassified([expensiveNamed, cheapestNamed, unnamed, restricted])?.id).toBe(3);
    expect(pickCheapestNamedClassified([unnamed, restricted])).toBeNull();
  });

  it("labels the payload as an example and never includes profit or we-ran-this claims", () => {
    const payload = buildExamplePayload({
      tradeUpId: 776986117,
      usedFallback: false,
      listings: Array.from({ length: 10 }, () => makeListing()),
    });

    expect(payload.label).toBe("example");
    expect(payload.trade_up_id).toBe(776986117);
    expect(payload.used_fallback).toBe(false);
    expect(payload.inputs).toHaveLength(10);
    expect(payload).not.toHaveProperty("profit_cents");
    expect(payload).not.toHaveProperty("roi_percentage");
    expect(payload).not.toHaveProperty("expected_value_cents");
    expect(JSON.stringify(payload).toLowerCase()).not.toMatch(/guaranteed|we ran this|profitable example/);
  });
});
