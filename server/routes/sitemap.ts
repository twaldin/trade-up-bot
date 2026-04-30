import { Router } from "express";
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
];

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
    staticPages.push({ path: `/blog/${slug}`, priority: "0.7", freq: "monthly" });
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

export function buildSkinSitemap(base: string, skins: { name: string; listing_count: number }[], lastmod: string, minListings: number = 5): string {
  const urls = skins
    .filter(s => s.listing_count >= minListings)
    .map(s =>
      `  <url><loc>${base}/skins/${toSlug(s.name)}</loc><lastmod>${lastmod}</lastmod><changefreq>daily</changefreq><priority>0.6</priority></url>`
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
      res.send(buildCollectionSitemap(BASE, rows, lastmod));
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
      const { rows } = await pool.query(`
        SELECT s.name, COUNT(l.id)::int as listing_count
        FROM skins s LEFT JOIN listings l ON s.id = l.skin_id
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
      const { rows } = await pool.query(`
        SELECT DISTINCT ti.collection_name AS name
        FROM trade_up_inputs ti
        JOIN trade_ups t ON ti.trade_up_id = t.id
        WHERE t.listing_status = 'active'
          AND t.is_theoretical = false
          AND t.profit_cents > 0
        ORDER BY name
      `);
      const urls = rows.map((c: { name: string }) =>
        `  <url><loc>${BASE}/trade-ups/collection/${collectionToSlug(c.name)}</loc><lastmod>${lastmod}</lastmod><changefreq>daily</changefreq><priority>0.7</priority></url>`
      ).join("\n");
      res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`);
    } catch (e) {
      console.error("Sitemap collection trade-ups error:", e instanceof Error ? e.message : e);
      res.send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
    }
  });

  return router;
}
