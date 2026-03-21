import { describe, it, expect } from "vitest";
import {
  CASE_KNIFE_MAP,
  KNIFE_WEAPONS,
  KNIFE_FINISHES_ORIGINAL,
  KNIFE_FINISHES_CHROMA,
  KNIFE_FINISHES_GAMMA,
  GLOVE_GEN_SKINS,
  DOPPLER_PHASES,
  OG5,
  SEC5,
  HOR4,
  SW4,
} from "../../server/engine/knife-data.js";

// ─── KNIFE_WEAPONS ──────────────────────────────────────────────────────────

describe("KNIFE_WEAPONS", () => {
  it("contains exactly 20 knife types", () => {
    expect(KNIFE_WEAPONS).toHaveLength(20);
  });

  it("includes all well-known knife types", () => {
    const expected = [
      "Bayonet", "Karambit", "Butterfly Knife", "Flip Knife", "Gut Knife",
      "M9 Bayonet", "Huntsman Knife", "Falchion Knife", "Shadow Daggers",
      "Bowie Knife", "Navaja Knife", "Stiletto Knife", "Ursus Knife",
      "Talon Knife", "Classic Knife", "Paracord Knife", "Survival Knife",
      "Nomad Knife", "Skeleton Knife", "Kukri Knife",
    ];
    for (const knife of expected) {
      expect(KNIFE_WEAPONS).toContain(knife);
    }
  });

  it("has no duplicate entries", () => {
    const unique = new Set(KNIFE_WEAPONS);
    expect(unique.size).toBe(KNIFE_WEAPONS.length);
  });
});

// ─── Knife type groups ──────────────────────────────────────────────────────

describe("knife type groups", () => {
  it("OG5 has exactly 5 knives", () => {
    expect(OG5).toHaveLength(5);
    expect(OG5).toContain("Bayonet");
    expect(OG5).toContain("Karambit");
  });

  it("SEC5 has exactly 5 knives", () => {
    expect(SEC5).toHaveLength(5);
    expect(SEC5).toContain("Butterfly Knife");
    expect(SEC5).toContain("Bowie Knife");
  });

  it("HOR4 has exactly 4 knives", () => {
    expect(HOR4).toHaveLength(4);
    expect(HOR4).toContain("Navaja Knife");
    expect(HOR4).toContain("Talon Knife");
  });

  it("SW4 has exactly 4 knives", () => {
    expect(SW4).toHaveLength(4);
    expect(SW4).toContain("Nomad Knife");
    expect(SW4).toContain("Skeleton Knife");
  });

  it("all group members are in KNIFE_WEAPONS", () => {
    for (const knife of [...OG5, ...SEC5, ...HOR4, ...SW4]) {
      expect(KNIFE_WEAPONS).toContain(knife);
    }
  });
});

// ─── Finish sets ────────────────────────────────────────────────────────────

describe("KNIFE_FINISHES_ORIGINAL", () => {
  it("is non-empty", () => {
    expect(KNIFE_FINISHES_ORIGINAL.length).toBeGreaterThan(0);
  });

  it("has no duplicate finishes", () => {
    const unique = new Set(KNIFE_FINISHES_ORIGINAL);
    expect(unique.size).toBe(KNIFE_FINISHES_ORIGINAL.length);
  });

  it("includes well-known original finishes", () => {
    expect(KNIFE_FINISHES_ORIGINAL).toContain("Fade");
    expect(KNIFE_FINISHES_ORIGINAL).toContain("Crimson Web");
    expect(KNIFE_FINISHES_ORIGINAL).toContain("Vanilla");
  });
});

describe("KNIFE_FINISHES_CHROMA", () => {
  it("is non-empty", () => {
    expect(KNIFE_FINISHES_CHROMA.length).toBeGreaterThan(0);
  });

  it("has no duplicate finishes", () => {
    const unique = new Set(KNIFE_FINISHES_CHROMA);
    expect(unique.size).toBe(KNIFE_FINISHES_CHROMA.length);
  });

  it("includes Doppler and Marble Fade", () => {
    expect(KNIFE_FINISHES_CHROMA).toContain("Doppler");
    expect(KNIFE_FINISHES_CHROMA).toContain("Marble Fade");
  });
});

