/**
 * Visible labels on the landing demo and the collection filter.
 * Query keys stay min_chance / min_win. The percent in the demo is inline.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS, filtersToParams } from "../../src/components/FilterBar.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function source(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

const demo = source("src/components/DemoAnimation.tsx");
const mobile = source("src/components/DemoAnimationMobile.tsx");
const filter = source("src/components/FilterBar.tsx");

describe("landing demo and collection filter labels", () => {
  it("names the profit share and the best outcome without the old labels", () => {
    for (const text of [demo, mobile, filter]) {
      expect(text).not.toMatch(/>Chance</);
      expect(text).not.toContain("Best Win");
      expect(text).not.toMatch(/\bChance ▾/);
    }
    expect(demo).toContain("Outcomes above cost");
    expect(demo).toContain("Best outcome");
    expect(demo).toContain("46% above cost");
    expect(mobile).toContain("Outcomes above cost");
    expect(mobile).toContain("46% above cost");
    expect(filter).toContain('label="Outcomes above cost"');
    expect(filter).toContain('label="Best outcome"');
  });

  it("keeps the chance and win query keys", () => {
    const params = filtersToParams({ ...EMPTY_FILTERS, minChance: "10", maxChance: "90", minWin: "100" });
    expect(params.get("min_chance")).toBe("10");
    expect(params.get("max_chance")).toBe("90");
    expect(params.get("min_win")).toBe("10000");
    expect(filter).toContain("minChance");
    expect(filter).toContain("minWin");
  });
});
