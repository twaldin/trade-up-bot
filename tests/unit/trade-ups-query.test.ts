import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  canonicalSortKey,
  chanceThreshold,
  isKnownSortKey,
  tradeUpSortColumn,
  tradeUpsCacheKey,
} from "../../server/routes/trade-ups-query.js";
import { computeChanceToProfit } from "../../server/engine.js";
import { BOARD_SORTS } from "../../src/preview/components/PreviewFilters.js";

describe("tradeUpSortColumn", () => {
  it("maps the canonical short keys to their columns", () => {
    expect(tradeUpSortColumn("profit")).toBe("t.profit_cents");
    expect(tradeUpSortColumn("roi")).toBe("t.roi_percentage");
    expect(tradeUpSortColumn("cost")).toBe("t.total_cost_cents");
    expect(tradeUpSortColumn("chance")).toBe("t.chance_to_profit");
    expect(tradeUpSortColumn("created")).toBe("t.created_at");
  });

  it("accepts column names so older clients sending sort=profit_cents still sort by profit", () => {
    expect(tradeUpSortColumn("profit_cents")).toBe("t.profit_cents");
    expect(tradeUpSortColumn("roi_percentage")).toBe("t.roi_percentage");
    expect(tradeUpSortColumn("total_cost_cents")).toBe("t.total_cost_cents");
    expect(tradeUpSortColumn("chance_to_profit")).toBe("t.chance_to_profit");
    expect(tradeUpSortColumn("created_at")).toBe("t.created_at");
  });

  it("treats newest as created", () => {
    expect(canonicalSortKey("newest")).toBe("created");
    expect(tradeUpSortColumn("newest")).toBe("t.created_at");
  });

  it("falls back to trade_up_score for missing or unknown keys", () => {
    expect(tradeUpSortColumn(undefined)).toBe("t.trade_up_score");
    expect(tradeUpSortColumn("")).toBe("t.trade_up_score");
    expect(tradeUpSortColumn("nope")).toBe("t.trade_up_score");
    expect(tradeUpSortColumn("__proto__")).toBe("t.trade_up_score");
    expect(tradeUpSortColumn("toString")).toBe("t.trade_up_score");
    expect(canonicalSortKey("constructor")).toBe("trade_up_score");
  });

  it("knows every sort the preview board offers", () => {
    for (const [value] of BOARD_SORTS) {
      expect(isKnownSortKey(value), `server does not know sort=${value}`).toBe(true);
    }
  });
});

describe("chanceThreshold", () => {
  it("reads the query as a percent, dividing by 100 exactly once", () => {
    expect(chanceThreshold("40", "min")).toBeCloseTo(0.4, 6);
    expect(chanceThreshold("40", "max")).toBeCloseTo(0.4, 6);
  });

  it("treats min_chance=100 as 100%, not 1%", () => {
    const threshold = chanceThreshold("100", "min");
    expect(threshold).not.toBeNull();
    expect(threshold!).toBeGreaterThan(0.999999);
    expect(0.0333).toBeLessThan(threshold!);
    expect(0.01).toBeLessThan(threshold!);
  });

  it("at 50 keeps a 0.50 row and drops a 0.4999 row", () => {
    const threshold = chanceThreshold("50", "min")!;
    expect(0.5).toBeGreaterThanOrEqual(threshold);
    expect(0.4999).toBeLessThan(threshold);
  });

  it("lets a float-summed 100% chance pass a 100% minimum", () => {
    const tenths = Array.from({ length: 10 }, () => ({ estimated_price_cents: 5000, probability: 0.1 }));
    const chance = computeChanceToProfit(tenths, 1000);
    expect(chance).toBeLessThan(1);
    expect(chance).toBeGreaterThanOrEqual(chanceThreshold("100", "min")!);
  });

  it("lets a float-summed 30% chance pass a 30% maximum", () => {
    expect(0.1 + 0.2).toBeLessThanOrEqual(chanceThreshold("30", "max")!);
  });

  it("clamps out-of-range percents into 0–100", () => {
    expect(chanceThreshold("250", "min")!).toBeLessThanOrEqual(1);
    expect(chanceThreshold("250", "min")!).toBeGreaterThan(0.999999);
    expect(chanceThreshold("-5", "max")!).toBeGreaterThanOrEqual(0);
    expect(chanceThreshold("-5", "max")!).toBeLessThan(0.000001);
  });

  it("ignores blank or non-numeric values instead of sending NaN to SQL", () => {
    expect(chanceThreshold(undefined, "min")).toBeNull();
    expect(chanceThreshold("", "min")).toBeNull();
    expect(chanceThreshold("abc", "max")).toBeNull();
  });
});

describe("tradeUpsCacheKey", () => {
  const key = (query: Record<string, unknown>) => tradeUpsCacheKey(query, "anon", "free");

  it("caches a sort alias under its canonical key, so a stale profit_cents entry cannot be served", () => {
    expect(key({ sort: "profit_cents", order: "desc" })).toBe(key({ sort: "profit", order: "desc" }));
    expect(key({ sort: "newest" })).toBe(key({ sort: "created" }));
    expect(key({ sort: "bogus" })).toBe(key({}));
    expect(key({ sort: "profit" })).not.toBe(key({ sort: "trade_up_score" }));
  });

  it("caches min_chance by the parsed threshold", () => {
    expect(key({ min_chance: "100" })).toBe(key({ min_chance: "100.0" }));
    expect(key({ min_chance: "250" })).toBe(key({ min_chance: "100" }));
    expect(key({ min_chance: "abc" })).toBe(key({}));
    expect(key({ min_chance: "1" })).not.toBe(key({ min_chance: "100" }));
    expect(key({ max_chance: "5" })).not.toBe(key({ min_chance: "5" }));
  });

  it("ignores parameter order, blank values and the default order", () => {
    expect(key({ type: "restricted_classified", max_cost: "6000" }))
      .toBe(key({ max_cost: "6000", type: "restricted_classified" }));
    expect(key({ type: "", skin: "" })).toBe(key({}));
    expect(key({ order: "desc" })).toBe(key({}));
    expect(key({ order: "asc" })).not.toBe(key({}));
  });

  it("keeps viewer and tier apart and stays under the tu: invalidation prefix", () => {
    expect(tradeUpsCacheKey({}, "a", "pro")).not.toBe(tradeUpsCacheKey({}, "b", "pro"));
    expect(tradeUpsCacheKey({}, "a", "pro")).not.toBe(tradeUpsCacheKey({}, "a", "free"));
    expect(key({}).startsWith("tu:")).toBe(true);
  });

  it("is what the list route caches under", () => {
    const route = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../server/routes/trade-ups.ts"), "utf-8");
    expect(route).toContain("tradeUpsCacheKey(req.query");
    expect(route).not.toContain('"tu:" + JSON.stringify(req.query)');
  });
});
