import { describe, expect, it } from "vitest";
import {
  collectionSkinTotal,
  countsFromCollectionRow,
  formatCollectionSkinCopy,
  tallyCollectionSkins,
} from "../../src/preview/lib/collection-skins.js";

describe("tallyCollectionSkins", () => {
  it("counts the same set the detail rail shows: weapons plus knife and glove finishes", () => {
    const tally = tallyCollectionSkins([
      { name: "AK-47 | Inheritance", weapon: "AK-47" },
      { name: "M4A1-S | Black Lotus", weapon: "M4A1-S" },
      { name: "★ Kukri Knife | Fade", weapon: "Kukri Knife" },
      { name: "★ Kukri Knife", weapon: "Kukri Knife" },
      { name: "★ Sport Gloves | Hedge Maze", weapon: "Sport Gloves" },
      { name: "★ Hand Wraps | CAUTION!", weapon: "Hand Wraps" },
    ]);
    expect(tally).toEqual({ weapons: 2, knives: 2, gloves: 2, total: 6 });
  });

  it("treats Kilowatt-shaped rows as 17 weapons and 12 knives", () => {
    const skins = [
      ...Array.from({ length: 17 }, (_, i) => ({ name: `Weapon ${i}`, weapon: "AK-47" })),
      ...Array.from({ length: 11 }, (_, i) => ({ name: `★ Kukri Knife | Finish ${i}`, weapon: "Kukri Knife" })),
      { name: "★ Kukri Knife", weapon: "Kukri Knife" },
    ];
    const tally = tallyCollectionSkins(skins);
    expect(tally).toEqual({ weapons: 17, knives: 12, gloves: 0, total: 29 });
  });
});

describe("formatCollectionSkinCopy", () => {
  it("spells the weapon / knife split instead of a weapon-only total", () => {
    expect(formatCollectionSkinCopy({ weapons: 17, knives: 12, gloves: 0 })).toBe("17 weapon skins · 12 knives");
  });

  it("spells gloves the same way", () => {
    expect(formatCollectionSkinCopy({ weapons: 17, knives: 0, gloves: 24 })).toBe("17 weapon skins · 24 gloves");
  });

  it("uses a plain skin count when there is no rare pool", () => {
    expect(formatCollectionSkinCopy({ weapons: 17, knives: 0, gloves: 0 })).toBe("17 skins");
    expect(formatCollectionSkinCopy({ weapons: 1, knives: 0, gloves: 0 })).toBe("1 skin");
  });

  it("does not invent a knife count before skin-data arrives", () => {
    expect(formatCollectionSkinCopy({ weapons: 17, knives: null, gloves: 0 })).toBe("17 weapon skins · knives");
    expect(formatCollectionSkinCopy({ weapons: 17, knives: 0, gloves: null })).toBe("17 weapon skins · gloves");
  });

  it("singularizes one knife or glove", () => {
    expect(formatCollectionSkinCopy({ weapons: 17, knives: 1, gloves: 0 })).toBe("17 weapon skins · 1 knife");
    expect(formatCollectionSkinCopy({ weapons: 17, knives: 0, gloves: 1 })).toBe("17 weapon skins · 1 glove");
  });
});

describe("countsFromCollectionRow", () => {
  it("uses a loaded tally when the index has the same skin-data as detail", () => {
    const counts = countsFromCollectionRow(
      { skin_count: 17, has_knives: true, has_gloves: false },
      { weapons: 17, knives: 12, gloves: 0, total: 29 },
    );
    expect(formatCollectionSkinCopy(counts)).toBe("17 weapon skins · 12 knives");
    expect(collectionSkinTotal(counts)).toBe(29);
  });

  it("does not publish the weapon-only index total as N skins when knives exist", () => {
    const counts = countsFromCollectionRow(
      { skin_count: 17, has_knives: true, has_gloves: false },
      null,
    );
    expect(formatCollectionSkinCopy(counts)).toBe("17 weapon skins · knives");
    expect(collectionSkinTotal(counts)).toBe(17);
  });
});
