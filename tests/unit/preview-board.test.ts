import { describe, expect, it } from "vitest";
import { makeTradeUp } from "../helpers/fixtures.js";
import type { TradeUpInput, TradeUpOutcome } from "../../shared/types.js";
import {
  averageFloat,
  cdfCurve,
  chanceOfProfit,
  conditionShort,
  formatFloat,
  previewCollectionHref,
  previewSkinHref,
  reorderForExpanded,
  evDrivers,
  evWaterfall,
  inputCostCents,
  inputListingHrefs,
  inputQty,
  inputRarityColor,
  inputRarityLabel,
  listingTotals,
  rarityLabel,
  medianProfitCents,
  openGroupedListings,
  outputHref,
  outputRarityColor,
  payoffPoints,
  percentileProfitCents,
  splitSkinName,
  storyRailInputs,
  tickFaceLayout,
  uniqueInputs,
  uniqueOutputs,
  verifyClaimHref,
  waterfallBars,
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

  it("lists every live input on the story rail so the rows sum to the card cost", () => {
    const rows = [
      { skin_name: "MP7 | Abyssal Apparition", float_value: 0.1368, price_cents: 556 },
      { skin_name: "Dual Berettas | Melondrama", float_value: 0.3911, price_cents: 529 },
      { skin_name: "MP7 | Abyssal Apparition", float_value: 0.2392, price_cents: 400 },
      { skin_name: "Dual Berettas | Melondrama", float_value: 0.2453, price_cents: 551 },
      { skin_name: "FAMAS | Rapid Eye Movement", float_value: 0.4409, price_cents: 532 },
      { skin_name: "Dual Berettas | Melondrama", float_value: 0.4067, price_cents: 531 },
      { skin_name: "FAMAS | Rapid Eye Movement", float_value: 0.3829, price_cents: 522 },
      { skin_name: "FAMAS | Rapid Eye Movement", float_value: 0.4152, price_cents: 521 },
      { skin_name: "Dual Berettas | Melondrama", float_value: 0.8672, price_cents: 458 },
      { skin_name: "FAMAS | Rapid Eye Movement", float_value: 0.3142, price_cents: 500 },
    ];
    const tu = makeTradeUp({
      total_cost_cents: 5100,
      input_summary: { input_count: 10, collections: ["Dreams & Nightmares"], skins: [] },
      inputs: rows.map((row, i) => input({ listing_id: `story-${i}`, ...row })),
    });
    const rail = storyRailInputs(tu);
    expect(rail).toHaveLength(10);
    expect(rail.reduce((sum, row) => sum + row.price_cents, 0)).toBe(tu.total_cost_cents);
    expect(rail.some((row) => row.float_value === 0.8672 && row.price_cents === 458)).toBe(true);
    expect(rail.some((row) => row.float_value === 0.3142 && row.price_cents === 500)).toBe(true);
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

  it("names the input tier one below the output tier", () => {
    const pairs: Array<[string, string, string]> = [
      ["covert_knife", "Covert", "Knife / Gloves"],
      ["classified_covert", "Classified", "Covert"],
      ["restricted_classified", "Restricted", "Classified"],
      ["milspec_restricted", "Mil-Spec", "Restricted"],
      ["industrial_milspec", "Industrial", "Mil-Spec"],
      ["consumer_industrial", "Consumer", "Industrial"],
    ];
    for (const [type, inputs, outputs] of pairs) {
      expect(inputRarityLabel(type)).toBe(inputs);
      expect(rarityLabel(type)).toBe(outputs);
      expect(inputRarityLabel(type)).not.toBe(rarityLabel(type));
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
    expect(waterfallBars(empty).bars).toEqual([]);
  });

  it("reads a percentile off the discrete P/L distribution", () => {
    const points = payoffPoints(tu);
    expect(percentileProfitCents(points, 0.5)).toBe(medianProfitCents(points));
    expect(percentileProfitCents(points, 0.1)).toBe(-600);
    expect(percentileProfitCents(points, 0.99)).toBe(1800);
    expect(percentileProfitCents([], 0.5)).toBeNull();
  });
});

describe("preview EV waterfall bars", () => {
  const tu = makeTradeUp({
    total_cost_cents: 1000,
    outcomes: [
      outcome({ skin_id: "a", skin_name: "Big drag", probability: 0.5, estimated_price_cents: 200 }),
      outcome({ skin_id: "b", skin_name: "Small drag", probability: 0.1, estimated_price_cents: 900 }),
      outcome({ skin_id: "c", skin_name: "Jackpot", probability: 0.3, estimated_price_cents: 4000 }),
      outcome({ skin_id: "d", skin_name: "Small lift", probability: 0.1, estimated_price_cents: 1500 }),
    ],
  });

  it("orders positives by size, then drags by size, and ends on the total", () => {
    const { bars, totalEvCents } = waterfallBars(tu);
    expect(bars.map((bar) => bar.name)).toEqual(["Jackpot", "Small lift", "Big drag", "Small drag"]);
    expect(totalEvCents).toBe(900 + 50 - 400 - 10);
  });

  it("floats each bar from the running total so the steps actually connect", () => {
    const { bars, totalEvCents } = waterfallBars(tu);
    expect(bars[0]?.startCents).toBe(0);
    for (const bar of bars) {
      expect(bar.endCents - bar.startCents).toBe(bar.evContributionCents);
    }
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i]?.startCents).toBe(bars[i - 1]?.endCents);
    }
    expect(bars[bars.length - 1]?.endCents).toBe(totalEvCents);
  });

  it("ranks EV drivers and drags off real probability-weighted contributions", () => {
    const { drivers, drags } = evDrivers(payoffPoints(tu), 3);
    expect(drivers.map((point) => point.name)).toEqual(["Jackpot", "Small lift"]);
    expect(drags.map((point) => point.name)).toEqual(["Big drag", "Small drag"]);
    expect(drivers[0]?.evContributionCents).toBe(900);
    expect(drags[0]?.evContributionCents).toBe(-400);
  });

  it("caps each ranked list at the requested length", () => {
    expect(evDrivers(payoffPoints(tu), 1).drivers).toHaveLength(1);
    expect(evDrivers([], 3)).toEqual({ drivers: [], drags: [] });
  });
});

