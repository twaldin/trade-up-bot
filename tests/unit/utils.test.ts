import { describe, it, expect } from "vitest";
import {
  listingSig,
  parseSig,
  computeChanceToProfit,
  computeBestWorstCase,
  withRetry,
  pickWeightedStrategy,
  shuffle,
  pick,
} from "../../server/engine/utils.js";
import { withSeededRandom } from "../helpers/deterministic.js";

// ─── listingSig ──────────────────────────────────────────────────────────────

describe("listingSig", () => {
  it("sorts and joins IDs", () => {
    expect(listingSig(["c", "a", "b"])).toBe("a,b,c");
  });

  it("single ID returns that ID", () => {
    expect(listingSig(["only"])).toBe("only");
  });

  it("already-sorted IDs unchanged", () => {
    expect(listingSig(["a", "b", "c"])).toBe("a,b,c");
  });

  it("empty array returns empty string", () => {
    expect(listingSig([])).toBe("");
  });

  it("does not mutate original array", () => {
    const ids = ["c", "a", "b"];
    listingSig(ids);
    expect(ids).toEqual(["c", "a", "b"]);
  });
});

// ─── parseSig ────────────────────────────────────────────────────────────────

describe("parseSig", () => {
  it("parses and re-sorts CSV IDs", () => {
    expect(parseSig("c,a,b")).toBe("a,b,c");
  });

  it("already-sorted CSV unchanged", () => {
    expect(parseSig("a,b,c")).toBe("a,b,c");
  });

  it("single ID", () => {
    expect(parseSig("x")).toBe("x");
  });

  it("roundtrips with listingSig", () => {
    const ids = ["z", "m", "a"];
    const sig = listingSig(ids);
    expect(parseSig(sig)).toBe(sig);
  });
});

// ─── computeChanceToProfit ───────────────────────────────────────────────────

describe("computeChanceToProfit", () => {
  it("all outcomes profitable → 1.0", () => {
    const outcomes = [
      { estimated_price_cents: 5000, probability: 0.6 },
      { estimated_price_cents: 8000, probability: 0.4 },
    ];
    expect(computeChanceToProfit(outcomes, 3000)).toBe(1.0);
  });

  it("no outcomes profitable → 0", () => {
    const outcomes = [
      { estimated_price_cents: 1000, probability: 0.5 },
      { estimated_price_cents: 2000, probability: 0.5 },
    ];
    expect(computeChanceToProfit(outcomes, 5000)).toBe(0);
  });

  it("partial profitability → sum of profitable probabilities", () => {
    const outcomes = [
      { estimated_price_cents: 8000, probability: 0.3 },
      { estimated_price_cents: 2000, probability: 0.7 },
    ];
    expect(computeChanceToProfit(outcomes, 5000)).toBeCloseTo(0.3, 10);
  });

  it("outcome price exactly equal to cost → not profitable (strict >)", () => {
    const outcomes = [{ estimated_price_cents: 5000, probability: 1.0 }];
    expect(computeChanceToProfit(outcomes, 5000)).toBe(0);
  });

  it("empty outcomes → 0", () => {
    expect(computeChanceToProfit([], 5000)).toBe(0);
  });
});

// ─── computeBestWorstCase ────────────────────────────────────────────────────

describe("computeBestWorstCase", () => {
  it("returns best and worst deltas from cost", () => {
    const outcomes = [
      { estimated_price_cents: 10000 },
      { estimated_price_cents: 3000 },
      { estimated_price_cents: 7000 },
    ];
    const { bestCase, worstCase } = computeBestWorstCase(outcomes, 5000);
    expect(bestCase).toBe(5000);   // 10000 - 5000
    expect(worstCase).toBe(-2000); // 3000 - 5000
  });

  it("all profitable → worst case still positive", () => {
    const outcomes = [
      { estimated_price_cents: 8000 },
      { estimated_price_cents: 6000 },
    ];
    const { bestCase, worstCase } = computeBestWorstCase(outcomes, 5000);
    expect(bestCase).toBe(3000);
    expect(worstCase).toBe(1000);
  });

  it("single outcome → best = worst", () => {
    const outcomes = [{ estimated_price_cents: 7000 }];
    const { bestCase, worstCase } = computeBestWorstCase(outcomes, 5000);
    expect(bestCase).toBe(2000);
    expect(worstCase).toBe(2000);
  });

  it("empty outcomes → both 0", () => {
    const { bestCase, worstCase } = computeBestWorstCase([], 5000);
    expect(bestCase).toBe(0);
    expect(worstCase).toBe(0);
  });
});

