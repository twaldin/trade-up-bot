import { Router, type Express } from "express";
import fs from "fs";
import path from "path";
import pg from "pg";
import { toSlug, collectionToSlug } from "../../shared/slugs.js";
import { cacheGet, cacheSet } from "../redis.js";

// Blog post slugs inlined to avoid importing from src/ (frontend module boundary)
const BLOG_SLUGS = [
  "how-cs2-trade-ups-work",
  "profitable-trade-ups-theory-vs-reality",
  "cs2-trade-up-float-values-guide",
  "how-to-use-tradeupbot",
  "cs2-trade-up-marketplace-fees",
  "best-cs2-collections-knife-trade-ups-2026",
  "cs2-trade-up-probability-expected-value",
  "cs2-trade-up-calculator-guide",
  "best-cs2-trade-up-simulator",
  "why-cs2-trade-up-calculators-disagree",
  "cs2-output-float-profit-impact",
];

export const ROBOTS_TXT = [
  "User-agent: *",
  "Allow: /",
  "Disallow: /auth/",
  "Disallow: /api/",
  "Sitemap: https://tradeupbot.app/sitemap.xml",
].join("\n");

export function registerRobotsTxtRoute(app: Express): void {
  app.get("/robots.txt", (_req, res) => {
    res.type("text/plain");
    res.send(ROBOTS_TXT);
  });
}