describe("KNIFE_FINISHES_GAMMA", () => {
  it("is non-empty", () => {
    expect(KNIFE_FINISHES_GAMMA.length).toBeGreaterThan(0);
  });

  it("has no duplicate finishes", () => {
    const unique = new Set(KNIFE_FINISHES_GAMMA);
    expect(unique.size).toBe(KNIFE_FINISHES_GAMMA.length);
  });

  it("includes Gamma Doppler and Lore", () => {
    expect(KNIFE_FINISHES_GAMMA).toContain("Gamma Doppler");
    expect(KNIFE_FINISHES_GAMMA).toContain("Lore");
  });
});

describe("finish sets are disjoint", () => {
  it("original and chroma share no finishes", () => {
    const overlap = KNIFE_FINISHES_ORIGINAL.filter((f) =>
      KNIFE_FINISHES_CHROMA.includes(f),
    );
    expect(overlap).toEqual([]);
  });

  it("original and gamma share no finishes", () => {
    const overlap = KNIFE_FINISHES_ORIGINAL.filter((f) =>
      KNIFE_FINISHES_GAMMA.includes(f),
    );
    expect(overlap).toEqual([]);
  });

  it("chroma and gamma share no finishes", () => {
    const overlap = KNIFE_FINISHES_CHROMA.filter((f) =>
      KNIFE_FINISHES_GAMMA.includes(f),
    );
    expect(overlap).toEqual([]);
  });
});

// ─── CASE_KNIFE_MAP ─────────────────────────────────────────────────────────

describe("CASE_KNIFE_MAP", () => {
  it("has entries for major cases", () => {
    expect(CASE_KNIFE_MAP).toHaveProperty("The Bravo Collection");
    expect(CASE_KNIFE_MAP).toHaveProperty("The Breakout Collection");
    expect(CASE_KNIFE_MAP).toHaveProperty("The Chroma Collection");
    expect(CASE_KNIFE_MAP).toHaveProperty("The Gamma Collection");
    expect(CASE_KNIFE_MAP).toHaveProperty("The Glove Collection");
    expect(CASE_KNIFE_MAP).toHaveProperty("The Kilowatt Collection");
  });

  it("every entry has knifeTypes OR gloveGen defined (not both empty)", () => {
    for (const [name, mapping] of Object.entries(CASE_KNIFE_MAP)) {
      const hasKnives = mapping.knifeTypes.length > 0;
      const hasGloves = mapping.gloveGen !== null;
      expect(
        hasKnives || hasGloves,
        `${name} has neither knifeTypes nor gloveGen`,
      ).toBe(true);
    }
  });

  it("knife-only cases have gloveGen === null", () => {
    const knifeCases = Object.entries(CASE_KNIFE_MAP).filter(
      ([, m]) => m.knifeTypes.length > 0,
    );
    for (const [name, mapping] of knifeCases) {
      expect(mapping.gloveGen, `${name} has both knives and gloves`).toBeNull();
    }
  });

  it("glove-only cases have empty knifeTypes and knifeFinishes", () => {
    const gloveCases = Object.entries(CASE_KNIFE_MAP).filter(
      ([, m]) => m.gloveGen !== null,
    );
    for (const [name, mapping] of gloveCases) {
      expect(mapping.knifeTypes, `${name} should have empty knifeTypes`).toEqual([]);
      expect(mapping.knifeFinishes, `${name} should have empty knifeFinishes`).toEqual([]);
    }
  });

  it("all knifeTypes reference valid KNIFE_WEAPONS entries", () => {
    const kniveSet = new Set<string>(KNIFE_WEAPONS);
    for (const [name, mapping] of Object.entries(CASE_KNIFE_MAP)) {
      for (const kt of mapping.knifeTypes) {
        expect(kniveSet.has(kt), `${name} has unknown knife type: ${kt}`).toBe(true);
      }
    }
  });

  it("knife cases use finishes from one of the three finish sets", () => {
    const allFinishes = new Set([
      ...KNIFE_FINISHES_ORIGINAL,
      ...KNIFE_FINISHES_CHROMA,
      ...KNIFE_FINISHES_GAMMA,
    ]);
    for (const [name, mapping] of Object.entries(CASE_KNIFE_MAP)) {
      for (const finish of mapping.knifeFinishes) {
        expect(allFinishes.has(finish), `${name} has unknown finish: ${finish}`).toBe(true);
      }
    }
  });
});