// ─── withRetry ───────────────────────────────────────────────────────────────

describe("withRetry", () => {
  it("returns result on first success", async () => {
    const result = await withRetry(() => Promise.resolve(42));
    expect(result).toBe(42);
  });

  it("retries on transient connection error", async () => {
    let attempts = 0;
    const fn = () => {
      attempts++;
      if (attempts < 3) {
        const err = new Error("Connection terminated") as Error & { code: string };
        err.code = "ECONNRESET";
        throw err;
      }
      return Promise.resolve("ok");
    };
    const result = await withRetry(fn, 3);
    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  it("throws non-transient errors immediately", async () => {
    const fn = () => Promise.reject(new Error("syntax error"));
    await expect(withRetry(fn, 3)).rejects.toThrow("syntax error");
  });

  it("throws after max retries exhausted", async () => {
    const fn = () => {
      const err = new Error("Connection terminated") as Error & { code: string };
      err.code = "ECONNREFUSED";
      throw err;
    };
    await expect(withRetry(fn, 1)).rejects.toThrow("Connection terminated");
  });
});

// ─── shuffle ─────────────────────────────────────────────────────────────────

describe("shuffle", () => {
  it("returns array of same length", async () => {
    await withSeededRandom(42, () => {
      const arr = [1, 2, 3, 4, 5];
      expect(shuffle(arr)).toHaveLength(5);
    });
  });

  it("contains same elements", async () => {
    await withSeededRandom(42, () => {
      const arr = [1, 2, 3, 4, 5];
      const shuffled = shuffle(arr);
      expect(shuffled.sort()).toEqual([1, 2, 3, 4, 5]);
    });
  });

  it("does not mutate original array", async () => {
    await withSeededRandom(42, () => {
      const arr = [1, 2, 3, 4, 5];
      shuffle(arr);
      expect(arr).toEqual([1, 2, 3, 4, 5]);
    });
  });

  it("empty array → empty array", async () => {
    await withSeededRandom(42, () => {
      expect(shuffle([])).toEqual([]);
    });
  });

  it("single element → same element", async () => {
    await withSeededRandom(42, () => {
      expect(shuffle([42])).toEqual([42]);
    });
  });
});

// ─── pick ────────────────────────────────────────────────────────────────────

describe("pick", () => {
  it("returns an element from the array", async () => {
    await withSeededRandom(42, () => {
      const arr = [10, 20, 30];
      expect(arr).toContain(pick(arr));
    });
  });

  it("single element always returns that element", async () => {
    await withSeededRandom(42, () => {
      expect(pick([99])).toBe(99);
    });
  });
});

// ─── pickWeightedStrategy ────────────────────────────────────────────────────

describe("pickWeightedStrategy", () => {
  it("returns value in [0, maxStrategy)", async () => {
    await withSeededRandom(42, () => {
      for (let i = 0; i < 50; i++) {
        const result = pickWeightedStrategy(5, [1, 3]);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThan(5);
      }
    });
  });

  it("biased strategies are selected more often", async () => {
    await withSeededRandom(42, () => {
      const counts = new Map<number, number>();
      for (let i = 0; i < 1000; i++) {
        const result = pickWeightedStrategy(3, [0]);
        counts.set(result, (counts.get(result) ?? 0) + 1);
      }
      // Strategy 0 has weight 2, strategies 1 and 2 have weight 1
      // Strategy 0 should appear ~50% of the time (2/4)
      const biasedCount = counts.get(0) ?? 0;
      expect(biasedCount).toBeGreaterThan(350); // ~50% with margin
      expect(biasedCount).toBeLessThan(650);
    });
  });
});
