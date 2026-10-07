import { describe, expect, it } from "vitest";
import { buildDisjointSnapshot, keepListingDisjoint, parseOverlapMode, sharedWithRanks } from "../../server/routes/listing-disjoint.js";
import { orderPresentByIds } from "../../server/routes/trade-ups-page.js";

const L = (entries: Array<[number, string[]]>) => new Map(entries);

describe("keepListingDisjoint", () => {
  it("drops a row that reuses a kept row's listing and keeps order", () => {
    const by = L([[10, ["a", "b"]], [9, ["b", "c"]], [8, ["d"]], [7, ["c", "e"]]]);
    // 9 shares b with 10 -> dropped. 7 shares c only with dropped 9 -> kept (greedy vs kept rows).
    expect(keepListingDisjoint([10, 9, 8, 7], by, 100)).toEqual([10, 8, 7]);
  });

  it("stops at the limit", () => {
    const by = L([[1, ["a"]], [2, ["b"]], [3, ["c"]]]);
    expect(keepListingDisjoint([1, 2, 3], by, 2)).toEqual([1, 2]);
  });

  it("keeps rows with no known inputs", () => {
    expect(keepListingDisjoint([1, 2], new Map(), 10)).toEqual([1, 2]);
  });

  it("top-50 shape from prod: one core plus variants collapses to one row", () => {
    const core = ["x1", "x2", "x3", "x4", "x5", "x6", "x7", "x8", "x9"];
    const ids = Array.from({ length: 50 }, (_, i) => i + 1);
    const by = L(ids.map((id) => [id, [...core, `v${id}`]]));
    expect(keepListingDisjoint(ids, by, 1000)).toEqual([1]);
  });
});

describe("sharedWithRanks", () => {
  it("reports the highest earlier rank sharing any listing", () => {
    const by = L([[10, ["a"]], [9, ["b"]], [8, ["b", "a"]], [7, ["z"]]]);
    expect(sharedWithRanks([10, 9, 8, 7], by)).toEqual([null, null, 1, null]);
  });
});

describe("parseOverlapMode", () => {
  it("defaults to disjoint; only 'all' opts out", () => {
    expect(parseOverlapMode(undefined)).toBe("disjoint");
    expect(parseOverlapMode("ALL")).toBe("disjoint");
    expect(parseOverlapMode("all")).toBe("all");
  });
});

describe("buildDisjointSnapshot", () => {
  const ranked = (n: number, profit = (i: number) => (i % 2 === 0 ? 100 : -100)) =>
    Array.from({ length: n }, (_, i) => ({ id: i + 1, profitCents: profit(i) }));
  const unique = (n: number) => new Map(Array.from({ length: n }, (_, i) => [i + 1, [`l${i + 1}`]] as [number, string[]]));

  it("counts total and profitable over the kept list only", () => {
    const by = new Map<number, string[]>([[1, ["a"]], [2, ["a"]], [3, ["b"]], [4, ["c"]]]);
    // profit: 1:+ 2:- 3:+ 4:-  -> kept 1,3,4 -> profitable 2 (row 2 dropped)
    const snap = buildDisjointSnapshot({ ranked: ranked(4), listingsById: by, limit: 10, candidateLimit: 50, rawTotal: 4 });
    expect(snap).toMatchObject({ ids: [1, 3, 4], total: 3, profitable: 2, deduped: true, rawTotal: 4, hasMore: false });
  });

  it("flags hasMore when the row cap is hit with candidates left", () => {
    const snap = buildDisjointSnapshot({ ranked: ranked(10), listingsById: unique(10), limit: 5, candidateLimit: 50, rawTotal: 10 });
    expect(snap.total).toBe(5);
    expect(snap.hasMore).toBe(true);
  });

  it("does not flag hasMore when the cap is hit exactly at the end", () => {
    const snap = buildDisjointSnapshot({ ranked: ranked(5), listingsById: unique(5), limit: 5, candidateLimit: 50, rawTotal: 5 });
    expect(snap.hasMore).toBe(false);
  });

  it("flags hasMore (lower bound) when the candidate window is exhausted with raw rows left", () => {
    // 20 candidates all share one listing -> 1 kept, but 500 raw rows exist past the window.
    const by = new Map(Array.from({ length: 20 }, (_, i) => [i + 1, ["shared"]] as [number, string[]]));
    const snap = buildDisjointSnapshot({ ranked: ranked(20), listingsById: by, limit: 5, candidateLimit: 20, rawTotal: 500 });
    expect(snap.total).toBe(1);
    expect(snap.rawTotal).toBe(500);
    expect(snap.hasMore).toBe(true);
  });
});

describe("orderPresentByIds", () => {
  it("keeps snapshot order and skips ids that no longer resolve", () => {
    const rows = [{ id: 3 }, { id: 1 }];
    expect(orderPresentByIds(rows, [1, 2, 3]).map((r) => r.id)).toEqual([1, 3]);
  });
});
