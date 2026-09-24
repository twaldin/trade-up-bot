/**
 * Ad-review banned copy. Scans the surfaces GTM named, plus prerendered HTML
 * when `dist/` exists (produced by `npm run build`).
 *
 * Allowlist is exact substrings that are disclaimers or existing guide
 * excerpts, not ad labels. Remove a line here only after the copy is gone.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const SOURCE_FILES = [
  "src/preview/pages/PreviewPricing.tsx",
  "src/preview/pages/PreviewCalculator.tsx",
  "src/preview/pages/PreviewLanding.tsx",
  "src/preview/pages/PreviewShare.tsx",
  "server/index.ts",
  "server/static-seo-pages.ts",
];

const PRERENDERED = [
  "dist/index.html",
  "dist/calculator/index.html",
  "dist/pricing/index.html",
  "dist/features/index.html",
  "dist/faq/index.html",
];

/** Legitimate hits. Each entry is the exact text that may remain. */
const ALLOWLIST = [
  "never guaranteed", // FAQ disclaimer: returns are never guaranteed
  "not guaranteed", // product FAQ: not guaranteed profit
  "How does TradeUpBot find profitable trade-ups?", // kept FAQ question; query phrasing, not an ad claim
  "How to Use TradeUpBot to Find Profitable Trade-Ups", // existing guide title on the home teaser
  "Learn how to use TradeUpBot to find profitable CS2 trade-ups", // existing guide excerpt on the home teaser
  "test floats, odds, and fees", // existing calculator-guide excerpt
];

const BANNED: { label: string; pattern: RegExp }[] = [
  { label: "case key", pattern: /case key/i },
  { label: "Profitable CS2 Contracts", pattern: /Profitable CS2 Contracts/ },
  { label: "profitable CS2 trade-ups", pattern: /profitable CS2 trade-ups/i },
  { label: ">Chance<", pattern: />Chance</ },
  { label: "odds", pattern: /\bodds\b/i },
  { label: "chance of profit", pattern: /chance of profit/i },
  { label: "chance to profit", pattern: /chance to profit/i },
  { label: "chance-to-profit", pattern: /chance-to-profit/i },
  { label: "% chance", pattern: /% chance/i },
  { label: "rolls", pattern: /\brolls?\b/i },
  { label: "bankroll", pattern: /bankroll/i },
  { label: "finish green", pattern: /finish(?:es)? (?:in the )?green/i },
  { label: "Min chance %", pattern: /Min chance %/ },
  { label: "Find Profitable", pattern: /Find Profitable/i },
  { label: "Live Profitable", pattern: /Live Profitable/i },
  { label: "guaranteed", pattern: /guaranteed/i },
  { label: "jackpot", pattern: /jackpot/i },
  { label: "gamble", pattern: /gamble/i },
  { label: "bet", pattern: /\bbet\b/i },
  { label: "win big", pattern: /win big/i },
  { label: "case opening", pattern: /case opening/i },
];

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function visible(raw: string): string {
  let text = stripComments(raw);
  for (const allowed of ALLOWLIST) text = text.split(allowed).join(" ");
  return text;
}

function hits(text: string): string[] {
  return BANNED.filter((rule) => rule.pattern.test(text)).map((rule) => rule.label);
}

describe("banned ad copy", () => {
  for (const rel of SOURCE_FILES) {
    it(`${rel} has none of the banned phrases`, () => {
      const found = hits(visible(readFileSync(join(root, rel), "utf8")));
      expect(found, found.join(", ")).toEqual([]);
    });
  }

  it("prerendered HTML has none of the banned phrases", () => {
    const present = PRERENDERED.filter((rel) => existsSync(join(root, rel)));
    expect(present.length, "run npm run build so dist HTML exists").toBeGreaterThan(0);
    const found = present.flatMap((rel) =>
      hits(visible(readFileSync(join(root, rel), "utf8"))).map((label) => `${rel}: ${label}`),
    );
    expect(found, found.join(", ")).toEqual([]);
  });
});