describe("preview tile labels", () => {
  it("splits a market hash name into weapon and finish so tiles stop ellipsing", () => {
    expect(splitSkinName("AK-47 | Nightwish")).toEqual({ weapon: "AK-47", finish: "Nightwish" });
    expect(splitSkinName("Dual Berettas | Melondrama")).toEqual({
      weapon: "Dual Berettas",
      finish: "Melondrama",
    });
    expect(splitSkinName("★ Karambit | Doppler")).toEqual({ weapon: "★ Karambit", finish: "Doppler" });
  });

  it("keeps a name without a separator on the finish line", () => {
    expect(splitSkinName("Sticker Capsule")).toEqual({ weapon: "", finish: "Sticker Capsule" });
    expect(splitSkinName("")).toEqual({ weapon: "", finish: "" });
  });

  it("abbreviates wear the way the marketplaces do", () => {
    expect(conditionShort("Factory New")).toBe("FN");
    expect(conditionShort("Minimal Wear")).toBe("MW");
    expect(conditionShort("Field-Tested")).toBe("FT");
    expect(conditionShort("Well-Worn")).toBe("WW");
    expect(conditionShort("Battle-Scarred")).toBe("BS");
    expect(conditionShort("")).toBe("");
  });
});

describe("preview float and price on inputs", () => {
  it("averages price and float across a grouped input's listings", () => {
    const tu = makeTradeUp({
      inputs: [
        input({ listing_id: "a1", skin_name: "Skin A", price_cents: 500, float_value: 0.0691 }),
        input({ listing_id: "a2", skin_name: "Skin A", price_cents: 520, float_value: 0.0695 }),
        input({ listing_id: "b1", skin_name: "Skin B", price_cents: 300, float_value: 0.4 }),
      ],
    });
    const group = uniqueInputs(tu).find((row) => row.name === "Skin A");
    expect(group?.unitPriceCents).toBe(510);
    expect(formatFloat(group?.avgFloat)).toBe("0.0693");
    expect(group?.condition).toBe("Field-Tested");
  });

  it("omits the average float instead of inventing 0 before listings hydrate", () => {
    const tu = makeTradeUp({
      inputs: [],
      input_summary: {
        input_count: 10,
        collections: ["A"],
        skins: [{ name: "Skin A", count: 10, condition: "Well-Worn" }],
      },
    });
    const group = uniqueInputs(tu)[0];
    expect(group?.avgFloat).toBeNull();
    expect(formatFloat(group?.avgFloat)).toBeNull();
    expect(averageFloat([])).toBeNull();
  });

  it("prints four decimals, the number the marketplaces print", () => {
    expect(formatFloat(0.06931234567)).toBe("0.0693");
    expect(formatFloat(0)).toBe("0.0000");
    expect(formatFloat(undefined)).toBeNull();
    expect(formatFloat(Number.NaN)).toBeNull();
  });
});

