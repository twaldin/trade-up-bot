import { describe, it, expect } from "vitest";
import { makeTradeUp } from "../helpers/fixtures.js";
import { readFileSync } from "node:fs";
import {
  NO_LISTINGS_COPY,
  PREFERRED_EXAMPLE_TRADE_UP_ID,
  calculatorEvaluateInputs,
  emptyCalculatorSlots,
  isPositiveIntegerCents,
  slotFromSearchHit,
  slotsFromCurrentListings,
  pickCheapestNamedClassified,
  exampleHasUsableListings,
  buildExamplePayload,
  type CalculatorExampleListing,
  type CalculatorSearchHit,
} from "../../shared/calculator-example.js";
import { wearAbbr } from "../../src/preview/lib/board.js";

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

  it("fills a search slot from the same listing Load example uses", () => {
    const listing = makeListing({
      skin_name: "AK-47 | Leet Museo",
      float_value: 0.5,
      price_cents: 6075,
      min_float: 0,
      max_float: 0.65,
    });
    const hit: CalculatorSearchHit = {
      name: listing.skin_name,
      weapon: listing.weapon,
      rarity: listing.rarity,
      min_float: listing.min_float,
      max_float: listing.max_float,
      collection_name: listing.collection_name,
      floor_price_cents: listing.price_cents,
      floor_float: listing.float_value,
    };
    const fromSearch = slotFromSearchHit(hit);
    const fromExample = slotsFromCurrentListings([listing])[0];
    expect(fromSearch.floatValue).toBe(fromExample.floatValue);
    expect(fromSearch.priceCents).toBe(fromExample.priceCents);
    expect(fromSearch.floatValue).toBe("0.5");
    expect(fromSearch.priceCents).toBe("6075");
  });

  it("pins AK Leet Museo to the cheap listing when that wear is not the mid float", () => {
    const min = 0;
    const max = 0.65;
    const mid = (min + max) / 2;
    expect(mid).toBeCloseTo(0.325);
    expect(wearAbbr(mid)).toBe("FT");
    const slot = slotFromSearchHit({
      name: "AK-47 | Leet Museo",
      weapon: "AK-47",
      rarity: "Classified",
      min_float: min,
      max_float: max,
      collection_name: "The 2021 Train Collection",
      floor_price_cents: 6075,
      floor_float: 0.5,
    });
    expect(slot.floatValue).toBe("0.5");
    expect(slot.priceCents).toBe("6075");
    expect(slot.floatValue).not.toBe(mid.toFixed(4));
    expect(wearAbbr(Number(slot.floatValue))).toBe("BS");
    expect(wearAbbr(Number(slot.floatValue))).not.toBe(wearAbbr(mid));
  });

  it("leaves a skin with no priced listing out of evaluation", () => {
    const slot = slotFromSearchHit({
      name: "SCAR-20 | Splash Jam",
      weapon: "SCAR-20",
      rarity: "Restricted",
      min_float: 0.06,
      max_float: 0.8,
      collection_name: "The 2021 Train Collection",
      floor_price_cents: null,
      floor_float: null,
    });
    expect(slot.priceCents).toBe("");
    expect(slot.floatValue).toBe("");
    expect(NO_LISTINGS_COPY).toBe("No listings for this skin right now");
    expect(calculatorEvaluateInputs([slot])).toEqual([]);
    expect(isPositiveIntegerCents(0)).toBe(false);
    expect(isPositiveIntegerCents(1.5)).toBe(false);
    expect(isPositiveIntegerCents(-5)).toBe(false);
    expect(isPositiveIntegerCents(6075)).toBe(true);
    const banned = /\b(?:chances?|odds|gambl\w*|bankrolls?|jackpots?|bets?|betting|win|wins|winning|lottery|lucky|rolls?|rolled)\b(?!-)|risk-free/i;
    expect(NO_LISTINGS_COPY).not.toMatch(banned);
  });

  it("selects the cheapest listing in one row, skipping a null float", () => {
    const src = readFileSync(new URL("../../server/routes/calculator.ts", import.meta.url), "utf8");
    expect(src).toContain("DISTINCT ON (name)");
    expect(src).toContain("ORDER BY name, price_cents, id");
    expect(src).toContain("l.float_value IS NOT NULL");
    expect(src).not.toContain("MIN(l.price_cents)");
    expect(src).toContain("priceCents must be a positive integer");
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
