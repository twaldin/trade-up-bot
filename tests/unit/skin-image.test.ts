import { describe, expect, it } from "vitest";
import { makeTradeUp } from "../helpers/fixtures.js";
import {
  collectSkinNames,
  distinctiveSkinNames,
  isUsableImageUrl,
} from "../../src/utils/skin-image.js";

describe("isUsableImageUrl", () => {
  it("accepts absolute http(s) URLs already stored in-repo", () => {
    expect(isUsableImageUrl("https://raw.githubusercontent.com/ByMykel/example.png")).toBe(true);
    expect(isUsableImageUrl("http://example.test/skin.webp")).toBe(true);
  });

  it("rejects missing, relative, or non-http values instead of inventing a render", () => {
    expect(isUsableImageUrl(null)).toBe(false);
    expect(isUsableImageUrl(undefined)).toBe(false);
    expect(isUsableImageUrl("")).toBe(false);
    expect(isUsableImageUrl("/favicon.svg")).toBe(false);
    expect(isUsableImageUrl("javascript:alert(1)")).toBe(false);
  });
});

describe("distinctiveSkinNames", () => {
  it("prefers loaded outcomes then distinctive inputs, without inventing names", () => {
    const tu = makeTradeUp({
      input_summary: {
        skins: [
          { name: "AK-47 | Redline", count: 7, condition: "Field-Tested" },
          { name: "★ Karambit | Fade", count: 3, condition: "Factory New" },
        ],
        collections: ["Test Collection"],
        input_count: 10,
      },
      outcomes: [
        {
          skin_id: "glove-1",
          skin_name: "★ Sport Gloves | Pandora's Box",
          collection_name: "Test Collection",
          probability: 0.6,
          predicted_float: 0.15,
          predicted_condition: "Field-Tested",
          estimated_price_cents: 80_000,
        },
        {
          skin_id: "out-1",
          skin_name: "AK-47 | Fire Serpent",
          collection_name: "Test Collection",
          probability: 0.4,
          predicted_float: 0.15,
          predicted_condition: "Field-Tested",
          estimated_price_cents: 10_000,
        },
      ],
    });

    expect(distinctiveSkinNames(tu, 5)).toEqual([
      "★ Sport Gloves | Pandora's Box",
      "AK-47 | Fire Serpent",
      "★ Karambit | Fade",
      "AK-47 | Redline",
    ]);
  });

  it("falls back to input_summary when outcomes are not loaded yet", () => {
    const tu = makeTradeUp({
      outcomes: [],
      inputs: [],
      input_summary: {
        skins: [
          { name: "M4A1-S | Hot Rod", count: 10, condition: "Factory New" },
        ],
        collections: ["The Chop Shop Collection"],
        input_count: 10,
      },
    });

    expect(distinctiveSkinNames(tu, 4)).toEqual(["M4A1-S | Hot Rod"]);
  });

  it("caps the rail and never pads with fake skins", () => {
    const tu = makeTradeUp({
      outcomes: [],
      input_summary: {
        skins: [{ name: "Glock-18 | Candy Apple", count: 10, condition: "Factory New" }],
        collections: ["The Chop Shop Collection"],
        input_count: 10,
      },
    });

    expect(distinctiveSkinNames(tu, 5)).toHaveLength(1);
  });
});

describe("collectSkinNames", () => {
  it("unions summary, input, and outcome names for a batch image lookup", () => {
    const tu = makeTradeUp({
      input_summary: {
        skins: [{ name: "AK-47 | Redline", count: 10, condition: "Field-Tested" }],
        collections: ["Test Collection"],
        input_count: 10,
      },
    });

    const names = collectSkinNames([tu]);
    expect(names).toContain("AK-47 | Redline");
    expect(names).toContain("AK-47 | Fire Serpent");
    expect(names.every(name => typeof name === "string" && name.length > 0)).toBe(true);
  });
});