// ─── GLOVE_GEN_SKINS ────────────────────────────────────────────────────────

describe("GLOVE_GEN_SKINS", () => {
  it("has gen 1, 2, 3, and 4 keys", () => {
    expect(Object.keys(GLOVE_GEN_SKINS).map(Number).sort()).toEqual([1, 2, 3, 4]);
  });

  it("each generation has at least one glove type", () => {
    for (const gen of [1, 2, 3, 4]) {
      const gloveTypes = Object.keys(GLOVE_GEN_SKINS[gen]);
      expect(gloveTypes.length, `Gen ${gen} has no glove types`).toBeGreaterThan(0);
    }
  });

  it("each glove type has at least one finish", () => {
    for (const [gen, types] of Object.entries(GLOVE_GEN_SKINS)) {
      for (const [gloveType, finishes] of Object.entries(types)) {
        expect(
          finishes.length,
          `Gen ${gen} ${gloveType} has no finishes`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("gen 1 contains the classic Bloodhound Gloves", () => {
    expect(GLOVE_GEN_SKINS[1]).toHaveProperty("Bloodhound Gloves");
  });

  it("gen 2 contains Hydra Gloves", () => {
    expect(GLOVE_GEN_SKINS[2]).toHaveProperty("Hydra Gloves");
  });

  it("gen 3 contains Broken Fang Gloves", () => {
    expect(GLOVE_GEN_SKINS[3]).toHaveProperty("Broken Fang Gloves");
  });
});

// ─── DOPPLER_PHASES ─────────────────────────────────────────────────────────

describe("DOPPLER_PHASES", () => {
  it("has entries for Doppler and Gamma Doppler", () => {
    expect(DOPPLER_PHASES).toHaveProperty("Doppler");
    expect(DOPPLER_PHASES).toHaveProperty("Gamma Doppler");
  });

  it("Doppler weights sum to ~1.0", () => {
    const total = DOPPLER_PHASES["Doppler"].reduce((s, p) => s + p.weight, 0);
    expect(total).toBeCloseTo(1.0, 2);
  });

  it("Gamma Doppler weights sum to ~1.0", () => {
    const total = DOPPLER_PHASES["Gamma Doppler"].reduce((s, p) => s + p.weight, 0);
    expect(total).toBeCloseTo(1.0, 2);
  });

  it("Doppler includes Ruby, Sapphire, and Black Pearl as rare phases", () => {
    const phases = DOPPLER_PHASES["Doppler"].map((p) => p.phase);
    expect(phases).toContain("Ruby");
    expect(phases).toContain("Sapphire");
    expect(phases).toContain("Black Pearl");
  });

  it("Gamma Doppler includes Emerald as rare phase", () => {
    const phases = DOPPLER_PHASES["Gamma Doppler"].map((p) => p.phase);
    expect(phases).toContain("Emerald");
  });

  it("all weights are positive", () => {
    for (const [type, phases] of Object.entries(DOPPLER_PHASES)) {
      for (const p of phases) {
        expect(p.weight, `${type} ${p.phase} has non-positive weight`).toBeGreaterThan(0);
      }
    }
  });

  it("rare phases have lower weight than standard phases", () => {
    const doppler = DOPPLER_PHASES["Doppler"];
    const standard = doppler.filter((p) => p.phase.startsWith("Phase"));
    const rare = doppler.filter((p) => !p.phase.startsWith("Phase"));
    const maxRareWeight = Math.max(...rare.map((p) => p.weight));
    const minStandardWeight = Math.min(...standard.map((p) => p.weight));
    expect(maxRareWeight).toBeLessThan(minStandardWeight);
  });
});
