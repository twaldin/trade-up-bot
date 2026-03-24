import { describe, it, expect } from "vitest";
import { buildSitemapIndex, buildStaticSitemap, buildCollectionSitemap, buildSkinSitemap } from "../../server/routes/sitemap.js";

describe("buildSitemapIndex", () => {
  it("generates valid sitemap index XML", () => {
    const xml = buildSitemapIndex("https://tradeupbot.app", "2026-03-24");
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain("<sitemapindex");
    expect(xml).toContain("/sitemap-static.xml");
    expect(xml).toContain("/sitemap-collections.xml");
    expect(xml).toContain("/sitemap-skins.xml");
    expect(xml).toContain("/sitemap-tradeups.xml");
  });
});

describe("buildStaticSitemap", () => {
  it("includes all static pages", () => {
    const xml = buildStaticSitemap("https://tradeupbot.app", "2026-03-24");
    expect(xml).toContain("<urlset");
    expect(xml).toContain("tradeupbot.app/");
    expect(xml).toContain("tradeupbot.app/trade-ups");
    expect(xml).toContain("tradeupbot.app/calculator");
    expect(xml).toContain("tradeupbot.app/faq");
    expect(xml).toContain("tradeupbot.app/blog");
  });
});

describe("buildCollectionSitemap", () => {
  it("generates URLs for collections", () => {
    const collections = [
      { name: "Dreams & Nightmares" },
      { name: "Fracture" },
    ];
    const xml = buildCollectionSitemap("https://tradeupbot.app", collections, "2026-03-24");
    expect(xml).toContain("tradeupbot.app/collections/Dreams%20%26%20Nightmares");
    expect(xml).toContain("tradeupbot.app/collections/Fracture");
  });
});

describe("buildSkinSitemap", () => {
  it("generates URLs for skins using slugs", () => {
    const skins = [
      { name: "AK-47 | Redline", listing_count: 10 },
      { name: "M4A4 | Howl", listing_count: 20 },
      { name: "Glock-18 | Fade", listing_count: 2 },
    ];
    const xml = buildSkinSitemap("https://tradeupbot.app", skins, "2026-03-24", 5);
    expect(xml).toContain("tradeupbot.app/skins/ak-47-redline");
    expect(xml).toContain("tradeupbot.app/skins/m4a4-howl");
    expect(xml).not.toContain("glock-18-fade");
  });
});
