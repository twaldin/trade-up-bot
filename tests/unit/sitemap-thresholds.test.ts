import { describe, it, expect } from "vitest";
import { buildSkinSitemap } from "../../server/routes/sitemap.js";

const BASE = "https://tradeupbot.app";
const LASTMOD = "2026-06-10";

function extractLocs(xml: string): string[] {
  return Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g)).map(m => m[1]);
}

describe("buildSkinSitemap hysteresis threshold", () => {
  const skins = [
    { name: "AK-47 | Count 4", listing_count: 4 },
    { name: "AK-47 | Count 7", listing_count: 7 },
    { name: "AK-47 | Count 10", listing_count: 10 },
    { name: "AK-47 | Count 12", listing_count: 12 },
  ];

  it("default threshold is 10: excludes skins with listing_count < 10", () => {
    const xml = buildSkinSitemap(BASE, skins, LASTMOD);
    const locs = extractLocs(xml);
    // Counts 4 and 7 are below 10 — must be excluded
    expect(locs).not.toContain(`${BASE}/skins/ak-47-count-4`);
    expect(locs).not.toContain(`${BASE}/skins/ak-47-count-7`);
  });

  it("default threshold is 10: includes skins with listing_count >= 10", () => {
    const xml = buildSkinSitemap(BASE, skins, LASTMOD);
    const locs = extractLocs(xml);
    // Counts 10 and 12 meet the threshold — must be included
    expect(locs).toContain(`${BASE}/skins/ak-47-count-10`);
    expect(locs).toContain(`${BASE}/skins/ak-47-count-12`);
  });

  it("caller can override the threshold (floor can be raised further)", () => {
    const xml = buildSkinSitemap(BASE, skins, LASTMOD, 12);
    const locs = extractLocs(xml);
    expect(locs).not.toContain(`${BASE}/skins/ak-47-count-10`);
    expect(locs).toContain(`${BASE}/skins/ak-47-count-12`);
  });
});