describe("preview in-shell data pages", () => {
  it("links skin names at the real console route", () => {
    expect(previewSkinHref("AK-47 | Nightwish")).toBe("/skins/ak-47-nightwish");
    expect(previewSkinHref("AK-47 | Nightwish").startsWith("/preview")).toBe(false);
  });

  it("links collections at the real console route", () => {
    const href = previewCollectionHref("The Dreams & Nightmares Collection");
    expect(href.startsWith("/collections/")).toBe(true);
    expect(href).not.toContain(" ");
  });
});

describe("preview tick faces", () => {
  it("centres a face on its tick when nothing is near it", () => {
    const { faces, crowded } = tickFaceLayout([
      { name: "Loser", x: 24, probability: 0.5 },
      { name: "Winner", x: 74, probability: 0.5 },
    ]);
    expect(crowded).toBe(false);
    expect(faces.map((face) => face.align)).toEqual(["center", "center"]);
  });

  it("pushes a close pair away from each other, not toward the middle", () => {
    const { faces, crowded } = tickFaceLayout([
      { name: "Left", x: 70, probability: 0.5 },
      { name: "Right", x: 76, probability: 0.5 },
    ]);
    expect(crowded).toBe(true);
    // the left one grows leftward, the right one rightward
    expect(faces.find((face) => face.name === "Left")?.align).toBe("end");
    expect(faces.find((face) => face.name === "Right")?.align).toBe("start");
  });

  it("spreads a close pair on the loss side the same way", () => {
    const { faces } = tickFaceLayout([
      { name: "Left", x: 18, probability: 0.5 },
      { name: "Right", x: 26, probability: 0.5 },
    ]);
    expect(faces.find((face) => face.name === "Left")?.align).toBe("end");
    expect(faces.find((face) => face.name === "Right")?.align).toBe("start");
  });

  it("keeps the middle of an odd cluster centred and spreads the rest", () => {
    const { faces } = tickFaceLayout([
      { name: "A", x: 60, probability: 0.3 },
      { name: "B", x: 66, probability: 0.3 },
      { name: "C", x: 72, probability: 0.4 },
    ]);
    const align = Object.fromEntries(faces.map((face) => [face.name, face.align]));
    expect(align).toEqual({ A: "end", B: "center", C: "start" });
  });

  it("treats separated clusters independently", () => {
    const { faces } = tickFaceLayout([
      { name: "Lone", x: 10, probability: 0.2 },
      { name: "PairL", x: 70, probability: 0.4 },
      { name: "PairR", x: 76, probability: 0.4 },
    ]);
    const align = Object.fromEntries(faces.map((face) => [face.name, face.align]));
    expect(align).toEqual({ Lone: "center", PairL: "end", PairR: "start" });
  });

  it("never lets a face at either end escape the well", () => {
    const { faces } = tickFaceLayout([
      { name: "Far left", x: 2, probability: 0.5 },
      { name: "Nudge", x: 8, probability: 0.5 },
      { name: "Far right", x: 98, probability: 0.5 },
    ]);
    expect(faces.find((face) => face.name === "Far left")?.align).toBe("start");
    expect(faces.find((face) => face.name === "Far right")?.align).toBe("end");
  });

  it("stacks the likeliest outcome on top when ticks crowd", () => {
    const { faces, crowded } = tickFaceLayout([
      { name: "Rare", x: 70, probability: 0.05 },
      { name: "Common", x: 74, probability: 0.7 },
      { name: "Mid", x: 78, probability: 0.25 },
    ]);
    expect(crowded).toBe(true);
    const z = Object.fromEntries(faces.map((face) => [face.name, face.z]));
    expect(z.Common).toBeGreaterThan(z.Mid ?? 0);
    expect(z.Mid).toBeGreaterThan(z.Rare ?? 0);
  });

  it("handles an empty outcome set", () => {
    expect(tickFaceLayout([])).toEqual({ faces: [], crowded: false });
  });
});

