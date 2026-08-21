import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(dir, rel), "utf8");

const skins = read("../../src/preview/pages/PreviewSkins.tsx");
const board = read("../../src/preview/pages/PreviewBoard.tsx");
const search = read("../../src/preview/components/PreviewSearch.tsx");
const sniper = read("../../src/preview/pages/PreviewSniper.tsx");

const skinsPage = skins.slice(
  skins.indexOf("export function PreviewSkinsPage"),
  skins.indexOf("export function SkinStats"),
);
const stats = skins.slice(
  skins.indexOf("export function SkinStats"),
  skins.indexOf("export function PreviewSkinPage"),
);
const collections = skins.slice(
  skins.indexOf("export function PreviewCollectionsPage"),
  skins.indexOf("export function PreviewCollectionPage"),
);

/** Placeholder values that look like a typed query instead of an empty hint. */
const FAKE_QUERY = /covert\s*<|fn\s*·|<\s*\$\d+|<\s*0\.\d+|nightwish|classified\s*<| · /i;

function placeholders(source: string): string[] {
  return [...source.matchAll(/placeholder(?:\s*=\s*\{?)["'`]([^"'`]*)["'`]/g)].map((match) => match[1]);
}

function walkPreviewSources(root: string): string[] {
  const out: string[] = [];
  const walk = (abs: string) => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const next = resolve(abs, entry.name);
      if (entry.isDirectory()) walk(next);
      else if (/\.(tsx|ts)$/.test(entry.name)) out.push(next);
    }
  };
  walk(root);
  return out;
}

describe("preview search placeholders are empty hints", () => {
  it("uses Search skins… on the skins index, not a fake chip string", () => {
    expect(skinsPage).toMatch(/placeholder="Search skins…"/);
    expect(placeholders(skinsPage).every((hint) => !FAKE_QUERY.test(hint))).toBe(true);
    expect(skinsPage).toContain("onParsed={setParsed}");
  });

  it("uses Search trade-ups… on the board, not covert <0.03 <$700", () => {
    expect(board).toMatch(/placeholder="Search trade-ups…"/);
    expect(search).toMatch(/placeholder = "Search trade-ups…"/);
    expect(placeholders(board).every((hint) => !FAKE_QUERY.test(hint))).toBe(true);
    expect(placeholders(search).every((hint) => !FAKE_QUERY.test(hint))).toBe(true);
    expect(board).toContain("onParsed={onParsed}");
  });

  it("keeps listings at Search listings…", () => {
    expect(stats).toMatch(/placeholder="Search listings…"/);
    expect(stats).toContain("listingMatchesQuery");
    expect(stats).toContain("listingQuery");
  });

  it("leaves collections and sniper as real empty hints", () => {
    expect(collections).toMatch(/placeholder="Search a collection"/);
    expect(sniper).toContain("Filter by skin...");
    expect(sniper).toContain("Filter by collection...");
    expect(placeholders(collections).every((hint) => !FAKE_QUERY.test(hint))).toBe(true);
    expect(placeholders(sniper).every((hint) => !FAKE_QUERY.test(hint))).toBe(true);
  });

  it("has no fake-query syntax in any preview placeholder", () => {
    const files = walkPreviewSources(resolve(dir, "../../src/preview"));
    const hits: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const hint of placeholders(source)) {
        if (FAKE_QUERY.test(hint)) hits.push(`${file}: ${hint}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
