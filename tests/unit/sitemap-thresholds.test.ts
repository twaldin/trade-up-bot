import { describe, it, expect } from "vitest";
import { buildSkinSitemap, isSkinIndexworthy } from "../../server/routes/sitemap.js";

const BASE = "https://tradeupbot.app";
const LASTMOD = "2026-06-10";

function extractLocs(xml: string): string[] {
  return Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g)).map(m => m[1]);
}

describe("isSkinIndexworthy quality bar", () => {
  it("requires the listing floor regardless of other signals", () => {
    // Below the listing floor, even a trade-up input is not index-worthy.
    expect(isSkinIndexworthy({ name: "x", listing_count: 4, is_tradeup_input: true })).toBe(false);
  });

  it("admits trade-up inputs above the listing floor", () => {
    expect(isSkinIndexworthy({ name: "x", listing_count: 10, is_tradeup_input: true })).toBe(true);
  });

  it("admits trade-up outputs above the listing floor", () => {
    expect(isSkinIndexworthy({ name: "x", listing_count: 12, is_tradeup_output: true })).toBe(true);
  });

  it("admits skins with substantive recent price history (obs30 >= 20)", () => {
    expect(isSkinIndexworthy({ name: "x", listing_count: 50, obs30: 20 })).toBe(true);
  });

  it("EXCLUDES commodity pages: plenty of listings but no trade-up role and thin price history", () => {
    // This is the ~1,240-page thin bucket we are pruning: lots of listings (a useless
    // signal — nearly every skin has >100), but no unique trade-up value and little history.
    expect(isSkinIndexworthy({ name: "x", listing_count: 300, obs30: 5 })).toBe(false);
    expect(isSkinIndexworthy({ name: "x", listing_count: 300 })).toBe(false);
  });

  it("honours caller-supplied thresholds", () => {
    expect(isSkinIndexworthy({ name: "x", listing_count: 30, obs30: 15 }, 10, 10)).toBe(true);
    expect(isSkinIndexworthy({ name: "x", listing_count: 30, obs30: 15 }, 10, 20)).toBe(false);
  });
});

describe("buildSkinSitemap quality-bar pruning", () => {
  const skins = [
    { name: "AK-47 | Input", listing_count: 12, is_tradeup_input: true, obs30: 0 },
    { name: "AK-47 | Output", listing_count: 12, is_tradeup_output: true, obs30: 0 },
    { name: "AK-47 | Liquid", listing_count: 80, obs30: 40 },
    { name: "AK-47 | Thin", listing_count: 300, obs30: 3 },
    { name: "AK-47 | BelowFloor", listing_count: 4, is_tradeup_input: true, obs30: 99 },
  ];

  it("includes trade-up-linked and liquid skins", () => {
    const locs = extractLocs(buildSkinSitemap(BASE, skins, LASTMOD));
    expect(locs).toContain(`${BASE}/skins/ak-47-input`);
    expect(locs).toContain(`${BASE}/skins/ak-47-output`);
    expect(locs).toContain(`${BASE}/skins/ak-47-liquid`);
  });

  it("excludes thin commodity pages and sub-floor skins", () => {
    const locs = extractLocs(buildSkinSitemap(BASE, skins, LASTMOD));
    expect(locs).not.toContain(`${BASE}/skins/ak-47-thin`);
    expect(locs).not.toContain(`${BASE}/skins/ak-47-belowfloor`);
  });

  it("treats a missing obs30 as zero history (backward compatible rows are pruned unless linked)", () => {
    const rows = [{ name: "AK-47 | NoSignals", listing_count: 500 }];
    const locs = extractLocs(buildSkinSitemap(BASE, rows, LASTMOD));
    expect(locs).not.toContain(`${BASE}/skins/ak-47-nosignals`);
  });
});
