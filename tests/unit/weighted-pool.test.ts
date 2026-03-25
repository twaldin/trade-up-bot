/**
 * Tests for buildWeightedPool — verifies profit-weighted collection selection
 * resolves collection IDs to names via the byCollection map.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import pg from "pg";
import { makeListing } from "../helpers/fixtures.js";
import type { ListingWithCollection } from "../../server/engine/types.js";

// We import the real function — the only thing mocked is pool.query
import { buildWeightedPool } from "../../server/engine/data-load.js";

function makePool(queryFn: pg.Pool["query"]): pg.Pool {
  return { query: queryFn } as pg.Pool;
}

describe("buildWeightedPool", () => {
  it("resolves collection IDs to names when byCollection is provided", async () => {
    // DB returns profit data keyed by collection_name
    const queryFn = vi.fn().mockResolvedValue({
      rows: [
        { collection_name: "Fracture Collection", cnt: "25" },
        { collection_name: "Recoil Collection", cnt: "4" },
      ],
    });
    const pool = makePool(queryFn);

    // eligibleCollections are collection_ids (gun discovery)
    const eligibleCollections = ["col-fracture", "col-recoil", "col-empty"];

    // byCollection maps collection_id → listings (each listing has collection_name)
    const byCollection = new Map<string, ListingWithCollection[]>([
      ["col-fracture", [makeListing({ collection_id: "col-fracture", collection_name: "Fracture Collection" })]],
      ["col-recoil", [makeListing({ collection_id: "col-recoil", collection_name: "Recoil Collection" })]],
      ["col-empty", [makeListing({ collection_id: "col-empty", collection_name: "Empty Collection" })]],
    ]);

    const result = await buildWeightedPool(pool, eligibleCollections, "classified_covert", byCollection);

    // Fracture: sqrt(25) = 5, capped at 10 → 5 entries
    const fractureCount = result.filter(c => c === "col-fracture").length;
    // Recoil: sqrt(4) = 2 → 2 entries
    const recoilCount = result.filter(c => c === "col-recoil").length;
    // Empty: no profit history → weight 0, max(1, 0) = 1, sqrt(1) = 1 → 1 entry
    const emptyCount = result.filter(c => c === "col-empty").length;

    expect(fractureCount).toBe(5);
    expect(recoilCount).toBe(2);
    expect(emptyCount).toBe(1);
  });

  it("falls back to direct name lookup when byCollection is not provided (knife path)", async () => {
    // Knife discovery passes collection_name directly as eligibleCollections
    const queryFn = vi.fn().mockResolvedValue({
      rows: [
        { collection_name: "Fracture Collection", cnt: "16" },
      ],
    });
    const pool = makePool(queryFn);

    const eligibleCollections = ["Fracture Collection", "Recoil Collection"];

    // No byCollection — knife path
    const result = await buildWeightedPool(pool, eligibleCollections, "covert_knife");

    // Fracture: sqrt(16) = 4 → 4 entries
    const fractureCount = result.filter(c => c === "Fracture Collection").length;
    // Recoil: no history → weight 1 → 1 entry
    const recoilCount = result.filter(c => c === "Recoil Collection").length;

    expect(fractureCount).toBe(4);
    expect(recoilCount).toBe(1);
  });

  it("without byCollection, collection IDs never match profit names (pre-fix behavior)", async () => {
    // This test documents the bug: without the fix, IDs don't match names
    const queryFn = vi.fn().mockResolvedValue({
      rows: [
        { collection_name: "Fracture Collection", cnt: "100" },
      ],
    });
    const pool = makePool(queryFn);

    // Gun discovery passes IDs, but byCollection resolves them
    const eligibleCollections = ["col-fracture", "col-other"];

    const byCollection = new Map<string, ListingWithCollection[]>([
      ["col-fracture", [makeListing({ collection_id: "col-fracture", collection_name: "Fracture Collection" })]],
      ["col-other", [makeListing({ collection_id: "col-other", collection_name: "Other Collection" })]],
    ]);

    const result = await buildWeightedPool(pool, eligibleCollections, "classified_covert", byCollection);

    // With byCollection, col-fracture resolves to "Fracture Collection" which has cnt=100
    // sqrt(100) = 10, capped at 10 → 10 entries
    const fractureCount = result.filter(c => c === "col-fracture").length;
    expect(fractureCount).toBe(10);

    // col-other resolves to "Other Collection" — no profit data → 1 entry
    const otherCount = result.filter(c => c === "col-other").length;
    expect(otherCount).toBe(1);
  });

  it("caps weight at 10 entries per collection", async () => {
    const queryFn = vi.fn().mockResolvedValue({
      rows: [
        { collection_name: "Big Collection", cnt: "10000" },
      ],
    });
    const pool = makePool(queryFn);

    const byCollection = new Map<string, ListingWithCollection[]>([
      ["col-big", [makeListing({ collection_id: "col-big", collection_name: "Big Collection" })]],
    ]);

    const result = await buildWeightedPool(pool, ["col-big"], "classified_covert", byCollection);

    // sqrt(10000) = 100, capped at 10
    expect(result.filter(c => c === "col-big").length).toBe(10);
  });
});
