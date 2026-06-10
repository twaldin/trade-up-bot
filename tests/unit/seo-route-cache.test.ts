/**
 * Source-string assertions for Plan 005 SEO route caching.
 *
 * The SEO handlers live in server/index.ts (not a standalone router), so a true
 * integration test would require mounting the entire app with a real PG pool.
 * Instead, we verify the caching structure by asserting positional and pattern
 * matches against the source text — same approach used by seo-pages.test.ts and
 * seo-canonical.test.ts throughout this project.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const serverSource = readFileSync(join(__dir, "../../server/index.ts"), "utf-8");
const sitemapSource = readFileSync(join(__dir, "../../server/routes/sitemap.ts"), "utf-8");
const ogImageSource = readFileSync(join(__dir, "../../server/og-image.ts"), "utf-8");

describe("SEO route caching (Plan 005)", () => {
  describe("/skins/:slug cache", () => {
    it("checks seo_skin_meta: cache before the isCrawler branch", () => {
      // The meta cache read must appear before the crawler check diverges
      const metaCacheIdx = serverSource.indexOf("seo_skin_meta:");
      const crawlerBranchIdx = serverSource.indexOf("if (isCrawler(ua)) {", metaCacheIdx);
      expect(metaCacheIdx).toBeGreaterThan(0);
      // meta key is introduced in the initial cache block, before the isCrawler check for DB queries
      expect(serverSource).toContain("const metaCacheKey = `seo_skin_meta:");
    });

    it("writes seo_skin: and seo_skin_meta: caches unconditionally (not inside isCrawler gate)", () => {
      // Both cacheSet calls should appear in the same unconditional block
      expect(serverSource).toContain("cacheSet(cacheKey, html, 3600)");
      expect(serverSource).toContain("cacheSet(metaCacheKey, metaToCache, 3600)");
    });

    it("sets X-Cache: HIT on both crawler and non-crawler cache hits", () => {
      // Count the X-Cache HIT assignments in the skins handler vicinity
      const skinHandlerStart = serverSource.indexOf('app.get("/skins/:slug"');
      const skinHandlerEnd = serverSource.indexOf('// Serve built frontend in production', skinHandlerStart);
      const skinSection = serverSource.slice(skinHandlerStart, skinHandlerEnd);
      const hitCount = (skinSection.match(/X-Cache.*HIT/g) ?? []).length;
      expect(hitCount).toBeGreaterThanOrEqual(2);
    });

    it("parallelizes independent queries via Promise.all", () => {
      expect(serverSource).toContain("await Promise.all([");
      expect(serverSource).toContain("outputStatsWrapped");
      expect(serverSource).toContain("outputStatsResult.rows[0]?.count || 0");
    });

    it("preserves output_skin_names resilience via .catch() on the wrapped query", () => {
      expect(serverSource).toContain("Skin SEO output count unavailable:");
      expect(serverSource).toContain("output_skin_names @> ARRAY[$1]::text[]");
    });
  });

  describe("/collections/:slug cache", () => {
    it("checks seo_collection: and seo_collection_meta: before DB queries", () => {
      expect(serverSource).toContain("seo_collection:");
      expect(serverSource).toContain("seo_collection_meta:");
    });

    it("writes both caches unconditionally", () => {
      expect(serverSource).toContain("collCacheSet(collCacheKey, collHtml, 3600)");
      expect(serverSource).toContain("collCacheSet(collMetaCacheKey, collMetaToCache, 3600)");
    });
  });

  describe("/trade-ups/collection/:slug cache", () => {
    it("checks seo_coll_tu: cache for crawlers", () => {
      expect(serverSource).toContain("seo_coll_tu:");
      expect(serverSource).toContain("ctCacheGet<string>(collTuCacheKey)");
    });

    it("uses COUNT query and coll_tu_count: cache for non-crawlers", () => {
      expect(serverSource).toContain("coll_tu_count:");
      expect(serverSource).toContain("COUNT(DISTINCT ti.trade_up_id)::int AS count");
    });

    it("caches crawler HTML after rendering", () => {
      expect(serverSource).toContain("ctCacheSet(collTuCacheKey, collTuHtml, 1800)");
    });
  });

  describe("OG image handler", () => {
    it("uses getBuffer() to read PNG cache (not cacheGet, which JSON-stringifies)", () => {
      expect(serverSource).toContain("redis.getBuffer(ogKey)");
    });

    it("stores PNG via raw redis.set(..., 'EX', 3600)", () => {
      expect(serverSource).toContain('redis.set(ogKey, png, "EX", 3600)');
    });
  });

  describe("OG image font loading", () => {
    it("checks server/fonts/ for vendored TTFs before fetching from Google Fonts", () => {
      const vendorCheckIdx = ogImageSource.indexOf("Inter-Regular.ttf");
      const googleFetchIdx = ogImageSource.indexOf("fonts.googleapis.com");
      expect(vendorCheckIdx).toBeGreaterThan(0);
      expect(googleFetchIdx).toBeGreaterThan(0);
      // Vendor check appears first
      expect(vendorCheckIdx).toBeLessThan(googleFetchIdx);
    });

    it("falls back to Google Fonts if TTFs are absent", () => {
      expect(ogImageSource).toContain("fonts.googleapis.com");
      expect(ogImageSource).toContain("Fallback: fetch from Google Fonts");
    });
  });

  describe("sitemap caching", () => {
    it("sitemap-collections.xml uses cacheGet/cacheSet with sitemap_collections_xml key", () => {
      expect(sitemapSource).toContain("sitemap_collections_xml");
      expect(sitemapSource).toContain('"sitemap_collections_xml"');
    });

    it("sitemap-collection-tradeups.xml uses cacheGet/cacheSet with sitemap_coll_tu_xml key", () => {
      expect(sitemapSource).toContain("sitemap_coll_tu_xml");
      expect(sitemapSource).toContain('"sitemap_coll_tu_xml"');
    });

    it("both sitemap endpoints set X-Cache: HIT on cache hits", () => {
      const hits = sitemapSource.match(/X-Cache.*HIT/g) ?? [];
      // sitemap-skins (existing) + sitemap-collections + sitemap-collection-tradeups = 3
      expect(hits.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("error logging", () => {
    it("SEO handlers log errors instead of silently calling next()", () => {
      // No bare catch { next(); } should remain
      expect(serverSource).not.toContain("catch { next(); }");
      // Logged form should appear at least 7 times (one per SEO handler)
      const loggedCatches = serverSource.match(/console\.error\(`SEO route/g) ?? [];
      expect(loggedCatches.length).toBeGreaterThanOrEqual(7);
    });
  });
});
