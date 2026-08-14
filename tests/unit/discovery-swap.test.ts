/**
 * S20 — deep-rank swap (It15): pure unit tests for swapInputAtRank.
 *
 * S10 swaps the most expensive input (rank 0) of a known-profitable trade-up
 * and S16 the second-most-expensive (rank 1); S16 out-yields S10 5-8x in
 * production. Ranks 2..8 were never mutated by any strategy. swapInputAtRank
 * generalizes the mutation: replace the input at `rank` (inputs sorted
 * most-expensive-first) with a cheaper, unused, same-collection listing drawn
 * from the 20 cheapest alternatives — mirroring the S10/S16 candidate pool.
 */

import { describe, it, expect } from "vitest";
import { swapInputAtRank } from "../../server/engine/discovery.js";
import type { SwapPoolInput } from "../../server/engine/discovery.js";
import { makeListing } from "../helpers/fixtures.js";
import type { ListingWithCollection } from "../../server/engine/types.js";

const COL = "col-A";

/** 10 input listings sorted most-expensive-first: 1000, 900, ..., 100 cents. */
function makeTradeUpListings(): ListingWithCollection[] {
  return Array.from({ length: 10 }, (_, i) =>
    makeListing({
      id: `input-${i}`,
      collection_id: COL,
      price_cents: 1000 - i * 100,
    })
  );
}

function asInputs(listings: ListingWithCollection[]): SwapPoolInput[] {
  return listings.map(l => ({
    listing_id: l.id,
    skin_name: l.skin_name,
    collection_id: l.collection_id,
    price_cents: l.price_cents,
  }));
}

/** Collection map is price-ascending, like loadDiscoveryData's byCollection. */
function buildByCollection(listings: ListingWithCollection[]): Map<string, ListingWithCollection[]> {
  const map = new Map<string, ListingWithCollection[]>();
  for (const l of [...listings].sort((a, b) => a.price_cents - b.price_cents)) {
    const list = map.get(l.collection_id) ?? [];
    list.push(l);
    map.set(l.collection_id, list);
  }
  return map;
}

