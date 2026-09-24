import { describe, expect, it } from "vitest";
import { makeTradeUp } from "../helpers/fixtures.js";
import { HERO_PROOF_OUTCOMES, heroProof, pickHeroTradeUp } from "../../src/preview/lib/hero-proof.js";
import type { TradeUpOutcome } from "../../shared/types.js";

function outcome(name: string, probability: number, priceCents: number): TradeUpOutcome {
  return {
    skin_id: name,
    skin_name: name,
    collection_name: "Test Collection",
    probability,
    predicted_float: 0.2,
    predicted_condition: "Field-Tested",
    estimated_price_cents: priceCents,
  };
}

describe("pickHeroTradeUp", () => {
  it("takes the first row whose real listings are loaded", () => {
    const summaryOnly = makeTradeUp({ id: 1, listingIds: [] });
    const theoretical = makeTradeUp({ id: 2, is_theoretical: true });
    const real = makeTradeUp({ id: 3 });
    expect(pickHeroTradeUp([summaryOnly, theoretical, real])?.id).toBe(3);
  });

  it("returns null when nothing on the page has listings", () => {
    expect(pickHeroTradeUp([])).toBeNull();
    expect(pickHeroTradeUp([makeTradeUp({ listingIds: [] })])).toBeNull();
  });
});

describe("heroProof", () => {
  it("is null without listings, so the hero never shows an unbuyable trade-up", () => {
    expect(heroProof(null)).toBeNull();
    expect(heroProof(makeTradeUp({ listingIds: [] }))).toBeNull();
    expect(heroProof(makeTradeUp({ is_theoretical: true }))).toBeNull();
  });

  it("lists every input listing, not a subset", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `l${i}`);
    const proof = heroProof(makeTradeUp({ listingIds: ids }));
    expect(proof?.listings.map((row) => row.listing_id)).toEqual(ids);
  });

  it("orders outcomes by odds, caps them, and counts the rest", () => {
    const outcomes = [
      outcome("A", 0.05, 900),
      outcome("B", 0.4, 3000),
      outcome("C", 0.2, 1500),
      outcome("D", 0.15, 2000),
      outcome("E", 0.1, 4000),
      outcome("F", 0.1, 100),
    ];
    const proof = heroProof(makeTradeUp({ outcomes, total_cost_cents: 2500 }));
    expect(proof?.outcomes.map((row) => row.name)).toEqual(["B", "C", "D", "E"].slice(0, HERO_PROOF_OUTCOMES));
    expect(proof?.hiddenOutcomes).toBe(outcomes.length - HERO_PROOF_OUTCOMES);
  });

  it("merges duplicate outcome skins before ranking", () => {
    const proof = heroProof(makeTradeUp({
      outcomes: [outcome("A", 0.3, 1000), outcome("B", 0.4, 900), outcome("A", 0.3, 1000)],
    }));
    expect(proof?.outcomes[0]).toMatchObject({ name: "A", probability: 0.6 });
    expect(proof?.hiddenOutcomes).toBe(0);
  });

  it("prices each outcome against the real cost in integer cents", () => {
    const proof = heroProof(makeTradeUp({
      total_cost_cents: 5314,
      outcomes: [outcome("AK-47 | Nightwish", 0.5, 5566), outcome("MP9 | Starlight Protector", 0.5, 5704)],
    }));
    expect(proof?.outcomes.map((row) => row.profitCents)).toEqual([390, 252].sort((a, b) => b - a));
    for (const row of proof?.outcomes ?? []) expect(Number.isInteger(row.profitCents)).toBe(true);
  });

  it("uses the stored chance of profit and falls back to the outcomes", () => {
    const stored = heroProof(makeTradeUp({ chance_to_profit: 0.73 }));
    expect(stored?.chance).toBe(0.73);
    const computed = heroProof(makeTradeUp({
      total_cost_cents: 1000,
      outcomes: [outcome("A", 0.25, 2000), outcome("B", 0.75, 500)],
    }));
    expect(computed?.chance).toBeCloseTo(0.25);
  });

  it("carries the headline numbers straight from the row", () => {
    const tu = makeTradeUp({ id: 42, total_cost_cents: 5314, expected_value_cents: 5635, profit_cents: 321, roi_percentage: 6.04 });
    expect(heroProof(tu)).toMatchObject({ id: 42, costCents: 5314, evCents: 5635, profitCents: 321, roiPct: 6.04 });
  });

  it("names the rarity step the ten inputs make", () => {
    expect(heroProof(makeTradeUp({ type: "classified_covert" }))?.route).toBe("Classified → Covert");
    expect(heroProof(makeTradeUp({ type: "covert_knife" }))?.route).toBe("Covert → Knife / Gloves");
  });
});
