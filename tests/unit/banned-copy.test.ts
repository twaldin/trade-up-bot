/**
 * Ad-review banned copy. Scans the surfaces GTM named, plus prerendered HTML
 * when `dist/` exists (produced by `npm run build`).
 *
 * Allowlist is exact substrings that are disclaimers or existing guide
 * excerpts, not ad labels. Remove a line here only after the copy is gone.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function previewCopyFiles(): string[] {
  const dir = join(root, "src/preview");
  const out: string[] = [];
  const walk = (current: string, rel: string) => {
    for (const name of readdirSync(current)) {
      const abs = join(current, name);
      const next = rel ? `${rel}/${name}` : name;
      if (name.endsWith(".tsx") || name.endsWith(".ts")) out.push(`src/preview/${next}`);
      else if (!name.includes(".")) walk(abs, next);
    }
  };
  walk(dir, "");
  return out;
}

const SOURCE_FILES = [
  ...previewCopyFiles(),
  "server/index.ts",
  "server/seo.ts",
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
  "test floats, odds, and fees", // existing calculator-guide excerpt, not a home teaser
  "const win", // window handle in openListings, not user-facing copy
  "if (win)", // same window handle
  "Win rate", // completed-sale statistic on the account page
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
  { label: "win", pattern: /\bwin\b/i },
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

  it("pins the sign-in bar and the FAQ Steam sentence", () => {
    const bar = "Verify and Claim are Pro features. Signing in with Steam is free.";
    const faq = "Signing in with Steam is free. Verify and Claim are Pro features.";
    const copy = readFileSync(join(root, "src/preview/lib/copy.ts"), "utf8");
    const seo = readFileSync(join(root, "server/static-seo-pages.ts"), "utf8");
    expect(copy).toContain(`"${bar}"`);
    const faqHits = seo.split(faq).length - 1;
    expect(faqHits).toBe(2);
    for (const rel of [
      "src/preview/pages/PreviewShare.tsx",
      "src/preview/pages/PreviewAccount.tsx",
      "src/preview/pages/PreviewFeatures.tsx",
    ]) {
      const source = readFileSync(join(root, rel), "utf8");
      expect(source).toContain("SIGN_IN_TO_CLAIM");
      expect(source).not.toContain("Verify is part of Pro");
      expect(source).not.toContain("Sign in to claim and purchase");
      expect(source).not.toContain("Sign in to see claims");
    }
  });

  it("prerendered HTML has none of the banned phrases", () => {
    const present = PRERENDERED.filter((rel) => existsSync(join(root, rel)));
    expect(present.length, "run npm run build so dist HTML exists").toBeGreaterThan(0);
    const found = present.flatMap((rel) =>
      hits(visible(readFileSync(join(root, rel), "utf8"))).map((label) => `${rel}: ${label}`),
    );
    expect(found, found.join(", ")).toEqual([]);
  });
});