describe("preview listing totals", () => {
  it("totals and averages the real listing prices", () => {
    const rows = [
      input({ listing_id: "1", price_cents: 529 }),
      input({ listing_id: "2", price_cents: 531 }),
      input({ listing_id: "3", price_cents: 400 }),
    ];
    expect(listingTotals(rows)).toEqual({ count: 3, totalCents: 1460, averageCents: 487 });
  });

  it("does not divide by zero on an unhydrated trade-up", () => {
    expect(listingTotals([])).toEqual({ count: 0, totalCents: 0, averageCents: 0 });
  });
});

describe("preview output order follows the strip", () => {
  it("orders output tiles by P/L so they match the ticks left to right", () => {
    const tu = makeTradeUp({
      total_cost_cents: 127,
      outcomes: [
        outcome({ skin_id: "a", skin_name: "AK-47 | Breakthrough", probability: 0.5, estimated_price_cents: 221 }),
        outcome({ skin_id: "b", skin_name: "Glock-18 | Trace Lock", probability: 0.5, estimated_price_cents: 106 }),
      ],
    });
    expect(uniqueOutputs(tu).map((row) => row.skin_name)).toEqual([
      "Glock-18 | Trace Lock",
      "AK-47 | Breakthrough",
    ]);
    expect(payoffPoints(tu).map((point) => point.name)).toEqual([
      "Glock-18 | Trace Lock",
      "AK-47 | Breakthrough",
    ]);
  });

  it("keeps tiles and ticks in step for more than two outcomes", () => {
    const tu = makeTradeUp({
      total_cost_cents: 1000,
      outcomes: [
        outcome({ skin_id: "1", skin_name: "Mid", probability: 0.3, estimated_price_cents: 1200 }),
        outcome({ skin_id: "2", skin_name: "Jackpot", probability: 0.1, estimated_price_cents: 5000 }),
        outcome({ skin_id: "3", skin_name: "Dud", probability: 0.6, estimated_price_cents: 400 }),
      ],
    });
    expect(uniqueOutputs(tu).map((row) => row.skin_name))
      .toEqual(payoffPoints(tu).map((point) => point.name));
  });
});

describe("preview expand keeps its row", () => {
  const rows = [0, 1, 2, 3, 4, 5, 6, 7].map((id) => ({ id }));

  it("moves an expanded card to the head of the row it was already in", () => {
    expect(reorderForExpanded(rows, 4, 3).map((row) => row.id)).toEqual([0, 1, 2, 4, 3, 5, 6, 7]);
    expect(reorderForExpanded(rows, 2, 3).map((row) => row.id)).toEqual([2, 0, 1, 3, 4, 5, 6, 7]);
  });

  it("leaves a card that already starts its row alone", () => {
    expect(reorderForExpanded(rows, 3, 3)).toBe(rows);
    expect(reorderForExpanded(rows, 0, 3)).toBe(rows);
  });

  it("keeps every card exactly once so nothing is dropped or duplicated", () => {
    const next = reorderForExpanded(rows, 5, 3);
    expect(next).toHaveLength(rows.length);
    expect([...next].map((row) => row.id).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("does nothing for a single-column board or a bad index", () => {
    expect(reorderForExpanded(rows, 4, 1)).toBe(rows);
    expect(reorderForExpanded(rows, -1, 3)).toBe(rows);
    expect(reorderForExpanded(rows, 99, 3)).toBe(rows);
  });
});
