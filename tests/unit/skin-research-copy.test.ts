import { describe, it, expect } from "vitest";
import { buildSkinResearchParagraphs } from "../../server/seo.js";

const AK: Parameters<typeof buildSkinResearchParagraphs>[0] = {
  skinName: "AK-47 | Redline",
  rarity: "Classified",
  minFloat: 0.1,
  maxFloat: 0.7,
  availableConditions: ["Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"],
  collectionDisplay: "Phoenix",
  outputTier: "Covert",
  inputTuCount: 3,
  outputTuCount: 0,
  bestProfitCents: 1234,
};

const GLOVE: Parameters<typeof buildSkinResearchParagraphs>[0] = {
  skinName: "Desert Eagle | Blaze",
  rarity: "Restricted",
  minFloat: 0.0,
  maxFloat: 0.08,
  availableConditions: ["Factory New", "Minimal Wear"],
  collectionDisplay: null,
  outputTier: "Classified",
  inputTuCount: 0,
  outputTuCount: 0,
  bestProfitCents: 0,
};

describe("buildSkinResearchParagraphs", () => {
  it("returns exactly two paragraphs", () => {
    const html = buildSkinResearchParagraphs(AK);
    expect((html.match(/<p>/g) ?? []).length).toBe(2);
    expect((html.match(/<\/p>/g) ?? []).length).toBe(2);
  });

  it("weaves in the skin's real float numbers, rarity, and output tier", () => {
    const html = buildSkinResearchParagraphs(AK);
    expect(html).toContain("0.10");
    expect(html).toContain("0.70");
    expect(html).toContain("Classified");
    expect(html).toContain("Covert");
  });

  it("HTML-escapes interpolated names (ampersand in collection)", () => {
    const html = buildSkinResearchParagraphs({ ...AK, collectionDisplay: "Dreams & Nightmares" });
    expect(html).toContain("Dreams &amp; Nightmares");
    expect(html).not.toContain("Dreams & Nightmares");
  });

  it("mentions the collection when present and omits it when absent", () => {
    expect(buildSkinResearchParagraphs(AK)).toContain("Phoenix");
    const noColl = buildSkinResearchParagraphs(GLOVE);
    expect(noColl).not.toContain("collection undefined");
    expect(noColl).not.toContain("null");
  });

  it("surfaces the profitable-contract count and best profit when the skin is an input", () => {
    const html = buildSkinResearchParagraphs(AK);
    expect(html).toContain("3 profitable");
    expect(html).toContain("$12.34");
  });

  it("states plainly when no profitable contracts exist, without overclaiming", () => {
    const html = buildSkinResearchParagraphs(GLOVE);
    expect(html.toLowerCase()).toContain("no profitable");
    // Never promise exact/guaranteed sale outcomes (codex overclaim guard).
    expect(html.toLowerCase()).not.toContain("guarantee");
    expect(html.toLowerCase()).not.toContain("exact output");
  });

  it("produces materially different prose per skin (de-boilerplate)", () => {
    const a = buildSkinResearchParagraphs(AK);
    const b = buildSkinResearchParagraphs(GLOVE);
    expect(a).not.toEqual(b);
    // The distinctive, skin-specific tokens must not leak across pages.
    expect(a).not.toContain("Desert Eagle");
    expect(b).not.toContain("Redline");
  });

  it("does NOT claim terminal items (knives/gloves, null outputTier) trade up", () => {
    const glove = {
      skinName: "Sport Gloves | Pandora's Box",
      rarity: "Extraordinary",
      minFloat: 0.06,
      maxFloat: 0.8,
      availableConditions: ["Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"],
      collectionDisplay: null,
      outputTier: null,
      inputTuCount: 0,
      outputTuCount: 4,
      bestProfitCents: 0,
    };
    const html = buildSkinResearchParagraphs(glove);
    expect(html).not.toContain("trade up into");
    expect(html).not.toContain("sits one tier below");
    expect(html).toContain("trade-up result");
    expect(html).toContain("4 profitable"); // still surfaces its output role
  });

  it("uses singular grammar for float-only note when there is no collection", () => {
    const html = buildSkinResearchParagraphs(GLOVE); // collectionDisplay: null, no contracts
    expect(html).toContain("its float profile still shapes");
    expect(html).not.toContain("collection and float profile");
  });

  it("handles a single-condition skin without dangling grammar", () => {
    const single = { ...GLOVE, availableConditions: ["Factory New"] };
    const html = buildSkinResearchParagraphs(single);
    expect(html).toContain("Factory New");
    expect(html).not.toContain(", condition");
    expect(html).not.toContain(" and .");
  });
});
