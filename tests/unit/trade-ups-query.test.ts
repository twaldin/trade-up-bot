import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  canonicalSortKey,
  chanceThreshold,
  isKnownSortKey,
  listCacheTier,
  NO_CHANCE_MATCH,
  tradeUpHiddenByDelay,
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

  it("falls back to trade_up_score for missing, unknown, or non-string keys", () => {
    expect(tradeUpSortColumn(undefined)).toBe("t.trade_up_score");
    expect(tradeUpSortColumn("")).toBe("t.trade_up_score");
    expect(tradeUpSortColumn("nope")).toBe("t.trade_up_score");
    expect(tradeUpSortColumn("__proto__")).toBe("t.trade_up_score");
    expect(tradeUpSortColumn("toString")).toBe("t.trade_up_score");
    expect(canonicalSortKey("constructor")).toBe("trade_up_score");
    expect(canonicalSortKey(["profit"])).toBe("trade_up_score");
    expect(tradeUpSortColumn(["profit"])).toBe("t.trade_up_score");
  });

  it("knows every sort the preview board offers", () => {
    for (const [value] of BOARD_SORTS) {
      expect(isKnownSortKey(value), `server does not know sort=${value}`).toBe(true);
    }
  });
});

function numericThreshold(percent: string, bound: "min" | "max"): number {
  const threshold = chanceThreshold(percent, bound);
  if (typeof threshold !== "number") throw new Error(`expected a numeric threshold for ${percent}`);
  return threshold;
}

