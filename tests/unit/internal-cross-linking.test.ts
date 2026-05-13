import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { buildSeoHtml } from "../../server/seo.js";
import {
  buildCollectionSitemap,
  buildCollectionTradeUpSitemap,
  buildSitemapIndex,
  buildSkinSitemap,
  buildStaticSitemap,
} from "../../server/routes/sitemap.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const serverSource = readFileSync(join(__dir, "../../server/index.ts"), "utf-8");
const blogPostsSource = readFileSync(join(__dir, "../../src/data/blog-posts.ts"), "utf-8");
const distIndex = readFileSync(join(__dir, "../../dist/index.html"), "utf-8");

const extractJsonLdBlocks = (html: string): string[] =>
  Array.from(html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)).map((match) => match[1]);

const countUrls = (xml: string): number => (xml.match(/<url>/g) || []).length;

describe("internal cross-linking SEO guarantees", () => {
  it("keeps the skin to collection to trade-up collection cross-link chain in crawler HTML", () => {
    expect(serverSource).toContain('<a href="/collections/${collectionToSlug(c.name)}">');
    expect(serverSource).toContain('<a href="/collections/${collectionToSlug(primaryCollection)}">${e(collDisplay)} Collection — all skins</a>');
    expect(serverSource).toContain('<a href="/trade-ups/collection/${collectionToSlug(primaryCollection)}">${e(collDisplay)} Collection trade-ups</a>');
    expect(serverSource).toContain('<a href="/trade-ups/collection/${req.params.slug}">${e(displayName)} trade-up contracts</a>');
    expect(serverSource).toContain('<a href="/collections/${req.params.slug}">Browse all skins in the ${e(displayName)} collection</a>');
  });

  it("keeps every blog post internally linked at least twice", () => {
    const postBlocks = blogPostsSource.split(/\n\s*{\n\s*slug: /).slice(1);
    expect(postBlocks.length).toBeGreaterThanOrEqual(7);

    for (const block of postBlocks) {
      const slug = block.match(/^"([^"]+)"/)?.[1] || "unknown";
      const linkCount = (block.match(/href="\/(?!\/)/g) || []).length;
      expect(linkCount, `${slug} internal link count`).toBeGreaterThanOrEqual(2);
    }
  });

  it("keeps homepage HTML linked to the trade-ups hub", () => {
    expect(distIndex).toContain('href="/trade-ups"');
  });

  it("emits parseable JSON-LD blocks from SEO HTML", () => {
    const html = buildSeoHtml({
      title: "JSON-LD validation test",
      description: "Validates that multiple structured data objects remain parseable.",
      url: "https://tradeupbot.app/test",
      bodyHtml: "<h1>JSON-LD Test</h1>",
      jsonLd: [
        { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [] },
        { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [] },
      ],
    });

    const blocks = extractJsonLdBlocks(html);
    expect(blocks).toHaveLength(2);
    for (const block of blocks) {
      const parsed = JSON.parse(block) as { "@type"?: string };
      expect(parsed["@type"]).toBeTruthy();
    }
  });

  it("builds a complete sitemap set with all expected page types", () => {
    const base = "https://tradeupbot.app";
    const lastmod = "2026-05-13";
    const collections = Array.from({ length: 12 }, (_, index) => ({ name: `Test Collection ${index + 1}` }));
    const skins = Array.from({ length: 60 }, (_, index) => ({ name: `AK-47 | Test Skin ${index + 1}`, listing_count: 5 }));

    const index = buildSitemapIndex(base, lastmod);
    expect(index).toContain(`${base}/sitemap-static.xml`);
    expect(index).toContain(`${base}/sitemap-collections.xml`);
    expect(index).toContain(`${base}/sitemap-collection-tradeups.xml`);
    expect(index).toContain(`${base}/sitemap-skins.xml`);

    expect(countUrls(buildStaticSitemap(base, lastmod))).toBeGreaterThanOrEqual(18);
    expect(countUrls(buildCollectionSitemap(base, collections, lastmod))).toBeGreaterThanOrEqual(10);
    expect(countUrls(buildCollectionTradeUpSitemap(base, collections, lastmod))).toBeGreaterThanOrEqual(5);
    expect(countUrls(buildSkinSitemap(base, skins, lastmod))).toBeGreaterThanOrEqual(50);
  });
});