describe("swapInputAtRank (S20)", () => {
  it("replaces exactly the rank-th input with a cheaper unused same-collection listing", () => {
    const tuListings = makeTradeUpListings();
    const inputs = asInputs(tuListings);
    // rank 2 costs 800; one cheaper alternative at 750
    const alt = makeListing({ id: "alt-0", collection_id: COL, price_cents: 750 });
    const all = [...tuListings, alt];

    const result = swapInputAtRank(inputs, 2, buildByCollection(all), all, () => 0);

    expect(result).not.toBeNull();
    expect(result!).toHaveLength(10);
    const ids = result!.map(l => l.id);
    expect(ids).not.toContain("input-2");
    // all other 9 inputs preserved
    for (let i = 0; i < 10; i++) {
      if (i !== 2) expect(ids).toContain(`input-${i}`);
    }
    const replacement = result!.find(l => !l.id.startsWith("input-"))!;
    expect(replacement.price_cents).toBeLessThan(800);
    expect(replacement.collection_id).toBe(COL);
  });

  it("never picks a listing already used by the trade-up", () => {
    const tuListings = makeTradeUpListings();
    const inputs = asInputs(tuListings);
    // The only listings cheaper than rank 2 (800) are inputs 3..9 themselves.
    const result = swapInputAtRank(inputs, 2, buildByCollection(tuListings), tuListings, () => 0);
    expect(result).toBeNull();
  });

  it("rejects more-expensive alternatives, including when no cheaper candidate exists", () => {
    const tuListings = makeTradeUpListings();
    const inputs = asInputs(tuListings);
    // Only unused non-input alternatives: one MORE expensive than rank 2 (800),
    // one cheaper. The expensive one must never be chosen.
    const expensive = makeListing({ id: "alt-expensive", collection_id: COL, price_cents: 950 });
    const cheap = makeListing({ id: "alt-cheap", collection_id: COL, price_cents: 750 });
    const all = [...tuListings, expensive, cheap];
    const byCol = buildByCollection(all);

    // rng sweep: the replacement is always the cheaper candidate
    for (const r of [0, 0.5, 0.9999]) {
      const result = swapInputAtRank(inputs, 2, byCol, all, () => r);
      expect(result).not.toBeNull();
      const replacement = result!.find(l => l.id.startsWith("alt-"))!;
      expect(replacement.id).toBe("alt-cheap");
      expect(replacement.price_cents).toBeLessThan(800);
    }

    // An unused but MORE expensive candidate alone never qualifies:
    // rank 9 (cheapest input) has no cheaper alternative -> null.
    const allExpensiveOnly = [...tuListings, expensive];
    const resultNone = swapInputAtRank(inputs, 9, buildByCollection(allExpensiveOnly), allExpensiveOnly, () => 0);
    expect(resultNone).toBeNull();
  });

  it("returns null for out-of-range ranks", () => {
    const tuListings = makeTradeUpListings();
    const inputs = asInputs(tuListings);
    const alt = makeListing({ id: "alt-0", collection_id: COL, price_cents: 50 });
    const all = [...tuListings, alt];
    const byCol = buildByCollection(all);
    expect(swapInputAtRank(inputs, -1, byCol, all)).toBeNull();
    expect(swapInputAtRank(inputs, 10, byCol, all)).toBeNull();
  });

  it("returns null when the target has no cheaper alternative", () => {
    const tuListings = makeTradeUpListings();
    const inputs = asInputs(tuListings);
    // rank 9 is the cheapest listing in the collection — nothing cheaper exists
    const result = swapInputAtRank(inputs, 9, buildByCollection(tuListings), tuListings, () => 0);
    expect(result).toBeNull();
  });

  it("draws only from the 20 cheapest alternatives", () => {
    const tuListings = makeTradeUpListings();
    const inputs = asInputs(tuListings);
    // 30 alternatives cheaper than rank 2 (800): 10, 20, ..., 300 cents
    const alts = Array.from({ length: 30 }, (_, i) =>
      makeListing({ id: `alt-${i}`, collection_id: COL, price_cents: 10 + i * 10 })
    );
    const all = [...tuListings, ...alts];
    // rng near 1 picks the last pool slot: index 19 of the 20 cheapest
    const result = swapInputAtRank(inputs, 2, buildByCollection(all), all, () => 0.9999);
    expect(result).not.toBeNull();
    const replacement = result!.find(l => l.id.startsWith("alt-"))!;
    expect(replacement.id).toBe("alt-19");
  });

  it("returns null when a non-swapped input cannot be reconstructed from allListings", () => {
    const tuListings = makeTradeUpListings();
    const inputs = asInputs(tuListings);
    const alt = makeListing({ id: "alt-0", collection_id: COL, price_cents: 750 });
    // input-7 missing from allListings — stale swap-pool row
    const all = [...tuListings.filter(l => l.id !== "input-7"), alt];
    const result = swapInputAtRank(inputs, 2, buildByCollection(all), all, () => 0);
    expect(result).toBeNull();
  });

  it("is deterministic under an injected rng", () => {
    const tuListings = makeTradeUpListings();
    const inputs = asInputs(tuListings);
    const alts = Array.from({ length: 5 }, (_, i) =>
      makeListing({ id: `alt-${i}`, collection_id: COL, price_cents: 100 + i * 50 })
    );
    const all = [...tuListings, ...alts];
    const byCol = buildByCollection(all);
    const a = swapInputAtRank(inputs, 3, byCol, all, () => 0.5);
    const b = swapInputAtRank(inputs, 3, byCol, all, () => 0.5);
    expect(a).not.toBeNull();
    expect(a!.map(l => l.id)).toEqual(b!.map(l => l.id));
  });
});
