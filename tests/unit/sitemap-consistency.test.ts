import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  buildCollectionSitemap,
  buildCollectionTradeUpSitemap,
  buildSitemapIndex,
  buildSkinSitemap,
  buildStaticSitemap,
} from "../../server/routes/sitemap.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const BASE = "https://tradeupbot.app";
const LASTMOD = "2026-05-12";

function extractLocs(xml: string): string[] {
  return Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g)).map(match => match[1]);
}

function readRobotsTxt(): string {
  return readFileSync(join(__dir, "../../public/robots.txt"), "utf-8");
}

describe("robots.txt and sitemap consistency", () => {
  it("robots.txt allows public content and only disallows auth and api routes", () => {
    const robots = readRobotsTxt();
    const disallowRules = robots
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.startsWith("Disallow:"))
      .map(line => line.replace("Disallow:", "").trim());

    expect(robots).toContain("User-agent: *");
    expect(robots).toContain("Allow: /");
    expect(disallowRules).toEqual(["/auth/", "/api/"]);
    expect(robots).toContain("Sitemap: https://tradeupbot.app/sitemap.xml");
  });

  it("sitemap index references exactly the four expected sub-sitemaps", () => {
    const locs = extractLocs(buildSitemapIndex(BASE, LASTMOD));

    expect(locs).toEqual([
      `${BASE}/sitemap-static.xml`,
      `${BASE}/sitemap-collections.xml`,
      `${BASE}/sitemap-collection-tradeups.xml`,
      `${BASE}/sitemap-skins.xml`,
    ]);
  });

  it("all sitemap builders produce HTTPS apex URLs that avoid robots disallow paths", () => {
    const sitemaps = [
      buildStaticSitemap(BASE, LASTMOD),
      buildCollectionSitemap(BASE, [{ name: "The Dreams & Nightmares Collection" }], LASTMOD),
      buildCollectionTradeUpSitemap(BASE, [{ name: "The Fracture Collection" }], LASTMOD),
      buildSkinSitemap(BASE, [{ name: "AK-47 | Redline", listing_count: 5 }], LASTMOD),
    ];
    const locs = sitemaps.flatMap(extractLocs);

    expect(locs.length).toBeGreaterThan(0);
    for (const loc of locs) {
      expect(loc).toMatch(/^https:\/\/tradeupbot\.app\//);
      expect(loc).not.toContain("http://");
      expect(loc).not.toContain("www.tradeupbot.app");
      expect(new URL(loc).pathname).not.toMatch(/^\/(?:auth|api)\//);
    }
  });

  it("skin sitemap excludes low-listing noindex skin pages", () => {
    const xml = buildSkinSitemap(BASE, [
      { name: "AK-47 | Redline", listing_count: 5 },
      { name: "Glock-18 | Low Listings", listing_count: 4 },
    ], LASTMOD);
    const locs = extractLocs(xml);

    expect(locs).toContain(`${BASE}/skins/ak-47-redline`);
    expect(locs).not.toContain(`${BASE}/skins/glock-18-low-listings`);
  });

  it("all sub-sitemap XML documents contain a urlset and at least one URL for non-empty inputs", () => {
    const sitemaps = [
      buildStaticSitemap(BASE, LASTMOD),
      buildCollectionSitemap(BASE, [{ name: "The Dreams & Nightmares Collection" }], LASTMOD),
      buildCollectionTradeUpSitemap(BASE, [{ name: "The Fracture Collection" }], LASTMOD),
      buildSkinSitemap(BASE, [{ name: "AK-47 | Redline", listing_count: 5 }], LASTMOD),
    ];

    for (const xml of sitemaps) {
      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain("<urlset");
      expect((xml.match(/<url>/g) ?? []).length).toBeGreaterThanOrEqual(1);
    }
  });
});
