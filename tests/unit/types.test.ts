import { describe, it, expect } from "vitest";
import {
  CONDITION_BOUNDS,
  EXCLUDED_COLLECTIONS,
} from "../../server/engine/types.js";

describe("CONDITION_BOUNDS", () => {
  it("has exactly 5 entries", () => {
    expect(CONDITION_BOUNDS).toHaveLength(5);
  });

  it("ranges cover full [0.0, 1.0] without gaps (max[i] === min[i+1])", () => {
    for (let i = 0; i < CONDITION_BOUNDS.length - 1; i++) {
      expect(CONDITION_BOUNDS[i].max).toBe(CONDITION_BOUNDS[i + 1].min);
    }
  });

  it("no overlapping ranges", () => {
    for (let i = 0; i < CONDITION_BOUNDS.length; i++) {
      for (let j = i + 1; j < CONDITION_BOUNDS.length; j++) {
        const a = CONDITION_BOUNDS[i];
        const b = CONDITION_BOUNDS[j];
        // Two ranges [a.min, a.max) and [b.min, b.max) overlap if a.min < b.max && b.min < a.max
        const overlaps = a.min < b.max && b.min < a.max;
        expect(overlaps).toBe(false);
      }
    }
  });

  it("names are in correct order: FN, MW, FT, WW, BS", () => {
    const names = CONDITION_BOUNDS.map((b) => b.name);
    expect(names).toEqual([
      "Factory New",
      "Minimal Wear",
      "Field-Tested",
      "Well-Worn",
      "Battle-Scarred",
    ]);
  });

  it("each range has min < max", () => {
    for (const bound of CONDITION_BOUNDS) {
      expect(bound.min).toBeLessThan(bound.max);
    }
  });

  it("Factory New starts at 0.0", () => {
    expect(CONDITION_BOUNDS[0].min).toBe(0.0);
  });

  it("Battle-Scarred ends at 1.0", () => {
    expect(CONDITION_BOUNDS[CONDITION_BOUNDS.length - 1].max).toBe(1.0);
  });
});

describe("EXCLUDED_COLLECTIONS", () => {
  it("contains Armory items", () => {
    expect(EXCLUDED_COLLECTIONS.has("collection-set-xpshop-wpn-01")).toBe(true);
  });

  it("does NOT contain Dead Hand (was unblocked)", () => {
    expect(EXCLUDED_COLLECTIONS.has("set_community_34")).toBe(false);
  });
});
