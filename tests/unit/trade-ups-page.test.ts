import { describe, expect, it } from "vitest";
import {
  LIST_INCLUDE_MAX_PER_PAGE,
  RANK_SNAPSHOT_SIZE,
  groupInputRows,
  loadRankSnapshot,
  orderByIds,
  parseListIncludes,
  parseOutcomesJson,
  rankSnapshotKey,
  snapshotCoversPage,
  type InputJoinRow,
  type RankSnapshot,
  type RankSnapshotStore,
} from "../../server/routes/trade-ups-page.js";

function joinRow(overrides: Partial<InputJoinRow> = {}): InputJoinRow {
  return {
    trade_up_id: 1,
    listing_id: "L-1",
    skin_id: "skin-1",
    skin_name: "AK-47 | Redline",
    collection_name: "The Phoenix Collection",
    price_cents: 1234,
    float_value: 0.1523,
    condition: "Field-Tested",
    source: "csfloat",
    marketplace_id: null,
    live_listing_id: "L-1",
    listing_claimed_by: null,
    ...overrides,
  };
}

function memoryStore(): RankSnapshotStore & { data: Map<string, unknown>; sets: number } {
  const data = new Map<string, unknown>();
  const store = {
    data,
    sets: 0,
    async get(key: string) { return data.get(key) ?? null; },
    async set(key: string, value: RankSnapshot) { store.sets++; data.set(key, value); },
    async del(key: string) { data.delete(key); },
  };
  return store;
}

describe("parseListIncludes", () => {
  it("defaults to nothing embedded so existing callers keep the lean payload", () => {
    expect(parseListIncludes(undefined, 12)).toEqual({ outcomes: false, inputs: false });
    expect(parseListIncludes("", 12)).toEqual({ outcomes: false, inputs: false });
  });

  it("reads a comma list and ignores unknown parts", () => {
    expect(parseListIncludes("outcomes,inputs", 12)).toEqual({ outcomes: true, inputs: true });
    expect(parseListIncludes(" inputs , bogus ", 12)).toEqual({ outcomes: false, inputs: true });
  });

  it("refuses to embed on oversized pages", () => {
    expect(parseListIncludes("outcomes,inputs", LIST_INCLUDE_MAX_PER_PAGE)).toEqual({ outcomes: true, inputs: true });
    expect(parseListIncludes("outcomes,inputs", LIST_INCLUDE_MAX_PER_PAGE + 1)).toEqual({ outcomes: false, inputs: false });
  });

  it("ignores repeated query values rather than throwing", () => {
    expect(parseListIncludes(["outcomes", "inputs"], 12)).toEqual({ outcomes: false, inputs: false });
  });
});

describe("groupInputRows", () => {
  it("derives counts the same way the old COUNT FILTER query did", () => {
    const grouped = groupInputRows([
      joinRow({ listing_id: "L-1", live_listing_id: "L-1" }),
      joinRow({ listing_id: "L-2", live_listing_id: null }),
      joinRow({ listing_id: "theor-abc", live_listing_id: null }),
      joinRow({ listing_id: "L-3", live_listing_id: "L-3", listing_claimed_by: "someone" }),
    ]);
    const tu = grouped.get(1);
    expect(tu?.realInputCount).toBe(3);
    expect(tu?.missingCount).toBe(1);
  });

  it("builds the list summary: skins by count desc, collections in first-seen order", () => {
    const grouped = groupInputRows([
      joinRow({ skin_name: "A", collection_name: "C1", condition: "Minimal Wear" }),
      joinRow({ skin_name: "B", collection_name: "C2" }),
      joinRow({ skin_name: "B", collection_name: "C2" }),
      joinRow({ skin_name: "A", collection_name: "C1" }),
      joinRow({ skin_name: "B", collection_name: "C2" }),
    ]);
    expect(grouped.get(1)?.summary).toEqual({
      skins: [
        { name: "B", count: 3, condition: "Field-Tested" },
        { name: "A", count: 2, condition: "Minimal Wear" },
      ],
      collections: ["C1", "C2"],
      input_count: 5,
    });
  });

  it("emits /api/trade-up/:id/inputs-shaped rows with missing and claimed flags", () => {
    const grouped = groupInputRows([
      joinRow({ listing_id: "L-1", live_listing_id: "L-1", marketplace_id: "goods-9" }),
      joinRow({ listing_id: "L-2", live_listing_id: null }),
      joinRow({ listing_id: "L-3", live_listing_id: "L-3", listing_claimed_by: "u2" }),
    ]);
    const inputs = grouped.get(1)?.inputs ?? [];
    expect(inputs[0]).toEqual({
      trade_up_id: 1,
      listing_id: "L-1",
      skin_id: "skin-1",
      skin_name: "AK-47 | Redline",
      collection_name: "The Phoenix Collection",
      price_cents: 1234,
      float_value: 0.1523,
      condition: "Field-Tested",
      source: "csfloat",
      marketplace_id: "goods-9",
    });
    expect(inputs[1].missing).toBe(true);
    expect(inputs[1].claimed_by_other).toBeUndefined();
    expect(inputs[2].claimed_by_other).toBe(true);
    expect(inputs[2].missing).toBeUndefined();
    for (const input of inputs) {
      expect(input).not.toHaveProperty("live_listing_id");
      expect(input).not.toHaveProperty("listing_claimed_by");
    }
  });

  it("keeps trade-ups apart and coerces bigint-ish ids", () => {
    const grouped = groupInputRows([
      joinRow({ trade_up_id: 7 }),
      joinRow({ trade_up_id: 8, listing_id: "L-8" }),
      joinRow({ trade_up_id: 7, listing_id: "L-7" }),
    ]);
    expect([...grouped.keys()].sort()).toEqual([7, 8]);
    expect(grouped.get(7)?.inputs).toHaveLength(2);
    expect(grouped.get(8)?.inputs).toHaveLength(1);
  });
});

