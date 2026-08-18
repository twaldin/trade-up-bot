import { describe, expect, it } from "vitest";
import { makeTradeUp } from "../helpers/fixtures.js";
import type { TradeUpInput, TradeUpOutcome } from "../../shared/types.js";
import {
  inputCostCents,
  inputListingHrefs,
  inputQty,
  oddsBarSegments,
  openGroupedListings,
  outputHref,
  uniqueInputs,
  uniqueOutputs,
  verifyClaimHref,
} from "../../src/preview/lib/board.js";

function input(overrides: Partial<TradeUpInput>): TradeUpInput {
  return {
    listing_id: "l",
    skin_id: "s",
    skin_name: "Skin",
    collection_name: "A",
    price_cents: 100,
    float_value: 0.2,
    condition: "Field-Tested",
    source: "csfloat",
    ...overrides,
  };
}

function outcome(overrides: Partial<TradeUpOutcome>): TradeUpOutcome {
  return {
    skin_id: "o",
    skin_name: "Out",
    collection_name: "A",
    probability: 0.5,
    predicted_float: 0.2,
    predicted_condition: "Field-Tested",
    estimated_price_cents: 1000,
    ...overrides,
  };
}

describe("preview board numbers", () => {
  it("uses the contract input total as cost, not an outcome price", () => {
    const tu = makeTradeUp({
      total_cost_cents: 12345,
      expected_value_cents: 99999,
      outcomes: [outcome({ estimated_price_cents: 88888, probability: 1 })],
    });
    expect(inputCostCents(tu)).toBe(12345);
  });

  it("uses the 10-skin contract qty, not the first group count", () => {
    const tu = makeTradeUp({
      input_summary: {
        input_count: 10,
        collections: ["A"],
        skins: [
          { name: "Skin A", count: 7, condition: "Field-Tested" },
          { name: "Skin B", count: 3, condition: "Field-Tested" },
        ],
      },
      inputs: [
        ...Array.from({ length: 7 }, (_, i) => input({ listing_id: `a${i}`, skin_name: "Skin A" })),
        ...Array.from({ length: 3 }, (_, i) => input({ listing_id: `b${i}`, skin_name: "Skin B" })),
      ],
    });
    expect(inputQty(tu)).toBe(10);
  });

  it("falls back to input listing count when input_count is missing", () => {
    const tu = makeTradeUp({
      input_summary: undefined,
      inputs: Array.from({ length: 10 }, (_, i) => input({ listing_id: `i${i}`, skin_name: i < 6 ? "Skin A" : "Skin B" })),
    });
    expect(inputQty(tu)).toBe(10);
  });

  it("keeps every unique input and output — not a two-skin or hero slice", () => {
    const tu = makeTradeUp({
      inputs: [
        ...Array.from({ length: 4 }, (_, i) => input({ listing_id: `a${i}`, skin_name: "Skin A" })),
        ...Array.from({ length: 3 }, (_, i) => input({ listing_id: `b${i}`, skin_name: "Skin B" })),
        ...Array.from({ length: 3 }, (_, i) => input({ listing_id: `c${i}`, skin_name: "Skin C" })),
      ],
      outcomes: [
        outcome({ skin_id: "1", skin_name: "Out 1", probability: 0.2, estimated_price_cents: 1000 }),
        outcome({ skin_id: "2", skin_name: "Out 2", probability: 0.3, estimated_price_cents: 2000 }),
        outcome({ skin_id: "3", skin_name: "Out 3", probability: 0.5, estimated_price_cents: 3000 }),
      ],
    });
    expect(uniqueInputs(tu).map((g) => g.name)).toEqual(["Skin A", "Skin B", "Skin C"]);
    expect(uniqueInputs(tu).map((g) => g.count)).toEqual([4, 3, 3]);
    expect(uniqueOutputs(tu).map((o) => o.skin_name)).toEqual(["Out 1", "Out 2", "Out 3"]);
  });

  it("reads unique inputs from input_summary when listings are not loaded", () => {
    const tu = makeTradeUp({
      inputs: [],
      input_summary: {
        input_count: 10,
        collections: ["A", "B"],
        skins: [
          { name: "Skin A", count: 4, condition: "Field-Tested" },
          { name: "Skin B", count: 3, condition: "Field-Tested" },
          { name: "Skin C", count: 3, condition: "Field-Tested" },
        ],
      },
    });
    expect(uniqueInputs(tu).map((g) => `${g.name}×${g.count}`)).toEqual(["Skin A×4", "Skin B×3", "Skin C×3"]);
  });

  it("builds stacked-bar segments from actual outcome probabilities", () => {
    const tu = makeTradeUp({
      total_cost_cents: 500,
      outcomes: [
        outcome({ skin_name: "Cheap", probability: 0.7, estimated_price_cents: 100 }),
        outcome({ skin_name: "Jackpot", probability: 0.3, estimated_price_cents: 900 }),
      ],
    });
    const segs = oddsBarSegments(tu);
    expect(segs).toHaveLength(2);
    expect(segs[0]?.probability).toBeCloseTo(0.7);
    expect(segs[1]?.probability).toBeCloseTo(0.3);
    expect(segs.reduce((s, g) => s + g.probability, 0)).toBeCloseTo(1);
    expect(segs.every((g) => g.color.startsWith("#"))).toBe(true);
  });

  it("returns no odds-bar segments when outcomes are not hydrated yet", () => {
    const tu = makeTradeUp({ outcomes: [] });
    expect(oddsBarSegments(tu)).toEqual([]);
  });

  it("opens every distinct listing URL for a grouped input", () => {
    const tu = makeTradeUp({
      inputs: [
        input({ listing_id: "aa", skin_name: "Skin A" }),
        input({ listing_id: "ab", skin_name: "Skin A" }),
        input({ listing_id: "b1", skin_name: "Skin B" }),
      ],
    });
    const group = uniqueInputs(tu).find((g) => g.name === "Skin A");
    const hrefs = inputListingHrefs(group?.listings ?? []);
    expect(hrefs).toHaveLength(2);
    expect(hrefs.every((href) => href.startsWith("https://"))).toBe(true);
  });

  it("reports blocked popups after the first listing so the card can expand", () => {
    const result = openGroupedListings(
      ["https://csfloat.com/item/1", "https://csfloat.com/item/2"],
      (url) => (url.endsWith("/1") ? {} : null),
    );
    expect(result.opened).toEqual(["https://csfloat.com/item/1"]);
    expect(result.blocked).toEqual(["https://csfloat.com/item/2"]);
  });

  it("sends output clicks to prod skins or a marketplace, never a local /skins path", () => {
    const href = outputHref(outcome({ skin_name: "AK-47 | Redline" }));
    expect(href.startsWith("https://")).toBe(true);
    expect(href).not.toMatch(/^\/skins\//);
    expect(href).toContain("tradeupbot.app/skins/ak-47-redline");
  });

  it("keeps Verify/Claim on prod trade-ups, not the preview SPA", () => {
    expect(verifyClaimHref(42)).toBe("https://tradeupbot.app/trade-ups/42");
  });
});
