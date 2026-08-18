import { describe, expect, it } from "vitest";
import { makeTradeUp } from "../helpers/fixtures.js";
import type { TradeUpInput, TradeUpOutcome } from "../../shared/types.js";
import {
  cdfCurve,
  chanceOfProfit,
  evWaterfall,
  inputCostCents,
  inputListingHrefs,
  inputQty,
  inputRarityColor,
  medianProfitCents,
  openGroupedListings,
  outputHref,
  outputRarityColor,
  payoffPoints,
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
  it("uses the trade-up input total as cost, not an outcome price", () => {
    const tu = makeTradeUp({
      total_cost_cents: 12345,
      expected_value_cents: 99999,
      outcomes: [outcome({ estimated_price_cents: 88888, probability: 1 })],
    });
    expect(inputCostCents(tu)).toBe(12345);
  });

  it("uses the 10-skin trade-up qty, not the first group count", () => {
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
        ...Array.from({ length: 4 }, (_, i) => input({ listing_id: `a${i}`, skin_name: "Skin A", price_cents: 200 })),
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
    expect(uniqueInputs(tu)[0]?.unitPriceCents).toBe(200);
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

describe("preview rarity is one tier apart", () => {
  it("paints Covert trade-up inputs Classified pink, not Covert red", () => {
    expect(inputRarityColor("classified_covert")).toBe("#d32ce6");
    expect(outputRarityColor("classified_covert")).toBe("#eb4b4b");
  });

  it("maps every trade-up type to the CS2 input/output pair", () => {
    const pairs: Array<[string, string, string]> = [
      ["covert_knife", "#eb4b4b", "#d4a017"],
      ["classified_covert", "#d32ce6", "#eb4b4b"],
      ["restricted_classified", "#8847ff", "#d32ce6"],
      ["milspec_restricted", "#4b69ff", "#8847ff"],
      ["industrial_milspec", "#5e98d9", "#4b69ff"],
      ["consumer_industrial", "#b0c3d9", "#5e98d9"],
    ];
    for (const [type, input, output] of pairs) {
      expect(inputRarityColor(type)).toBe(input);
      expect(outputRarityColor(type)).toBe(output);
    }
  });

  it("never uses lime as a rarity color", () => {
    const types = [
      "covert_knife",
      "classified_covert",
      "restricted_classified",
      "milspec_restricted",
      "industrial_milspec",
      "consumer_industrial",
      undefined,
      "staircase",
    ];
    for (const type of types) {
      expect(inputRarityColor(type).toLowerCase()).not.toBe("#d7fe52");
      expect(outputRarityColor(type).toLowerCase()).not.toBe("#d7fe52");
    }
  });
});

describe("preview payoff from real outcomes", () => {
  const tu = makeTradeUp({
    total_cost_cents: 1000,
    expected_value_cents: 1160,
    profit_cents: 160,
    outcomes: [
      outcome({ skin_id: "a", skin_name: "Cheap", probability: 0.4, estimated_price_cents: 400 }),
      outcome({ skin_id: "b", skin_name: "Mid", probability: 0.35, estimated_price_cents: 1000 }),
      outcome({ skin_id: "c", skin_name: "Jackpot", probability: 0.25, estimated_price_cents: 2800 }),
    ],
  });

  it("sorts payoff points by P/L and keeps integer-cent profits", () => {
    const points = payoffPoints(tu);
    expect(points.map((p) => p.name)).toEqual(["Cheap", "Mid", "Jackpot"]);
    expect(points.map((p) => p.profitCents)).toEqual([-600, 0, 1800]);
    expect(points.every((p) => Number.isInteger(p.profitCents))).toBe(true);
    expect(points.every((p) => Number.isInteger(p.evContributionCents))).toBe(true);
  });

  it("walks cumulative probability to the median P/L", () => {
    expect(medianProfitCents(payoffPoints(tu))).toBe(0);
  });

  it("computes chance of profit from outcomes that beat cost", () => {
    expect(chanceOfProfit(payoffPoints(tu))).toBeCloseTo(0.25);
  });

  it("decomposes EV as p_i * profit_i and flags a concentrated jackpot", () => {
    const wf = evWaterfall(tu);
    expect(wf.steps.map((s) => s.name)).toEqual(["Cheap", "Mid", "Jackpot"]);
    expect(wf.steps[0]?.evContributionCents).toBe(-240);
    expect(wf.steps[1]?.evContributionCents).toBe(0);
    expect(wf.steps[2]?.evContributionCents).toBe(450);
    expect(wf.totalEvCents).toBe(210);
    expect(wf.topShare).toBeGreaterThan(0.5);
    expect(wf.concentrationNote).toMatch(/Jackpot/);
  });

  it("builds a real CDF of P(return ≥ x), not an invented series", () => {
    const cdf = cdfCurve(tu);
    expect(cdf.length).toBeGreaterThan(1);
    const atZero = cdf.find((p) => p.x === 0);
    expect(atZero?.p).toBeCloseTo(0.6);
    const atJackpot = cdf.find((p) => p.x === 1800);
    expect(atJackpot?.p).toBeCloseTo(0.25);
    expect(cdf.every((p, i) => i === 0 || p.x >= (cdf[i - 1]?.x ?? p.x))).toBe(true);
  });

  it("returns empty payoff artifacts when outcomes are not hydrated", () => {
    const empty = makeTradeUp({ outcomes: [] });
    expect(payoffPoints(empty)).toEqual([]);
    expect(medianProfitCents([])).toBeNull();
    expect(cdfCurve(empty)).toEqual([]);
    expect(evWaterfall(empty).steps).toEqual([]);
    expect(evWaterfall(empty).concentrationNote).toBeNull();
  });
});