export function buildSitemapIndex(base: string, lastmod: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>${base}/sitemap-static.xml</loc><lastmod>${lastmod}</lastmod></sitemap>
  <sitemap><loc>${base}/sitemap-collections.xml</loc><lastmod>${lastmod}</lastmod></sitemap>
  <sitemap><loc>${base}/sitemap-collection-tradeups.xml</loc><lastmod>${lastmod}</lastmod></sitemap>
  <sitemap><loc>${base}/sitemap-skins.xml</loc><lastmod>${lastmod}</lastmod></sitemap>
</sitemapindex>`;
}

export function buildStaticSitemap(base: string, lastmod: string): string {
  const staticPages = [
    { path: "/", priority: "1.0", freq: "weekly" },
    { path: "/trade-ups", priority: "0.9", freq: "daily" },
    { path: "/skins", priority: "0.8", freq: "daily" },
    { path: "/collections", priority: "0.8", freq: "weekly" },
    { path: "/calculator", priority: "0.8", freq: "monthly" },
    { path: "/faq", priority: "0.7", freq: "monthly" },
    { path: "/features", priority: "0.7", freq: "monthly" },
    { path: "/pricing", priority: "0.7", freq: "monthly" },
    { path: "/blog", priority: "0.8", freq: "weekly" },
    { path: "/terms", priority: "0.3", freq: "yearly" },
    { path: "/privacy", priority: "0.3", freq: "yearly" },
  ];

  for (const slug of BLOG_SLUGS) {
    // Match the trailing-slash form the server actually serves so the
    // sitemap, canonical, and 301-target URL all agree (#95).
    staticPages.push({ path: `/blog/${slug}/`, priority: "0.7", freq: "monthly" });
  }

  const urls = staticPages.map(p =>
    `  <url><loc>${base}${p.path}</loc><lastmod>${lastmod}</lastmod><changefreq>${p.freq}</changefreq><priority>${p.priority}</priority></url>`
  ).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
}

export function buildCollectionSitemap(base: string, collections: { name: string }[], lastmod: string): string {
  const urls = collections.map(c =>
    `  <url><loc>${base}/collections/${collectionToSlug(c.name)}</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>`
  ).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
}

export interface SkinSitemapRow {
  name: string;
  listing_count: number;
  /** True when the skin is an input of at least one active, profitable, non-theoretical trade-up. */
  is_tradeup_input?: boolean;
  /** True when the skin is produced as an output of such a trade-up. */
  is_tradeup_output?: boolean;
  /** Count of price observations in the trailing 30 days (recent market liquidity). */
  obs30?: number;
}

/**
 * A skin page earns a sitemap slot (and index-worthiness) only when it carries content a
 * generic price-catalog page would not: it participates in the trade-up graph, or it has
 * substantive recent price history. Listing count alone is a near-useless signal here —
 * nearly every skin has 100+ listings — so it is only a spam floor, not the bar.
 */
export function isSkinIndexworthy(row: SkinSitemapRow, minListings = 10, minObs = 20): boolean {
  if ((row.listing_count ?? 0) < minListings) return false;
  return Boolean(row.is_tradeup_input) || Boolean(row.is_tradeup_output) || (row.obs30 ?? 0) >= minObs;
}

export function buildSkinSitemap(base: string, skins: SkinSitemapRow[], lastmod: string, minListings = 10, minObs = 20): string {
  const urls = skins
    .filter(s => isSkinIndexworthy(s, minListings, minObs))
    .map(s =>
      `  <url><loc>${base}/skins/${toSlug(s.name)}</loc><lastmod>${lastmod}</lastmod><changefreq>daily</changefreq><priority>0.6</priority></url>`
    ).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
}

export function buildCollectionTradeUpSitemap(base: string, collections: { name: string }[], lastmod: string): string {
  const urls = collections.map(c =>
    `  <url><loc>${base}/trade-ups/collection/${collectionToSlug(c.name)}</loc><lastmod>${lastmod}</lastmod><changefreq>daily</changefreq><priority>0.7</priority></url>`
  ).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
}

export function sitemapRouter(pool: pg.Pool): Router {
  const router = Router();
  const BASE = "https://tradeupbot.app";

  router.get("/sitemap.xml", (_req, res) => {
    const lastmod = new Date().toISOString().split("T")[0];
    res.setHeader("Content-Type", "application/xml");
    res.send(buildSitemapIndex(BASE, lastmod));
  });

  router.get("/sitemap-static.xml", (_req, res) => {
    const lastmod = new Date().toISOString().split("T")[0];
    res.setHeader("Content-Type", "application/xml");
    res.send(buildStaticSitemap(BASE, lastmod));
  });

  router.get("/sitemap-collections.xml", async (_req, res) => {
    const lastmod = new Date().toISOString().split("T")[0];
    res.setHeader("Content-Type", "application/xml");
    try {
      const cached = await cacheGet<string>("sitemap_collections_xml").catch(() => null);
      if (cached) {
        res.setHeader("X-Cache", "HIT");
        res.send(cached);
        return;
      }
      const { rows } = await pool.query(`
        SELECT c.name
        FROM collections c
        WHERE EXISTS (
          SELECT 1
          FROM skin_collections sc
          JOIN listings l ON l.skin_id = sc.skin_id
          WHERE sc.collection_id = c.id
        )
        ORDER BY c.name
      `);
      const xml = buildCollectionSitemap(BASE, rows, lastmod);
      await cacheSet("sitemap_collections_xml", xml, 3600).catch(() => {});
      res.send(xml);
    } catch (e) {
      console.error("Sitemap collections error:", e instanceof Error ? e.message : e);
      res.send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
    }
  });

  router.get("/sitemap-skins.xml", async (_req, res) => {
    const lastmod = new Date().toISOString().split("T")[0];
    res.setHeader("Content-Type", "application/xml");
    try {
      const cached = await cacheGet<string>("sitemap_skins_xml").catch(() => null);
      if (cached) {
        res.setHeader("X-Cache", "HIT");
        res.send(cached);
        return;
      }
      // Signals per skin: listing count (spam floor), recent price-observation volume,
      // and whether the skin participates in the profitable trade-up graph. Only skins
      // that clear the quality bar (see isSkinIndexworthy) are advertised — a generic
      // price-lookup page adds no unique value on a young site and dilutes crawl budget.
      // Input/output membership is computed ONCE via CTEs, not per-skin correlated
      // EXISTS: at prod scale (6.9M trade_up_inputs, 760K trade_ups) the correlated
      // form ran >87s and 504'd behind nginx's 60s proxy timeout (2026-07-20).
      // This CTE form runs in ~3s and returns identical signals.
      const { rows } = await pool.query(`
        WITH inp AS (
          SELECT DISTINCT ti.skin_name
          FROM trade_up_inputs ti
          JOIN trade_ups t ON ti.trade_up_id = t.id
          WHERE t.listing_status = 'active' AND t.is_theoretical = false AND t.profit_cents > 0
        ),
        outp AS (
          SELECT DISTINCT unnest(output_skin_names) AS skin_name
          FROM trade_ups
          WHERE listing_status = 'active' AND is_theoretical = false AND profit_cents > 0
        ),
        po AS (
          SELECT skin_name, COUNT(*) AS obs30
          FROM price_observations
          WHERE observed_at > NOW() - INTERVAL '30 days'
          GROUP BY skin_name
        )
        SELECT s.name,
               COUNT(l.id)::int AS listing_count,
               COALESCE(MAX(po.obs30), 0)::int AS obs30,
               BOOL_OR(inp.skin_name IS NOT NULL) AS is_tradeup_input,
               BOOL_OR(outp.skin_name IS NOT NULL) AS is_tradeup_output
        FROM skins s
        LEFT JOIN listings l ON s.id = l.skin_id
        LEFT JOIN po ON po.skin_name = s.name
        LEFT JOIN inp ON inp.skin_name = s.name
        LEFT JOIN outp ON outp.skin_name = s.name
        WHERE s.stattrak = false
        GROUP BY s.name
        ORDER BY s.name
      `);
      const xml = buildSkinSitemap(BASE, rows, lastmod);
      await cacheSet("sitemap_skins_xml", xml, 3600).catch(() => {});
      res.send(xml);
    } catch (e) {
      console.error("Sitemap skins error:", e instanceof Error ? e.message : e);
      res.send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
    }
  });

  // Collection trade-up landing pages: /trade-ups/collection/{slug}
  router.get("/sitemap-collection-tradeups.xml", async (_req, res) => {
    const lastmod = new Date().toISOString().split("T")[0];
    res.setHeader("Content-Type", "application/xml");
    try {
      const cached = await cacheGet<string>("sitemap_coll_tu_xml").catch(() => null);
      if (cached) {
        res.setHeader("X-Cache", "HIT");
        res.send(cached);
        return;
      }
      const { rows } = await pool.query(`
        SELECT DISTINCT ti.collection_name AS name
        FROM trade_up_inputs ti
        JOIN trade_ups t ON ti.trade_up_id = t.id
        WHERE t.listing_status = 'active'
          AND t.is_theoretical = false
          AND t.profit_cents > 100
        ORDER BY name
      `);
      const xml = buildCollectionTradeUpSitemap(BASE, rows, lastmod);
      await cacheSet("sitemap_coll_tu_xml", xml, 3600).catch(() => {});
      res.send(xml);
    } catch (e) {
      console.error("Sitemap collection trade-ups error:", e instanceof Error ? e.message : e);
      res.send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
    }
  });

  return router;
}
