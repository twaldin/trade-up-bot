import { describe, expect, it } from "vitest";
import { keepListingDisjoint, parseOverlapMode, sharedWithRanks } from "../../server/routes/listing-disjoint.js";

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