describe("parseOutcomesJson", () => {
  it("parses stored outcomes and tolerates null or malformed JSON", () => {
    expect(parseOutcomesJson('[{"skin_name":"X","probability":1}]')).toEqual([{ skin_name: "X", probability: 1 }]);
    expect(parseOutcomesJson(null)).toEqual([]);
    expect(parseOutcomesJson("{not json")).toEqual([]);
    expect(parseOutcomesJson('{"a":1}')).toEqual([]);
  });
});

describe("rank snapshot key", () => {
  const base = { fromWhere: "FROM trade_ups t WHERE x = $1", sortCol: "t.trade_up_score", sortOrder: "DESC", params: ["classified_covert", 20] };

  it("lives under the tu: prefix so every existing invalidation clears it", () => {
    expect(rankSnapshotKey(base).startsWith("tu:rank:")).toBe(true);
  });

  it("is stable for identical queries and distinct for different sort or params", () => {
    expect(rankSnapshotKey(base)).toBe(rankSnapshotKey({ ...base, params: ["classified_covert", 20] }));
    expect(rankSnapshotKey(base)).not.toBe(rankSnapshotKey({ ...base, sortOrder: "ASC" }));
    expect(rankSnapshotKey(base)).not.toBe(rankSnapshotKey({ ...base, sortCol: "t.profit_cents" }));
    expect(rankSnapshotKey(base)).not.toBe(rankSnapshotKey({ ...base, params: ["covert_knife", 20] }));
    expect(rankSnapshotKey(base)).not.toBe(rankSnapshotKey({ ...base, fromWhere: base.fromWhere + " AND y" }));
  });
});

describe("snapshotCoversPage", () => {
  it("only serves pages that fit inside the snapshot window", () => {
    expect(snapshotCoversPage(0, 12)).toBe(true);
    expect(snapshotCoversPage(RANK_SNAPSHOT_SIZE - 12, 12)).toBe(true);
    expect(snapshotCoversPage(RANK_SNAPSHOT_SIZE - 11, 12)).toBe(false);
  });
});

describe("orderByIds", () => {
  it("returns rows in snapshot order", () => {
    const rows = [{ id: 3 }, { id: 1 }, { id: 2 }];
    expect(orderByIds(rows, [2, 3, 1])?.map((r) => r.id)).toEqual([2, 3, 1]);
  });

  it("returns null when any snapshot id no longer resolves", () => {
    expect(orderByIds([{ id: 1 }], [1, 2])).toBeNull();
  });
});

describe("loadRankSnapshot", () => {
  const snapshot: RankSnapshot = { ids: [5, 4, 3], total: 3 };

  it("serves a stored snapshot without recomputing", async () => {
    const store = memoryStore();
    store.data.set("tu:rank:a", snapshot);
    let computed = 0;
    const got = await loadRankSnapshot("tu:rank:a", store, async () => { computed++; return snapshot; });
    expect(got).toEqual(snapshot);
    expect(computed).toBe(0);
  });

  it("computes once on a miss and stores the result", async () => {
    const store = memoryStore();
    let computed = 0;
    const got = await loadRankSnapshot("tu:rank:b", store, async () => { computed++; return snapshot; });
    expect(got).toEqual(snapshot);
    expect(computed).toBe(1);
    expect(store.data.get("tu:rank:b")).toEqual(snapshot);
  });

  it("coalesces concurrent misses into one computation", async () => {
    const store = memoryStore();
    let computed = 0;
    const compute = async () => {
      computed++;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return snapshot;
    };
    const results = await Promise.all([
      loadRankSnapshot("tu:rank:c", store, compute),
      loadRankSnapshot("tu:rank:c", store, compute),
      loadRankSnapshot("tu:rank:c", store, compute),
    ]);
    expect(computed).toBe(1);
    expect(store.sets).toBe(1);
    for (const r of results) expect(r).toEqual(snapshot);
  });

  it("ignores a malformed stored value and recomputes", async () => {
    const store = memoryStore();
    store.data.set("tu:rank:d", { ids: "nope", total: 1 });
    const got = await loadRankSnapshot("tu:rank:d", store, async () => snapshot);
    expect(got).toEqual(snapshot);
  });

  it("does not poison later calls when a computation fails", async () => {
    const store = memoryStore();
    await expect(loadRankSnapshot("tu:rank:e", store, async () => { throw new Error("db down"); })).rejects.toThrow("db down");
    const got = await loadRankSnapshot("tu:rank:e", store, async () => snapshot);
    expect(got).toEqual(snapshot);
  });
});
