/**
 * E2 — reverse output-targeting: target enumeration (pure unit).
 *
 * enumerateBoundaryTargets ranks (collection, output-skin, condition-boundary)
 * triples by the price cliff of landing just under the boundary, and converts
 * each to an adjusted-float target using the same convention as
 * getConditionTransitions: t = (boundary - min_float)/range - 0.002, 4dp,
 * valid iff 0.001 < t <= 1.0.
 */

import { describe, it, expect } from "vitest";
import { enumerateBoundaryTargets, E2_MAX_TARGETS } from "../../server/engine/discovery.js";
import { makeOutcome } from "../helpers/fixtures.js";
import type { DbSkinOutcome } from "../../server/engine/types.js";

// CONDITION_BOUNDS boundaries: FN max 0.07, MW max 0.15, FT max 0.38, WW max 0.45
const priceTable = new Map<string, number>();
const priceOf = (name: string, cond: string) => priceTable.get(`${name}:${cond}`) ?? 0;

function byCol(...entries: [string, DbSkinOutcome[]][]) {
  return new Map(entries);
}

describe("enumerateBoundaryTargets (E2)", () => {
  it("ranks targets by boundary price jump, descending", () => {
    priceTable.clear();
    // Skin A: FN/MW jump of $100
    priceTable.set("A:Factory New", 20000);
    priceTable.set("A:Minimal Wear", 10000);
    // Skin B: FN/MW jump of $10
    priceTable.set("B:Factory New", 2000);
    priceTable.set("B:Minimal Wear", 1000);

    const targets = enumerateBoundaryTargets(
      byCol(
        ["col-1", [makeOutcome({ name: "A", min_float: 0.0, max_float: 0.8, collection_id: "col-1" })]],
        ["col-2", [makeOutcome({ name: "B", min_float: 0.0, max_float: 0.8, collection_id: "col-2" })]],
      ),
      priceOf
    );

    expect(targets.length).toBeGreaterThanOrEqual(2);
    expect(targets[0].skinName).toBe("A");
    expect(targets[0].valueJumpCents).toBe(10000);
    const idxB = targets.findIndex(t => t.skinName === "B");
    expect(idxB).toBeGreaterThan(0);
  });

  it("computes adjTarget with the getConditionTransitions convention", () => {
    priceTable.clear();
    priceTable.set("A:Factory New", 20000);
    priceTable.set("A:Minimal Wear", 10000);

    const targets = enumerateBoundaryTargets(
      byCol(["col-1", [makeOutcome({ name: "A", min_float: 0.06, max_float: 0.56, collection_id: "col-1" })]]),
      priceOf
    );

    // FN boundary 0.07: t = (0.07 - 0.06) / 0.5 - 0.002 = 0.018
    const fn = targets.find(t => t.boundary === 0.07);
    expect(fn).toBeDefined();
    expect(fn!.adjTarget).toBeCloseTo(0.018, 4);
    expect(fn!.collectionId).toBe("col-1");
  });

  it("skips boundaries with no positive price jump and invalid adjusted targets", () => {
    priceTable.clear();
    // No jump: FN == MW price
    priceTable.set("A:Factory New", 5000);
    priceTable.set("A:Minimal Wear", 5000);
    // Valid jump but boundary below the skin's min float (adjTarget <= 0.001)
    priceTable.set("B:Factory New", 9000);
    priceTable.set("B:Minimal Wear", 1000);

    const targets = enumerateBoundaryTargets(
      byCol(
        ["col-1", [makeOutcome({ name: "A", min_float: 0.0, max_float: 0.8, collection_id: "col-1" })]],
        ["col-2", [makeOutcome({ name: "B", min_float: 0.07, max_float: 0.8, collection_id: "col-2" })]],
      ),
      priceOf
    );

    expect(targets.every(t => !(t.skinName === "A" && t.boundary === 0.07))).toBe(true);
    // B's FN boundary (0.07) equals its min float -> adjTarget would be -0.002 -> skipped
    expect(targets.every(t => !(t.skinName === "B" && t.boundary === 0.07))).toBe(true);
  });

  it("caps the result at k and is deterministic under ties", () => {
    priceTable.clear();
    const cols: [string, DbSkinOutcome[]][] = [];
    for (let i = 0; i < 30; i++) {
      const name = `S${String(i).padStart(2, "0")}`;
      priceTable.set(`${name}:Factory New`, 5000); // identical jumps -> tie
      priceTable.set(`${name}:Minimal Wear`, 1000);
      cols.push([`col-${i}`, [makeOutcome({ name, min_float: 0.0, max_float: 0.8, collection_id: `col-${i}` })]]);
    }

    const a = enumerateBoundaryTargets(byCol(...cols), priceOf, 5);
    const b = enumerateBoundaryTargets(byCol(...cols.slice().reverse()), priceOf, 5);

    expect(a).toHaveLength(5);
    expect(a).toEqual(b); // insertion-order independent (deterministic tiebreak)
  });

  it("defaults k to E2_MAX_TARGETS", () => {
    priceTable.clear();
    const cols: [string, DbSkinOutcome[]][] = [];
    for (let i = 0; i < 60; i++) {
      const name = `S${i}`;
      priceTable.set(`${name}:Factory New`, 1000 + i);
      priceTable.set(`${name}:Minimal Wear`, 100);
      cols.push([`col-${i}`, [makeOutcome({ name, min_float: 0.0, max_float: 0.8, collection_id: `col-${i}` })]]);
    }
    const targets = enumerateBoundaryTargets(byCol(...cols), priceOf);
    expect(targets).toHaveLength(E2_MAX_TARGETS);
  });
});
