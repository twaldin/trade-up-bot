import { describe, expect, it } from "vitest";
import {
  chipsToBoardParams,
  chipsToSkinParams,
  matchNames,
  parseQuery,
  tokenize,
  typingTail,
  type NameHit,
} from "../../src/preview/lib/query-parse.js";

const NAMES: NameHit[] = [
  { name: "AK-47 | Nightwish", rarity: "Covert" },
  { name: "AK-47 | Redline", rarity: "Classified" },
  { name: "M4A4 | Howl", rarity: "Contraband" },
  { name: "Glock-18 | Water Elemental", rarity: "Restricted" },
  { name: "The Dreams & Nightmares Collection", kind: "collection" },
];

describe("semantic query chips", () => {
  it("reads a bare comparison as a price", () => {
    const { chips } = parseQuery("<=400");
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({ kind: "max_price", field: "Max Price", value: 40000 });
    expect(chips[0]?.label).toBe("<= $400.00");
  });

  it("reads a dollar comparison as a price even when small", () => {
    const { chips } = parseQuery("<$0.70");
    expect(chips[0]).toMatchObject({ kind: "max_price", value: 70 });
  });

  it("reads a sub-1 decimal without a dollar sign as a float", () => {
    const { chips } = parseQuery("<0.03");
    expect(chips[0]).toMatchObject({ kind: "max_float", field: "Max Float", value: 0.03 });
    expect(chips[0]?.label).toBe("< 0.03");
  });

  it("reads the greater-than side too", () => {
    const { chips } = parseQuery(">=10 >0.15");
    expect(chips.map((chip) => chip.kind)).toEqual(["min_price", "min_float"]);
    expect(chips[0]?.value).toBe(1000);
    expect(chips[1]?.value).toBe(0.15);
  });

  it("parses Tim's example end to end", () => {
    const { chips, rest } = parseQuery("covert <0.03 <$700", NAMES);
    expect(chips.map((chip) => chip.field)).toEqual(["Tier", "Max Float", "Max Price"]);
    expect(chips[0]?.value).toBe("covert_knife");
    expect(chips[1]?.value).toBe(0.03);
    expect(chips[2]?.value).toBe(70000);
    expect(rest).toEqual([]);
  });

  it("recognises wear shorthand and full names", () => {
    expect(parseQuery("fn").chips[0]).toMatchObject({ kind: "wear", value: "Factory New" });
    expect(parseQuery("\"minimal wear\"").chips[0]).toMatchObject({ value: "Minimal Wear" });
    expect(parseQuery("ww").chips[0]).toMatchObject({ value: "Well-Worn" });
  });

  it("recognises StatTrak and a paint seed", () => {
    const { chips } = parseQuery("st #661");
    expect(chips.map((chip) => chip.field)).toEqual(["Category", "Paint Seed"]);
    expect(chips[1]?.value).toBe("661");
  });

  it("turns a known skin name into an item chip", () => {
    const { chips, rest } = parseQuery("ak nightwish", NAMES);
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({ kind: "item", field: "Item", value: "AK-47 | Nightwish" });
    expect(rest).toEqual([]);
  });

  it("turns a known collection into a collection chip", () => {
    const { chips } = parseQuery("dreams nightmares", NAMES);
    expect(chips[0]).toMatchObject({ kind: "collection", field: "Collection" });
  });

  it("keeps words it cannot place instead of dropping them", () => {
    const { chips, rest } = parseQuery("fn zzzz", NAMES);
    expect(chips.map((chip) => chip.kind)).toEqual(["wear"]);
    expect(rest).toEqual(["zzzz"]);
  });

  it("mixes an item with comparisons in any order", () => {
    const { chips } = parseQuery("<$50 redline ft", NAMES);
    expect(chips.map((chip) => chip.field).sort()).toEqual(["Item", "Max Price", "Wear"]);
  });

  it("keeps a quoted phrase together", () => {
    expect(tokenize('"water elemental" fn')).toEqual(["water elemental", "fn"]);
  });
});

describe("fuzzy name matching", () => {
  it("requires every word and prefers the shorter name", () => {
    expect(matchNames("ak", NAMES).map((hit) => hit.name)).toEqual([
      "AK-47 | Redline",
      "AK-47 | Nightwish",
    ]);
  });

  it("ignores the star and pipe punctuation", () => {
    expect(matchNames("m4a4 howl", NAMES)[0]?.name).toBe("M4A4 | Howl");
  });

  it("returns nothing for an empty query", () => {
    expect(matchNames("", NAMES)).toEqual([]);
    expect(matchNames("nope", NAMES)).toEqual([]);
  });
});

describe("chips to API parameters", () => {
  it("maps board chips onto parameters the trade-ups API accepts", () => {
    const { chips, rest } = parseQuery("covert <$700 ak nightwish", NAMES);
    const params = chipsToBoardParams(chips, rest);
    expect(params).toEqual({
      type: "covert_knife",
      max_cost: "70000",
      skin: "AK-47 | Nightwish",
    });
  });

  it("falls back to free text as the skin filter", () => {
    const params = chipsToBoardParams([], ["someunknownskin"]);
    expect(params.skin).toBe("someunknownskin");
  });

  it("maps skin-index chips onto search, rarity and client-side float bounds", () => {
    const { chips, rest } = parseQuery("classified <0.07 redline", NAMES);
    const params = chipsToSkinParams(chips, rest);
    expect(params.rarity).toBe("Classified");
    expect(params.maxFloat).toBe(0.07);
    expect(params.search).toBe("AK-47 | Redline");
  });

  it("passes a wear chip through for client-side filtering", () => {
    const { chips } = parseQuery("fn");
    expect(chipsToSkinParams(chips).wear).toBe("Factory New");
  });
});

describe("completion follows the cursor", () => {
  it("returns the words being typed even after a chip claimed them", () => {
    expect(typingTail("covert night")).toBe("covert night");
    expect(typingTail("<$700 ak night")).toBe("ak night");
  });

  it("returns nothing once the word is finished with a space", () => {
    expect(typingTail("nightwish ")).toBe("");
    expect(typingTail("")).toBe("");
  });

  it("stops at an operator token so a price is never completed as a name", () => {
    expect(typingTail("ak <0.03")).toBe("");
    expect(typingTail("ak #661")).toBe("");
  });

  it("caps how many trailing words it will treat as one name", () => {
    expect(typingTail("a b c d e f")).toBe("c d e f");
  });
});
