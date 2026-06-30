import { describe, it, expect } from "vitest";
import { topKByValue, STEP3_SPLITS, STEP3_TOP_K } from "../../server/engine/discovery.js";

// E4 — bounded 3-collection discovery. These guard the combinatorial BOUND
// (top-K anchoring + a fixed split set) that keeps the 3-collection step from
// blowing up as N^3. The bound is the safety-critical part of E4.

describe("STEP3_SPLITS", () => {
  it("every split sums to 10 with each part >= 1", () => {
    expect(STEP3_SPLITS.length).toBeGreaterThan(0);
    for (const [a, b, c] of STEP3_SPLITS) {
      expect(a + b + c).toBe(10);
      expect(a).toBeGreaterThanOrEqual(1);
      expect(b).toBeGreaterThanOrEqual(1);
      expect(c).toBeGreaterThanOrEqual(1);
    }
  });

  it("contains no duplicate splits", () => {
    const seen = new Set(STEP3_SPLITS.map(([a, b, c]) => `${a},${b},${c}`));
    expect(seen.size).toBe(STEP3_SPLITS.length);
  });

  it("is a bounded set (far fewer than all 36 compositions)", () => {
    expect(STEP3_SPLITS.length).toBeLessThanOrEqual(12);
  });
});

describe("STEP3_TOP_K", () => {
  it("is a small positive anchor count keeping C(K,3) tractable", () => {
    expect(STEP3_TOP_K).toBeGreaterThan(0);
    expect(STEP3_TOP_K).toBeLessThanOrEqual(12);
  });
});

describe("topKByValue", () => {
  const valueOf = (id: string) => ({ a: 30, b: 10, c: 50, d: 20, e: 40 }[id] ?? 0);

  it("returns the k highest-value ids, value-descending", () => {
    expect(topKByValue(["a", "b", "c", "d", "e"], valueOf, 3)).toEqual(["c", "e", "a"]);
  });

  it("k >= length returns all ids sorted by value", () => {
    expect(topKByValue(["a", "b", "c"], valueOf, 10)).toEqual(["c", "a", "b"]);
  });

  it("k <= 0 returns empty", () => {
    expect(topKByValue(["a", "b", "c"], valueOf, 0)).toEqual([]);
    expect(topKByValue(["a", "b", "c"], valueOf, -1)).toEqual([]);
  });

  it("breaks value ties deterministically by id (ascending)", () => {
    const flat = () => 5;
    expect(topKByValue(["x", "a", "m"], flat, 2)).toEqual(["a", "m"]);
  });

  it("does not mutate the input array", () => {
    const ids = ["a", "b", "c"];
    topKByValue(ids, valueOf, 2);
    expect(ids).toEqual(["a", "b", "c"]);
  });
});