describe("chanceThreshold", () => {
  it("reads the query as a percent, dividing by 100 exactly once", () => {
    expect(chanceThreshold("40", "min")).toBeCloseTo(0.4, 6);
    expect(chanceThreshold("40", "max")).toBeCloseTo(0.4, 6);
  });

  it("treats min_chance=100 as 100%, not 1%", () => {
    const threshold = numericThreshold("100", "min");
    expect(threshold).toBeGreaterThan(0.999999);
    expect(0.0333).toBeLessThan(threshold);
    expect(0.01).toBeLessThan(threshold);
  });

  it("at 50 keeps a 0.50 row and drops a 0.4999 row", () => {
    const threshold = numericThreshold("50", "min");
    expect(0.5).toBeGreaterThanOrEqual(threshold);
    expect(0.4999).toBeLessThan(threshold);
  });

  it("lets a float-summed 100% chance pass a 100% minimum", () => {
    const tenths = Array.from({ length: 10 }, () => ({ estimated_price_cents: 5000, probability: 0.1 }));
    const chance = computeChanceToProfit(tenths, 1000);
    expect(chance).toBeLessThan(1);
    expect(chance).toBeGreaterThanOrEqual(numericThreshold("100", "min"));
  });

  it("lets a float-summed 30% chance pass a 30% maximum", () => {
    expect(0.1 + 0.2).toBeLessThanOrEqual(numericThreshold("30", "max"));
  });

  it("accepts the 0 and 100 endpoints", () => {
    expect(chanceThreshold("0", "min")).toBeCloseTo(0, 6);
    expect(chanceThreshold("100", "max")).toBeCloseTo(1, 6);
  });

  it("matches nothing for non-numeric input rather than dropping the filter", () => {
    expect(chanceThreshold("abc", "min")).toBe(NO_CHANCE_MATCH);
    expect(chanceThreshold("abc", "max")).toBe(NO_CHANCE_MATCH);
    expect(chanceThreshold("Infinity", "min")).toBe(NO_CHANCE_MATCH);
    expect(chanceThreshold("40abc", "min")).toBe(NO_CHANCE_MATCH);
  });

  it("matches nothing for out-of-range percents rather than clamping them", () => {
    expect(chanceThreshold("250", "min")).toBe(NO_CHANCE_MATCH);
    expect(chanceThreshold("100.5", "min")).toBe(NO_CHANCE_MATCH);
    expect(chanceThreshold("-5", "min")).toBe(NO_CHANCE_MATCH);
    expect(chanceThreshold("-5", "max")).toBe(NO_CHANCE_MATCH);
  });

  it("treats blank as no filter", () => {
    expect(chanceThreshold(undefined, "min")).toBeNull();
    expect(chanceThreshold("", "min")).toBeNull();
    expect(chanceThreshold("  ", "max")).toBeNull();
  });

  it("matches nothing for repeated or array chance params instead of throwing", () => {
    expect(chanceThreshold(["40"], "min")).toBe(NO_CHANCE_MATCH);
    expect(chanceThreshold(["100", "1"], "max")).toBe(NO_CHANCE_MATCH);
    expect(chanceThreshold(40, "min")).toBe(NO_CHANCE_MATCH);
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
    expect(key({ min_chance: "1" })).not.toBe(key({ min_chance: "100" }));
    expect(key({ max_chance: "5" })).not.toBe(key({ min_chance: "5" }));
    expect(key({ min_chance: "" })).toBe(key({}));
  });

  it("never caches an invalid chance with the unfiltered or clamped list", () => {
    expect(key({ min_chance: "abc" })).not.toBe(key({}));
    expect(key({ min_chance: "250" })).not.toBe(key({ min_chance: "100" }));
    expect(key({ max_chance: "-5" })).not.toBe(key({ max_chance: "0" }));
    expect(key({ min_chance: "abc" })).toBe(key({ min_chance: "250" }));
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

  it("does not key an array sort as the default while the handler sorts by that column", () => {
    expect(key({ sort: ["profit"] })).toBe(key({}));
    expect(tradeUpSortColumn(["profit"])).toBe(tradeUpSortColumn(undefined));
  });

  it("keys an array chance as no-match, never as the unfiltered list", () => {
    expect(key({ min_chance: ["40", "100"] })).not.toBe(key({}));
    expect(key({ min_chance: ["40"] })).toBe(key({ min_chance: "abc" }));
    expect(key({ max_chance: ["5"] })).not.toBe(key({}));
  });

  it("treats page=1 and a missing page as the same list", () => {
    expect(key({ page: "1" })).toBe(key({}));
    expect(key({ page: "2" })).not.toBe(key({}));
  });

  it("gives anonymous and pro or internal callers different keys", () => {
    const anon = tradeUpsCacheKey({}, "anon", listCacheTier({}));
    const pro = tradeUpsCacheKey({}, "steam-pro", listCacheTier({ tier: "pro" }));
    const internal = tradeUpsCacheKey({}, "anon", listCacheTier({
      authorization: "Bearer bot-token",
      internalToken: "bot-token",
    }));
    expect(anon).not.toBe(pro);
    expect(anon).not.toBe(internal);
    expect(listCacheTier({ authorization: "Bearer nope", internalToken: "bot-token" })).toBe("free");
    expect(listCacheTier({ tier: "basic" })).toBe("free");
    expect(listCacheTier({ tier: "lifetime" })).toBe("pro");
    expect(listCacheTier({ tier: "basic" })).toBe(listCacheTier({ tier: "free" }));
  });

  it("is what the list route caches under", () => {
    const route = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../server/routes/trade-ups.ts"), "utf-8");
    expect(route).toContain("listCacheTier(");
    expect(route).toContain("tradeUpsCacheKey(req.query");
    expect(route).not.toContain('"tu:" + JSON.stringify(req.query)');
  });
});

describe("discord /top min_chance bounds", () => {
  it("rejects chance values outside 0–100 at the slash command", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../discord-bot/index.ts"), "utf-8");
    expect(source).toContain('setName("min_chance")');
    expect(source).toMatch(/setName\("min_chance"\)[\s\S]*?setMinValue\(0\)\.setMaxValue\(100\)/);
  });
});

describe("tradeUpHiddenByDelay", () => {
  const now = Date.parse("2026-09-24T12:00:00.000Z");
  const delay = 3 * 60 * 60;

  it("hides a row strictly younger than the free delay and shows the boundary", () => {
    expect(tradeUpHiddenByDelay(new Date(now - delay * 1000 + 1).toISOString(), delay, now)).toBe(true);
    expect(tradeUpHiddenByDelay(new Date(now - delay * 1000).toISOString(), delay, now)).toBe(false);
    expect(tradeUpHiddenByDelay(new Date(now - delay * 1000 - 1).toISOString(), delay, now)).toBe(false);
  });

  it("never hides a row when the viewer delay is zero", () => {
    expect(tradeUpHiddenByDelay(new Date(now).toISOString(), 0, now)).toBe(false);
  });
});
