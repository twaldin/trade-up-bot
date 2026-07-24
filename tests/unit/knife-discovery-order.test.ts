/**
 * Iteration 13 — knife-tier E2 analog (value-first ordering).
 *
 * The structured knife pass (findProfitableKnifeTradeUps Step 1) scans
 * `knifeCollections` in DB-insertion order with a `pastDeadline()` break at the
 * top of the loop, and the pass runs ~186s (at/above the structured budget top)
 * — so collections late in the scan get deadline-starved. A full reverse-
 * boundary pass (gun E2) is infeasible here: knife per-condition prices require
 * async lookupOutputPrice, not a sync cache read. The bounded, safe realization
 * of E2's value-first principle is to ORDER the collections by the max output
 * value they can mint, so the highest-value collections are evaluated FIRST and
 * any deadline cut starves only the lowest-value ones.
 */

import { describe, it, expect } from "vitest";
import { orderKnifeCollectionsByValue, knifeCollectionValue } from "../../server/engine/knife-discovery.js";
import type { FinishData } from "../../server/engine/knife-data.js";

const fd = (avgPrice: number): FinishData =>
  ({ name: "x", avgPrice, minPrice: avgPrice * 0.5, maxPrice: avgPrice * 2, conditions: 1, skinMinFloat: 0, skinMaxFloat: 1 });

describe("orderKnifeCollectionsByValue (Iteration 13)", () => {
  it("orders collections by descending mintable value", () => {
    const value = new Map([
      ["cheap", 5000],
      ["premium", 119000],
      ["mid", 30000],
    ]);
    const ordered = orderKnifeCollectionsByValue(
      ["cheap", "premium", "mid"],
      c => value.get(c) ?? 0
    );
    expect(ordered).toEqual(["premium", "mid", "cheap"]);
  });

  it("is deterministic under ties (name tiebreak, insertion-order independent)", () => {
    const value = (_c: string) => 1000; // all equal → tie
    const a = orderKnifeCollectionsByValue(["Bravo", "Arms", "Chroma"], value);
    const b = orderKnifeCollectionsByValue(["Chroma", "Bravo", "Arms"], value);
    expect(a).toEqual(["Arms", "Bravo", "Chroma"]);
    expect(a).toEqual(b);
  });

  it("does not mutate the input array", () => {
    const input = ["cheap", "premium"];
    const value = new Map([["cheap", 1], ["premium", 2]]);
    const ordered = orderKnifeCollectionsByValue(input, c => value.get(c) ?? 0);
    expect(input).toEqual(["cheap", "premium"]); // unchanged
    expect(ordered).toEqual(["premium", "cheap"]);
  });

  it("ranks unknown/zero-value collections last, deterministically", () => {
    const value = new Map([["known", 8000]]);
    const ordered = orderKnifeCollectionsByValue(
      ["zeroB", "known", "zeroA"],
      c => value.get(c) ?? 0
    );
    expect(ordered).toEqual(["known", "zeroA", "zeroB"]);
  });
});

const namedFd = (name: string, avgPrice: number): FinishData =>
  ({ ...fd(avgPrice), name });

describe("knifeCollectionValue (Iteration 13)", () => {
  it("takes the max avgPrice across the collection's mintable knife finishes", () => {
    // "The Arms Deal Collection" → OG5 knives, Original finishes (incl. Fade), no gloves.
    const cache = new Map<string, FinishData[]>([
      ["Bayonet", [namedFd("★ Bayonet | Fade", 20000)]],
      ["Karambit", [namedFd("★ Karambit | Fade", 90000), namedFd("★ Karambit | Slaughter", 30000)]],
    ]);
    expect(knifeCollectionValue("The Arms Deal Collection", cache)).toBe(90000);
  });

  it("EXCLUDES finishes the collection cannot mint (blocker: no cross-finish inheritance)", () => {
    // Original-finish collection must NOT inherit a Chroma "Doppler" Karambit value.
    const cache = new Map<string, FinishData[]>([
      ["Karambit", [
        namedFd("★ Karambit | Doppler", 500000), // Chroma — NOT in KNIFE_FINISHES_ORIGINAL
        namedFd("★ Karambit | Fade", 80000),      // Original — allowed
      ]],
    ]);
    expect(knifeCollectionValue("The Arms Deal Collection", cache)).toBe(80000);
  });

  it("counts a plain (Vanilla) knife when the case allows Vanilla", () => {
    const cache = new Map<string, FinishData[]>([["Karambit", [namedFd("★ Karambit", 42000)]]]);
    expect(knifeCollectionValue("The Arms Deal Collection", cache)).toBe(42000);
  });

  it("returns 0 for an unmapped collection", () => {
    expect(knifeCollectionValue("Not A Real Collection", new Map())).toBe(0);
  });

  it("returns 0 when the collection's item-types are absent from the cache", () => {
    expect(knifeCollectionValue("The Arms Deal Collection", new Map())).toBe(0);
  });
});
