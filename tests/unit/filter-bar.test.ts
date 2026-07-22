import { describe, it, expect } from "vitest";
import {
  EMPTY_FILTERS,
  filtersToParams,
  hasActiveFilters,
  type Filters,
} from "../../src/components/FilterBar.js";

// ─── filtersToParams ─────────────────────────────────────────────────────────

describe("filtersToParams", () => {
  it("returns no params for empty filters", () => {
    expect(filtersToParams(EMPTY_FILTERS).toString()).toBe("");
  });

  it("converts dollar ranges to integer cents", () => {
    const f: Filters = { ...EMPTY_FILTERS, minProfit: "1.5", maxProfit: "20" };
    const p = filtersToParams(f);
    expect(p.get("min_profit")).toBe("150");
    expect(p.get("max_profit")).toBe("2000");
  });

  it("rounds fractional cents instead of truncating", () => {
    // 0.29 * 100 === 28.999999999999996 in IEEE 754 — must round to 29
    const p = filtersToParams({ ...EMPTY_FILTERS, minCost: "0.29" });
    expect(p.get("min_cost")).toBe("29");
  });

  it("passes ROI and chance through unconverted", () => {
    const f: Filters = { ...EMPTY_FILTERS, minRoi: "5", maxRoi: "50", minChance: "10", maxChance: "90" };
    const p = filtersToParams(f);
    expect(p.get("min_roi")).toBe("5");
    expect(p.get("max_roi")).toBe("50");
    expect(p.get("min_chance")).toBe("10");
    expect(p.get("max_chance")).toBe("90");
  });

  it("converts maxLoss and minWin to cents", () => {
    const p = filtersToParams({ ...EMPTY_FILTERS, maxLoss: "3", minWin: "100" });
    expect(p.get("max_loss")).toBe("300");
    expect(p.get("min_win")).toBe("10000");
  });

  it("joins skins with || and collections with |", () => {
    const f: Filters = {
      ...EMPTY_FILTERS,
      skins: ["AK-47 | Redline", "M4A4 | 龍王 (Dragon King)"],
      collections: ["The Phoenix Collection", "The Huntsman Collection"],
    };
    const p = filtersToParams(f);
    expect(p.get("skin")).toBe("AK-47 | Redline||M4A4 | 龍王 (Dragon King)");
    expect(p.get("collection")).toBe("The Phoenix Collection|The Huntsman Collection");
  });

  it("joins markets with commas", () => {
    const p = filtersToParams({ ...EMPTY_FILTERS, markets: ["csfloat", "dmarket"] });
    expect(p.get("markets")).toBe("csfloat,dmarket");
  });

  it("omits keys for empty strings and empty arrays", () => {
    const p = filtersToParams({ ...EMPTY_FILTERS, minRoi: "5" });
    expect([...p.keys()]).toEqual(["min_roi"]);
  });
});

// ─── hasActiveFilters ────────────────────────────────────────────────────────

describe("hasActiveFilters", () => {
  it("is false for empty filters", () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
  });

  it("is true when a market is selected", () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, markets: ["csfloat"] })).toBe(true);
  });

  it("is true when a skin or collection is selected", () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, skins: ["AK-47 | Redline"] })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, collections: ["The Phoenix Collection"] })).toBe(true);
  });

  it("is true for each range field on its own", () => {
    const rangeFields = [
      "minProfit", "maxProfit", "minRoi", "maxRoi", "minCost", "maxCost",
      "minChance", "maxChance", "maxLoss", "minWin",
    ] as const;
    for (const field of rangeFields) {
      expect(hasActiveFilters({ ...EMPTY_FILTERS, [field]: "1" })).toBe(true);
    }
  });

  it("is false again after clearing a range back to empty string", () => {
    const f: Filters = { ...EMPTY_FILTERS, minProfit: "5" };
    expect(hasActiveFilters({ ...f, minProfit: "" })).toBe(false);
  });
});
