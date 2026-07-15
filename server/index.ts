import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { initDb, createTables } from "./db.js";
import { initRedis } from "./redis.js";
import { setupAuth } from "./auth.js";
import { CASE_KNIFE_MAP, GLOVE_GEN_SKINS } from "./engine/knife-data.js";
import { getGlobalStats, statusRouter } from "./routes/status.js";
import { tradeUpsRouter } from "./routes/trade-ups.js";
import { dataRouter } from "./routes/data.js";
import { collectionsRouter } from "./routes/collections.js";
import { snapshotsRouter } from "./routes/snapshots.js";
import { calculatorRouter } from "./routes/calculator.js";
import { claimsRouter } from "./routes/claims.js";
import { stripeRouter } from "./routes/stripe.js";
import { discordRouter } from "./routes/discord.js";
import myTradeUpsRouter from "./routes/my-trade-ups.js";
import { registerRobotsTxtRoute, sitemapRouter } from "./routes/sitemap.js";
import { listingSniperRouter } from "./routes/listing-sniper.js";
import { buildSeoHtml, dedupeHead, isCrawler, injectMetaIntoSpa, escapeHtml, renderTradeUpDetail, renderCollectionsHub, renderTradeUpsHub, deletedTradeUpStatus, buildSkinResearchParagraphs } from "./seo.js";
import { toSlug, collectionToSlug } from "../shared/slugs.js";
import { TRADE_UP_TYPE_LABELS } from "../shared/types.js";
import { blogPosts } from "../src/data/blog-posts.js";

// Build reverse map: knife/glove weapon type → case names
const knifeTypeToCases = new Map<string, string[]>();
for (const [caseName, mapping] of Object.entries(CASE_KNIFE_MAP)) {
  for (const knifeType of mapping.knifeTypes) {
    if (!knifeTypeToCases.has(knifeType)) knifeTypeToCases.set(knifeType, []);
    knifeTypeToCases.get(knifeType)!.push(caseName);
  }
  if (mapping.gloveGen) {
    const genSkins = GLOVE_GEN_SKINS[mapping.gloveGen];
    if (genSkins) {
      for (const gloveType of Object.keys(genSkins)) {
        if (!knifeTypeToCases.has(gloveType)) knifeTypeToCases.set(gloveType, []);
        knifeTypeToCases.get(gloveType)!.push(caseName);
      }
    }
  }
}

// Build forward map: collection name → knife/glove pool (with finish data for filtering)
const collectionKnifePool = new Map<string, { knifeTypes: string[]; gloveTypes: string[]; knifeFinishes: string[]; gloveFinishes: string[]; finishCount: number }>();
for (const [collectionName, mapping] of Object.entries(CASE_KNIFE_MAP)) {
  const knPool: { knifeTypes: string[]; gloveTypes: string[]; knifeFinishes: string[]; gloveFinishes: string[]; finishCount: number } = {
    knifeTypes: [...mapping.knifeTypes],
    knifeFinishes: [...(mapping.knifeFinishes || [])],
    gloveTypes: [],
    gloveFinishes: [],
    finishCount: mapping.knifeFinishes?.length ?? 0,
  };
  if (mapping.gloveGen) {
    const genSkins = GLOVE_GEN_SKINS[mapping.gloveGen];
    if (genSkins) {
      knPool.gloveTypes = Object.keys(genSkins);
      knPool.gloveFinishes = Object.values(genSkins).flat();
    }
  }
  collectionKnifePool.set(collectionName, knPool);
}

// Load .env
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^(\w+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
}

import compression from "compression";
import expressStaticGzip from "express-static-gzip";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import type { NextFunction } from "express";
import { redirectWwwHost } from "./redirect-www.js";
import { registerBlogRoutes } from "./blog-routes.js";
import { registerCanonicalRedirectRoutes } from "./canonical-redirects.js";
import { STATIC_SEO_PAGES } from "./static-seo-pages.js";

const app = express();
const PORT = 3001;

app.use(redirectWwwHost);
app.use(compression());
app.use(cors({
  origin: [
    "https://tradeupbot.app",
    "https://www.tradeupbot.app",
    ...(process.env.NODE_ENV !== "production" ? ["http://localhost:5173", "http://localhost:3001"] : []),
  ],
  credentials: true,
}));
// Rate limiting: use x-real-ip from nginx (never req.ip — triggers ERR_ERL_KEY_GEN_IPV6)
const rlKey = (req: express.Request) => (req.headers["x-real-ip"] as string) || "unknown";
app.use(rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false, keyGenerator: rlKey }));
app.use("/auth", rateLimit({ windowMs: 60_000, max: 10, keyGenerator: rlKey }));
app.use("/api/subscribe", rateLimit({ windowMs: 60_000, max: 5, keyGenerator: rlKey }));
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://www.googletagmanager.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "https://avatars.steamstatic.com", "https://community.fastly.steamstatic.com", "data:"],
      connectSrc: ["'self'", "https://checkout.stripe.com", "https://www.google-analytics.com", "https://analytics.google.com", "https://www.googletagmanager.com", "https://open.er-api.com"],
      frameSrc: ["https://checkout.stripe.com"],
    },
  },
}));
// Stripe webhook needs raw body for signature verification — capture it before JSON parsing
app.use((req, res, next) => {
  if (req.path === "/api/stripe-webhook") {
    express.raw({ type: "application/json" })(req, res, next);
  } else {
    express.json()(req, res, next);
  }
});

// Default no-cache for HTML/SPA routes so browsers revalidate after deploys and
// pick up new asset hashes. Content-hashed /assets/* files keep their immutable
// long cache (set by the express.static setHeaders at the end of the routing).
// Skipped for /api and /assets so those retain their own cache semantics.
app.use((req, res, next) => {
  if (!req.path.startsWith("/api") && !req.path.startsWith("/assets")) {
    res.setHeader("Cache-Control", "no-cache, must-revalidate");
  }
  next();
});

// Serve robots.txt dynamically before the dist/ static middleware so stale
// build artifacts cannot override the canonical crawler directives.
registerRobotsTxtRoute(app);
registerCanonicalRedirectRoutes(app);

// Async startup: initialize PostgreSQL pool and create tables
(async () => {
  if (process.env.NODE_ENV === "production" && !(process.env.BASE_URL || "").startsWith("https")) {
    throw new Error("BASE_URL must be set to an https URL in production");
  }

  const pool: pg.Pool = initDb();
  if (process.env.SKIP_STARTUP_MIGRATIONS === "1") {
    console.log("Skipping startup migrations");
  } else {
    await createTables(pool);
  }
  initRedis();

  // Auth (Steam OpenID + sessions)
  await setupAuth(app, pool);

  // Mount route modules — all routes receive the pg pool
  app.use(statusRouter(pool));
  app.use(tradeUpsRouter(pool));
  app.use(dataRouter(pool, knifeTypeToCases, collectionKnifePool));
  app.use(collectionsRouter(pool, collectionKnifePool));
  app.use(snapshotsRouter(pool));
  app.use(calculatorRouter(pool));
  app.use(claimsRouter(pool));
  app.use(myTradeUpsRouter(pool));
  app.use(stripeRouter(pool));
  app.use(discordRouter(pool));
  app.use(sitemapRouter(pool));
  app.use(listingSniperRouter(pool));

  // Dynamic OG image for shareable trade-up pages
  const { generateOgImage } = await import("./og-image.js");

  app.get("/og/trade-ups/:id.png", async (req, res) => {
    try {
      // Redis PNG cache — use raw getBuffer/set on the ioredis client to avoid JSON corruption
      const { getRedis } = await import("./redis.js");
      const redis = getRedis();
      const ogKey = `og:tradeup:${req.params.id}`;
      if (redis) {
        const cached = await redis.getBuffer(ogKey).catch(() => null);
        if (cached) {
          res.setHeader("Content-Type", "image/png");
          res.setHeader("Cache-Control", "public, max-age=3600");
          res.send(cached);
          return;
        }
      }

      const { rows: [row] } = await pool.query(
        "SELECT id, type, total_cost_cents, expected_value_cents, profit_cents, roi_percentage, chance_to_profit, best_case_cents, worst_case_cents FROM trade_ups WHERE id = $1",
        [req.params.id]
      );
      if (!row) { res.status(404).end(); return; }
      const { rows: inputs } = await pool.query(
        "SELECT skin_name, condition, collection_name FROM trade_up_inputs WHERE trade_up_id = $1",
        [row.id]
      );
      const png = await generateOgImage({ ...row, inputs });
      // Cache the PNG buffer in Redis — must use raw set (not cacheSet) to avoid JSON serialization
      if (redis) redis.set(ogKey, png, "EX", 3600).catch(() => {});
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.send(png);
    } catch (e) {
      console.error("OG image error:", e instanceof Error ? e.message : e);
      res.status(500).end();
    }
  });

  // SEO: collection trade-up landing pages — /trade-ups/collection/:slug
  // Shows best trade-ups per collection grouped by rarity tier. Stable URLs, daily-updating content.
  app.get("/trade-ups/collection/:slug", async (req, res, next) => {
    const ua = req.headers["user-agent"] || "";
    try {
      // Redis cache: 1800s TTL. seo_coll_tu:<slug> full crawler HTML; coll_tu_count:<collectionName> non-crawler count.
      const collTuCacheKey = `seo_coll_tu:${req.params.slug}`;
      const { cacheGet: ctCacheGet, cacheSet: ctCacheSet } = await import("./redis.js");

      // Check crawler cache first
      if (isCrawler(ua)) {
        try {
          const cached = await ctCacheGet<string>(collTuCacheKey);
          if (cached) {
            res.setHeader("Content-Type", "text/html");
            res.setHeader("X-Cache", "HIT");
            res.send(cached);
            return;
          }
        } catch { /* Redis unavailable */ }
      }

      const { getCollectionSlugMap } = await import("./routes/data.js");
      const slugMap = await getCollectionSlugMap(pool);
      const collectionName = slugMap.get(req.params.slug);
      if (!collectionName) {
        res.status(404).send("Collection trade-up page not found");
        return;
      }
      const displayName = collectionName.replace(/^The\s+/i, "").replace(/\s+Collection$/i, "");
      const pageUrl = `https://tradeupbot.app/trade-ups/collection/${req.params.slug}`;

      if (!isCrawler(ua)) {
        // Non-crawler: use a cheap cached COUNT instead of the unbounded DISTINCT ON join.
        // Cache key is per-collection (not per-slug) since count depends on collectionName.
        const nonCrawlerCountKey = `coll_tu_count:${collectionName}`;
        let tuCount = 0;
        try {
          const cachedCount = await ctCacheGet<number>(nonCrawlerCountKey);
          if (cachedCount !== null) {
            tuCount = cachedCount;
          } else {
            const { rows: [countRow] } = await pool.query(`
              SELECT COUNT(DISTINCT ti.trade_up_id)::int AS count
              FROM trade_up_inputs ti JOIN trade_ups t ON ti.trade_up_id = t.id
              WHERE ti.collection_name = $1 AND t.listing_status = 'active' AND t.is_theoretical = false AND t.profit_cents > 100
            `, [collectionName]);
            tuCount = countRow?.count || 0;
            ctCacheSet(nonCrawlerCountKey, tuCount, 1800).catch(() => {});
          }
        } catch { /* Redis unavailable — tuCount stays 0 */ }
        const shellHtmlLocal: string | undefined = req.app.locals.shellHtml;
        if (!shellHtmlLocal) return next();
        res.setHeader("Content-Type", "text/html");
        res.send(injectMetaIntoSpa(shellHtmlLocal, {
          title: `Best ${displayName} Trade-Ups — Profitable CS2 Contracts | TradeUpBot`,
          description: `${tuCount} profitable trade-ups from the ${displayName} collection. Real listings from CSFloat, DMarket, Skinport.`,
          url: pageUrl,
        }));
        return;
      }

      // Crawler path: full query, build HTML, cache result.
      // LIMIT 120 = 6 types × 20 shown; profit_cents > 100 removes penny-profit noise.
      // preserved_at filter excludes stale trade-ups (mirrors detail handler staleness check).
      const { rows: tradeUps } = await pool.query(`
        SELECT DISTINCT ON (t.id) t.id, t.type, t.total_cost_cents, t.profit_cents,
               t.roi_percentage, t.chance_to_profit, t.best_case_cents, t.worst_case_cents
        FROM trade_up_inputs ti JOIN trade_ups t ON ti.trade_up_id = t.id
        WHERE ti.collection_name = $1 AND t.listing_status = 'active' AND t.is_theoretical = false AND t.profit_cents > 100
          AND (t.preserved_at IS NULL OR t.preserved_at > NOW() - INTERVAL '7 days')
        ORDER BY t.id, t.profit_cents DESC
        LIMIT 120
      `, [collectionName]);

      // Group by type for crawler HTML
      const e = escapeHtml;
      const byType = new Map<string, typeof tradeUps>();
      for (const tu of tradeUps) {
        if (!byType.has(tu.type)) byType.set(tu.type, []);
        byType.get(tu.type)!.push(tu);
      }

      let tablesHtml = "";
      const typeOrder = ["covert_knife", "classified_covert", "restricted_classified", "milspec_restricted", "industrial_milspec", "consumer_industrial"];
      for (const type of typeOrder) {
        const tus = byType.get(type);
        if (!tus || tus.length === 0) continue;
        const sorted = [...tus].sort((a, b) => b.profit_cents - a.profit_cents).slice(0, 20);
        const label = TRADE_UP_TYPE_LABELS[type] || type;
        const rows = sorted.map((t: { id: number; total_cost_cents: number; profit_cents: number; roi_percentage: number; chance_to_profit: number }) =>
          `<tr><td><a href="/trade-ups/${t.id}">#${t.id}</a></td><td>$${(t.total_cost_cents / 100).toFixed(2)}</td><td>$${(t.profit_cents / 100).toFixed(2)}</td><td>${t.roi_percentage.toFixed(1)}%</td><td>${Math.round((t.chance_to_profit ?? 0) * 100)}%</td></tr>`
        ).join("");
        tablesHtml += `<h2>${e(label)} Trade-Ups (${tus.length})</h2><table><thead><tr><th>ID</th><th>Cost</th><th>Profit</th><th>ROI</th><th>Chance</th></tr></thead><tbody>${rows}</tbody></table>`;
      }

      const bestProfit = tradeUps.length > 0 ? Math.max(...tradeUps.map(t => t.profit_cents)) : 0;
      const collTuBreadcrumb = `<nav aria-label="Breadcrumb"><ol>`
        + `<li><a href="/">Home</a></li>`
        + `<li><a href="/trade-ups">Trade-Ups</a></li>`
        + `<li><a href="/collections/${req.params.slug}">${e(displayName)} Collection</a></li>`
        + `<li>${e(displayName)} Trade-Ups</li>`
        + `</ol></nav>`;
      const collTuRelated = `<nav aria-label="Related pages"><h2>Related Pages</h2><ul>`
        + `<li><a href="/collections/${req.params.slug}">Browse all skins in the ${e(displayName)} collection</a></li>`
        + `<li><a href="/trade-ups">All profitable CS2 trade-ups</a></li>`
        + `<li><a href="/collections">All CS2 collections</a></li>`
        + `</ul></nav>`;
      const bodyHtml = collTuBreadcrumb
        + `<h1>${e(displayName)} Trade-Ups</h1>`
        + `<p>${tradeUps.length} profitable trade-up contracts using skins from the <a href="/collections/${req.params.slug}">${e(displayName)} collection</a>. Updated daily from real listings on CSFloat, DMarket, and Skinport.</p>`
        + (bestProfit > 0 ? `<p>Best profit: <strong>$${(bestProfit / 100).toFixed(2)}</strong></p>` : "")
        + tablesHtml
        + `<p><a href="/trade-ups?collection=${encodeURIComponent(collectionName)}">View all ${e(displayName)} trade-ups with live data and filters</a></p>`
        + collTuRelated;

      // Top trade-ups for ItemList JSON-LD (up to 10, by profit)
      const itemListTus = [...tradeUps].sort((a, b) => b.profit_cents - a.profit_cents).slice(0, 10);
      const jsonLd: Record<string, unknown>[] = [
        {
          "@context": "https://schema.org", "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: "https://tradeupbot.app/" },
            { "@type": "ListItem", position: 2, name: "Trade-Ups", item: "https://tradeupbot.app/trade-ups" },
            { "@type": "ListItem", position: 3, name: `${displayName} Collection`, item: `https://tradeupbot.app/collections/${req.params.slug}` },
            { "@type": "ListItem", position: 4, name: "Trade-Ups" },
          ],
        },
        {
          "@context": "https://schema.org", "@type": "ItemList",
          name: `Best ${displayName} CS2 Trade-Up Contracts`,
          description: `Top profitable trade-up contracts using skins from the ${displayName} collection, ranked by profit.`,
          numberOfItems: tradeUps.length,
          itemListElement: itemListTus.map((t, i) => ({
            "@type": "ListItem",
            position: i + 1,
            url: `https://tradeupbot.app/trade-ups/${t.id}`,
            name: `${TRADE_UP_TYPE_LABELS[t.type] || t.type} — $${(t.profit_cents / 100).toFixed(2)} profit (${t.roi_percentage.toFixed(1)}% ROI)`,
          })),
        },
      ];

      const collTuHtml = buildSeoHtml({
        title: `Best ${displayName} Trade-Ups — Profitable CS2 Contracts | TradeUpBot`,
        description: `${tradeUps.length} profitable trade-ups from the ${displayName} collection.${bestProfit > 0 ? ` Best profit: $${(bestProfit / 100).toFixed(2)}.` : ""} Real listings from CSFloat, DMarket, Skinport.`,
        url: pageUrl,
        bodyHtml,
        jsonLd,
      });
      ctCacheSet(collTuCacheKey, collTuHtml, 1800).catch(() => {});
      // Also update the count cache so next non-crawler sees the fresh value
      ctCacheSet(`coll_tu_count:${collectionName}`, tradeUps.length, 1800).catch(() => {});
      res.send(collTuHtml);
    } catch (err) { console.error(`SEO route ${req.path} failed:`, err instanceof Error ? err.message : err); next(); }
  });

  // Dynamic OG tags + SEO for shareable trade-up pages (social/crawler bots)
  app.get("/trade-ups/:id", async (req, res, next) => {
    const ua = req.headers["user-agent"] || "";
    try {
      const { rows: [row] } = await pool.query(
        "SELECT id, type, total_cost_cents, profit_cents, roi_percentage, chance_to_profit, listing_status, preserved_at, outcomes_json FROM trade_ups WHERE id = $1",
        [req.params.id]
      );
      if (!row) {
        // Deleted/purged numeric IDs -> 410 Gone (drains from the index faster than 404);
        // malformed/non-numeric -> 404. SEO detail route only; never the API or landing pages.
        const status = deletedTradeUpStatus(String(req.params.id));
        res.status(status).set("X-Robots-Tag", "noindex").send(
          status === 410 ? "Trade-up no longer available" : "Trade-up not found"
        );
        return;
      }
      const typeLabel = TRADE_UP_TYPE_LABELS[row.type] || row.type;
      const profit = (row.profit_cents / 100).toFixed(2);
      const cost = (row.total_cost_cents / 100).toFixed(2);
      const chance = Math.round((row.chance_to_profit ?? 0) * 100);
      const roi = row.roi_percentage?.toFixed(1) ?? "0";

      const isStale = row.listing_status === "stale"
        || (row.preserved_at && Date.now() - new Date(row.preserved_at).getTime() > 7 * 24 * 60 * 60 * 1000);

      const { rows: inputs } = await pool.query(
        "SELECT skin_name, condition, collection_name, price_cents FROM trade_up_inputs WHERE trade_up_id = $1",
        [row.id]
      );

      const outcomes = JSON.parse(row.outcomes_json || "[]") as Array<{
        skin_name: string; probability: number; predicted_condition: string; estimated_price_cents: number;
      }>;

      const collections = [...new Set(inputs.map((i: { collection_name: string }) => i.collection_name))];
      const related = [
        ...collections.map((c: string) => ({
          label: `${c.replace(/^The\s+/i, "").replace(/\s+Collection$/i, "")} Collection Trade-Ups`,
          url: `/trade-ups/collection/${c.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
        })).slice(0, 2),
        { label: "All Profitable CS2 Trade-Ups", url: "/trade-ups" },
        { label: "Browse CS2 Collections", url: "/collections" },
      ];

      const inputNames = inputs.slice(0, 3).map((i: { skin_name: string }) => i.skin_name).join(", ");

      const meta = {
        title: `${typeLabel} Trade-Up — $${profit} profit (${chance}% chance) | TradeUpBot`,
        description: `$${cost} cost, ${roi}% ROI. Inputs: ${inputNames}. Found on TradeUpBot.`,
        url: `https://tradeupbot.app/trade-ups/${req.params.id}`,
        ogImage: `https://tradeupbot.app/og/trade-ups/${req.params.id}.png`,
        robots: isStale ? "noindex, follow" : "index, follow",
        bodyHtml: renderTradeUpDetail(
          { id: row.id, type: row.type, total_cost_cents: row.total_cost_cents, profit_cents: row.profit_cents, roi_percentage: row.roi_percentage, chance_to_profit: row.chance_to_profit },
          inputs,
          outcomes,
          related,
        ),
      };

      if (isCrawler(ua)) {
        res.send(buildSeoHtml(meta));
      } else {
        const shellHtmlLocal: string | undefined = req.app.locals.shellHtml;
        if (!shellHtmlLocal) return next();
        res.setHeader("Content-Type", "text/html");
        res.send(injectMetaIntoSpa(shellHtmlLocal, meta));
      }
    } catch (err) { console.error(`SEO route ${req.path} failed:`, err instanceof Error ? err.message : err); next(); }
  });

  // SEO: crawler handler for /collections/:slug pages — enriched
  app.get("/collections/:slug", async (req, res, next) => {
    const ua = req.headers["user-agent"] || "";
    try {
      // Redis cache: 3600s TTL. seo_collection: full crawler HTML; seo_collection_meta: meta object.
      // _v2 suffix: bumped for plan 025 best-profit summary so the new HTML serves immediately.
      const collCacheKey = `seo_collection_v2:${req.params.slug}`;
      const collMetaCacheKey = `seo_collection_meta_v2:${req.params.slug}`;
      const { cacheGet: collCacheGet, cacheSet: collCacheSet } = await import("./redis.js");
      if (isCrawler(ua)) {
        try {
          const cached = await collCacheGet<string>(collCacheKey);
          if (cached) {
            res.setHeader("Content-Type", "text/html");
            res.setHeader("X-Cache", "HIT");
            res.send(cached);
            return;
          }
        } catch { /* Redis unavailable */ }
      } else {
        try {
          const cachedMeta = await collCacheGet<{ title: string; description: string; url: string; ogImage?: string }>(collMetaCacheKey);
          if (cachedMeta) {
            const shellHtmlLocal: string | undefined = req.app.locals.shellHtml;
            if (!shellHtmlLocal) return next();
            res.setHeader("Content-Type", "text/html");
            res.setHeader("X-Cache", "HIT");
            res.send(injectMetaIntoSpa(shellHtmlLocal, cachedMeta));
            return;
          }
        } catch { /* Redis unavailable */ }
      }

      const { getCollectionSlugMap } = await import("./routes/data.js");
      const slugMap = await getCollectionSlugMap(pool);
      const collectionName = slugMap.get(req.params.slug);
      if (!collectionName) {
        res.status(404).send("Collection not found");
        return;
      }
      const displayName = collectionName.replace(/^The\s+/i, "").replace(/\s+Collection$/i, "");

      // Collection image
      const { rows: [collRow] } = await pool.query(
        "SELECT image_url FROM collections WHERE name = $1", [collectionName]
      );
      const collectionImageUrl = collRow?.image_url || null;

      // All skins in this collection with listing counts
      const { rows: skins } = await pool.query(`
        SELECT s.name, s.weapon, s.rarity, COUNT(l.id)::int as listing_count, MIN(l.price_cents) as min_price
        FROM skin_collections sc
        JOIN collections c ON sc.collection_id = c.id
        JOIN skins s ON sc.skin_id = s.id
        LEFT JOIN listings l ON s.id = l.skin_id
        WHERE c.name = $1 AND s.stattrak = false
        GROUP BY s.name, s.weapon, s.rarity
        ORDER BY CASE s.rarity
          WHEN 'Covert' THEN 1 WHEN 'Classified' THEN 2 WHEN 'Restricted' THEN 3
          WHEN 'Mil-Spec' THEN 4 WHEN 'Industrial Grade' THEN 5 WHEN 'Consumer Grade' THEN 6
          ELSE 7 END, s.name
      `, [collectionName]);

      const totalListings = skins.reduce((sum: number, s: { listing_count: number }) => sum + s.listing_count, 0);

      // Profitable trade-up count for this collection. Public-facing claim, so it uses the
      // strict predicate (profit_cents > 100 + non-stale) that the trade-up landing page uses,
      // not the loose profit_cents > 0 — penny/stale contracts must not inflate the count.
      const { rows: [tuStats] } = await pool.query(`
        SELECT COUNT(DISTINCT ti.trade_up_id)::int as tu_count
        FROM trade_up_inputs ti JOIN trade_ups t ON ti.trade_up_id = t.id
        WHERE ti.collection_name = $1 AND t.listing_status = 'active' AND t.is_theoretical = false
          AND t.profit_cents > 100
          AND (t.preserved_at IS NULL OR t.preserved_at > NOW() - INTERVAL '7 days')
      `, [collectionName]);
      const tuCount = tuStats?.tu_count || 0;

      // Best profitable trade-up RIGHT NOW for this collection — the float-exact moat surface.
      // Same strict predicate; one row, highest profit. Server-rendered so the landing page is
      // uniquely valuable (real, fresh, float-exact priced) rather than a templated catalog.
      const { rows: [bestTu] } = await pool.query(`
        SELECT t.id, t.profit_cents, t.roi_percentage, t.chance_to_profit
        FROM trade_up_inputs ti JOIN trade_ups t ON ti.trade_up_id = t.id
        WHERE ti.collection_name = $1 AND t.listing_status = 'active' AND t.is_theoretical = false
          AND t.profit_cents > 100
          AND (t.preserved_at IS NULL OR t.preserved_at > NOW() - INTERVAL '7 days')
        ORDER BY t.profit_cents DESC
        LIMIT 1
      `, [collectionName]);

      // Group skins by rarity
      const e = escapeHtml;
      const rarityOrder = ["Covert", "Classified", "Restricted", "Mil-Spec", "Industrial Grade", "Consumer Grade"];
      const grouped = new Map<string, typeof skins>();
      for (const s of skins) {
        if (!grouped.has(s.rarity)) grouped.set(s.rarity, []);
        grouped.get(s.rarity)!.push(s);
      }

      let skinTablesHtml = "";
      for (const rarity of rarityOrder) {
        const rs = grouped.get(rarity);
        if (!rs || rs.length === 0) continue;
        const rows = rs.map((s: { name: string; weapon: string; listing_count: number; min_price: number | null }) =>
          `<tr><td><a href="/skins/${toSlug(s.name)}">${e(s.name)}</a></td><td>${e(s.weapon)}</td><td>${s.listing_count}</td><td>${s.min_price ? "$" + (s.min_price / 100).toFixed(2) : "N/A"}</td></tr>`
        ).join("");
        skinTablesHtml += `<h2>${e(rarity)} (${rs.length})</h2><table><thead><tr><th>Skin</th><th>Weapon</th><th>Listings</th><th>From</th></tr></thead><tbody>${rows}</tbody></table>`;
      }

      const tuLink = `<p><strong>${tuCount} profitable trade-ups</strong> currently use skins from this collection. <a href="/trade-ups/collection/${req.params.slug}">Explore ${displayName} trade-up contracts</a></p>`;

      // Float-exact "best right now" summary — the differentiator. Only rendered when a genuinely
      // profitable, non-stale contract exists, so it never shows a penny/stale claim.
      const bestProfitHtml = bestTu
        ? `<p><strong>Best profitable ${e(displayName)} trade-up right now:</strong> `
          + `+$${(bestTu.profit_cents / 100).toFixed(2)} profit at ${Math.round((bestTu.chance_to_profit ?? 0) * 100)}% chance to profit`
          + `${bestTu.roi_percentage != null ? ` (${bestTu.roi_percentage.toFixed(1)}% ROI)` : ""}, `
          + `built from real, currently-listed marketplace inputs. `
          + `<a href="/trade-ups/${bestTu.id}">View this ${e(displayName)} trade-up</a>.</p>`
        : "";

      const collImageHtml = collectionImageUrl
        ? `<img src="${e(collectionImageUrl)}" alt="${e(displayName)} collection CS2" width="200" height="200" />`
        : "";

      const collBreadcrumb = `<nav aria-label="Breadcrumb"><ol>`
        + `<li><a href="/">Home</a></li>`
        + `<li><a href="/collections">Collections</a></li>`
        + `<li>${e(displayName)} Collection</li>`
        + `</ol></nav>`;
      const collRelated = `<nav aria-label="Related pages"><h2>Related Pages</h2><ul>`
        + `<li><a href="/trade-ups/collection/${req.params.slug}">${e(displayName)} trade-up contracts</a></li>`
        + `<li><a href="/collections">All CS2 collections</a></li>`
        + `<li><a href="/trade-ups">All profitable CS2 trade-ups</a></li>`
        + `<li><a href="/skins">Browse all CS2 skins</a></li>`
        + `</ul></nav>`;
      const collectionOverviewHtml = `<h2>Collection trade-up research</h2>`
        + `<p>The ${e(displayName)} Collection matters for trade-up planning because collection membership changes the output pool, not just the cosmetic theme. `
        + `A contract using ${e(displayName)} inputs can roll next-rarity skins from this collection according to the collection weights represented by the 10 input skins. `
        + `That makes rarity depth, listing supply, float ranges, and floor prices important signals when comparing contracts. Use the rarity sections below to see how many skins are available at each tier, which weapons appear in the collection, and where the cheapest active listings start. `
        + `For profitable trade-ups, TradeUpBot combines these collection details with real marketplace prices, deterministic output-float math, CSFloat, DMarket, and Skinport data, then links the live opportunities on the dedicated collection trade-up page.</p>`;
      const bodyHtml = collBreadcrumb
        + `<h1>${e(displayName)} Collection</h1>`
        + collImageHtml
        + `<p>The ${e(displayName)} collection is a CS2 weapon case collection containing ${skins.length} skins across ${grouped.size} rarity tiers. `
        + `There are currently ${totalListings.toLocaleString()} active listings across CSFloat, DMarket, and Skinport. `
        + (tuCount > 0 ? `The collection features in ${tuCount} profitable trade-up contracts, ` : "")
        + `Browse skins, compare prices, and find trade-up opportunities below.</p>`
        + bestProfitHtml
        + collectionOverviewHtml
        + tuLink
        + skinTablesHtml
        + collRelated;

      const jsonLd: Record<string, unknown>[] = [
        {
          "@context": "https://schema.org", "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: "https://tradeupbot.app/" },
            { "@type": "ListItem", position: 2, name: "Collections", item: "https://tradeupbot.app/collections" },
            { "@type": "ListItem", position: 3, name: `${displayName} Collection` },
          ],
        },
        {
          "@context": "https://schema.org", "@type": "CollectionPage",
          name: `${displayName} Collection`,
          description: `${skins.length} CS2 skins in the ${displayName} collection. ${totalListings.toLocaleString()} active listings.${tuCount > 0 ? ` ${tuCount} profitable trade-ups.` : ""}`,
          url: `https://tradeupbot.app/collections/${req.params.slug}`,
          numberOfItems: skins.length,
          ...(collectionImageUrl ? { image: collectionImageUrl } : {}),
        },
      ];

      const meta = {
        title: `${displayName} Collection — CS2 Skins, Prices & Trade-Ups | TradeUpBot`,
        description: `Browse ${skins.length} skins in the ${displayName} collection. ${totalListings.toLocaleString()} listings from CSFloat, DMarket, Skinport.${tuCount > 0 ? ` ${tuCount} profitable trade-ups.` : ""}`,
        url: `https://tradeupbot.app/collections/${req.params.slug}`,
        ogImage: collectionImageUrl || undefined,
        bodyHtml,
        jsonLd,
      };

      // Cache both crawler HTML and meta object — 3600s TTL.
      const collHtml = buildSeoHtml(meta);
      const collMetaToCache = { title: meta.title, description: meta.description, url: meta.url, ogImage: meta.ogImage };
      collCacheSet(collCacheKey, collHtml, 3600).catch(() => {});
      collCacheSet(collMetaCacheKey, collMetaToCache, 3600).catch(() => {});
      res.setHeader("Content-Type", "text/html");
      if (isCrawler(ua)) {
        res.send(collHtml);
      } else {
        const shellHtmlLocal: string | undefined = req.app.locals.shellHtml;
        if (!shellHtmlLocal) return next();
        res.send(injectMetaIntoSpa(shellHtmlLocal, meta));
      }
    } catch (err) { console.error(`SEO route ${req.path} failed:`, err instanceof Error ? err.message : err); next(); }
  });

  // SEO: crawler handler for /skins/:slug pages — enriched with structured data
  app.get("/skins/:slug", async (req, res, next) => {
    const ua = req.headers["user-agent"] || "";
    try {
      // Redis cache: 3600s TTL. seo_skin: stores full crawler HTML; seo_skin_meta: stores the small
      // meta object for non-crawlers. Both are checked before any DB work.
      const cacheKey = `seo_skin:${req.params.slug}`;
      const metaCacheKey = `seo_skin_meta:${req.params.slug}`;
      const { cacheGet, cacheSet } = await import("./redis.js");
      if (isCrawler(ua)) {
        try {
          const cached = await cacheGet<string>(cacheKey);
          if (cached) {
            res.setHeader("Content-Type", "text/html");
            res.setHeader("X-Cache", "HIT");
            res.send(cached);
            return;
          }
        } catch { /* Redis unavailable */ }
      } else {
        try {
          const cachedMeta = await cacheGet<{ title: string; description: string; url: string; robots: string; ogImage?: string }>(metaCacheKey);
          if (cachedMeta) {
            const shellHtmlLocal: string | undefined = req.app.locals.shellHtml;
            if (!shellHtmlLocal) return next();
            res.setHeader("Content-Type", "text/html");
            res.setHeader("X-Cache", "HIT");
            res.send(injectMetaIntoSpa(shellHtmlLocal, cachedMeta));
            return;
          }
        } catch { /* Redis unavailable */ }
      }

      const { getSlugMap } = await import("./routes/data.js");
      const slugMap = await getSlugMap(pool);
      const skinName = slugMap.get(req.params.slug);
      if (!skinName) {
        res.status(404).send("Skin not found");
        return;
      }

      // Skin metadata + listing stats (now includes image_url)
      const { rows: [skinMeta] } = await pool.query(`
        SELECT s.name, s.weapon, s.rarity, s.min_float, s.max_float, s.image_url,
               COUNT(l.id)::int as listing_count, MIN(l.price_cents) as min_price, MAX(l.price_cents) as max_price
        FROM skins s LEFT JOIN listings l ON s.id = l.skin_id
        WHERE s.name = $1 AND s.stattrak = false
        GROUP BY s.id
      `, [skinName]);
      if (!skinMeta) {
        res.status(404).send("Skin not found");
        return;
      }

      const listingCount = skinMeta.listing_count || 0;
      const minPrice = skinMeta.min_price ? (skinMeta.min_price / 100).toFixed(2) : "N/A";
      const maxPrice = skinMeta.max_price ? (skinMeta.max_price / 100).toFixed(2) : "N/A";
      const floatRangeText = `${skinMeta.min_float.toFixed(2)}\u2013${skinMeta.max_float.toFixed(2)}`;
      const robots = listingCount < 5 ? "noindex, follow" : "index, follow";

      // Run all independent queries in parallel. outputStats wrapped to avoid rejecting on
      // databases that predate the output_skin_names column (preserve existing resilience).
      const outputStatsWrapped = pool.query(`
          SELECT COUNT(*)::int as count
          FROM trade_ups
          WHERE output_skin_names @> ARRAY[$1]::text[]
            AND listing_status = 'active' AND is_theoretical = false AND profit_cents > 0
        `, [skinName]).catch((err: unknown) => {
        console.warn("Skin SEO output count unavailable:", err instanceof Error ? err.message : err);
        return { rows: [{ count: 0 }] };
      });

      const [
        { rows: collections },
        { rows: condPrices },
        { rows: tradeUps },
        { rows: [inputStats] },
        outputStatsResult,
        { rows: [priceTrend] },
      ] = await Promise.all([
        // Collections this skin belongs to
        pool.query(`
          SELECT c.name FROM skin_collections sc
          JOIN collections c ON sc.collection_id = c.id
          JOIN skins s ON sc.skin_id = s.id
          WHERE s.name = $1 AND s.stattrak = false
        `, [skinName]),
        // Prices by condition
        pool.query(`
          SELECT condition, avg_price_cents, median_price_cents, min_price_cents
          FROM price_data WHERE skin_name = $1 AND source = 'csfloat_ref'
          ORDER BY CASE condition
            WHEN 'Factory New' THEN 1 WHEN 'Minimal Wear' THEN 2
            WHEN 'Field-Tested' THEN 3 WHEN 'Well-Worn' THEN 4
            WHEN 'Battle-Scarred' THEN 5 END
        `, [skinName]),
        // Trade-ups using this skin as INPUT (top 5 for table)
        // MATERIALIZED CTE forces the planner to start from trade_up_inputs (28 rows for AK Redline)
        // rather than scanning all 41K profitable trade_ups in a nested loop (was 4.5s → 9ms).
        pool.query(`
          WITH skin_tus AS MATERIALIZED (
            SELECT DISTINCT trade_up_id FROM trade_up_inputs WHERE skin_name = $1
          )
          SELECT t.id, t.type, t.profit_cents, t.roi_percentage, t.chance_to_profit, t.total_cost_cents
          FROM trade_ups t JOIN skin_tus ON t.id = skin_tus.trade_up_id
          WHERE t.listing_status = 'active' AND t.is_theoretical = false AND t.profit_cents > 0
          ORDER BY t.profit_cents DESC LIMIT 5
        `, [skinName]),
        // Total profitable input count
        pool.query(`
          WITH skin_tus AS MATERIALIZED (
            SELECT DISTINCT trade_up_id FROM trade_up_inputs WHERE skin_name = $1
          )
          SELECT COUNT(*)::int as count
          FROM trade_ups t JOIN skin_tus ON t.id = skin_tus.trade_up_id
          WHERE t.listing_status = 'active' AND t.is_theoretical = false AND t.profit_cents > 0
        `, [skinName]),
        // Trade-ups that PRODUCE this skin as OUTPUT (optional — fallback on DB column absence)
        outputStatsWrapped,
        // 30-day price trend: compare first-week median vs last-week median
        pool.query(`
          SELECT
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price_cents) FILTER (WHERE observed_at < NOW() - INTERVAL '23 days') AS old_median,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price_cents) FILTER (WHERE observed_at > NOW() - INTERVAL '7 days') AS new_median,
            COUNT(*) as obs_count
          FROM price_observations
          WHERE skin_name = $1 AND observed_at > NOW() - INTERVAL '30 days'
        `, [skinName]),
      ]);

      const inputTuCount = inputStats?.count || 0;
      const outputTuCount = outputStatsResult.rows[0]?.count || 0;
      let priceTrendHtml = "";
      if (priceTrend?.old_median && priceTrend?.new_median && priceTrend.obs_count >= 5) {
        const oldMedian = parseFloat(priceTrend.old_median);
        const newMedian = parseFloat(priceTrend.new_median);
        if (oldMedian > 0) {
          const pctChange = ((newMedian - oldMedian) / oldMedian) * 100;
          const direction = pctChange > 0 ? "increased" : "decreased";
          const absPct = Math.abs(pctChange).toFixed(1);
          const oldFmt = "$" + (oldMedian / 100).toFixed(2);
          const newFmt = "$" + (newMedian / 100).toFixed(2);
          priceTrendHtml = `<p><strong>Price Trend:</strong> ${escapeHtml(skinName)} prices have ${direction} ${absPct}% over the last 30 days, from ${oldFmt} to ${newFmt}.</p>`;
        }
      }

      // Other skins in the same collection (for interlinking)
      const primaryCollection = collections.length > 0 ? collections[0].name : null;
      let siblingSkinsHtml = "";
      if (primaryCollection) {
        const { rows: siblings } = await pool.query(`
          SELECT s.name FROM skin_collections sc
          JOIN collections c ON sc.collection_id = c.id
          JOIN skins s ON sc.skin_id = s.id
          WHERE c.name = $1 AND s.stattrak = false AND s.name != $2
          ORDER BY CASE s.rarity
            WHEN 'Covert' THEN 1 WHEN 'Classified' THEN 2 WHEN 'Restricted' THEN 3
            WHEN 'Mil-Spec' THEN 4 WHEN 'Industrial Grade' THEN 5 WHEN 'Consumer Grade' THEN 6
            ELSE 7 END, s.name
        `, [primaryCollection, skinName]);
        if (siblings.length > 0) {
          const collDisplay = primaryCollection.replace(/^The\s+/i, "").replace(/\s+Collection$/i, "");
          const links = siblings.map((s: { name: string }) =>
            `<li><a href="/skins/${toSlug(s.name)}">${escapeHtml(s.name)}</a></li>`
          ).join("");
          siblingSkinsHtml = `<h2>Other Skins in the ${escapeHtml(collDisplay)} Collection</h2><ul>${links}</ul>`;
        }
      }

      // Determine available conditions from float range
      const conditionRanges = [
        { name: "Factory New", min: 0.00, max: 0.07 },
        { name: "Minimal Wear", min: 0.07, max: 0.15 },
        { name: "Field-Tested", min: 0.15, max: 0.38 },
        { name: "Well-Worn", min: 0.38, max: 0.45 },
        { name: "Battle-Scarred", min: 0.45, max: 1.00 },
      ];
      const availableConditions = conditionRanges
        .filter(c => skinMeta.min_float < c.max && skinMeta.max_float > c.min)
        .map(c => c.name);

      // Build HTML body
      const e = escapeHtml;
      const collLinks = collections.map((c: { name: string }) =>
        `<a href="/collections/${collectionToSlug(c.name)}">${e(c.name.replace(/^The\s+/i, "").replace(/\s+Collection$/i, ""))}</a>`
      ).join(", ");

      // Skin image
      const imgHtml = skinMeta.image_url
        ? `<img src="${e(skinMeta.image_url)}" alt="${e(skinMeta.weapon)} ${e(skinName)} CS2 skin" width="512" height="384" />`
        : "";

      // Natural paragraph
      const collDisplay = primaryCollection
        ? primaryCollection.replace(/^The\s+/i, "").replace(/\s+Collection$/i, "")
        : "";
      const collectionSummaryForDescription = collDisplay ? ` from the ${collDisplay} collection` : "";
      const listingSummaryForDescription = listingCount === 1 ? "1 active listing" : `${listingCount.toLocaleString()} active listings`;
      let naturalParagraph = `${e(skinName)} is a ${e(skinMeta.rarity)} quality ${e(skinMeta.weapon)} skin`
        + (collDisplay ? ` from the ${e(collDisplay)} collection` : "")
        + `. It has a float range of ${floatRangeText}, meaning it comes in ${availableConditions.join(", ")} condition.`;
      if (listingCount > 0) {
        naturalParagraph += ` There are currently ${listingCount.toLocaleString()} active listings across CSFloat, DMarket, and Skinport, with prices ranging from $${minPrice} to $${maxPrice}.`;
      }
      let priceTable = "";
      if (condPrices.length > 0) {
        const rows = condPrices.map((p: { condition: string; avg_price_cents: number; median_price_cents: number; min_price_cents: number }) =>
          `<tr><td>${e(p.condition)}</td><td>$${(p.avg_price_cents / 100).toFixed(2)}</td><td>$${(p.median_price_cents / 100).toFixed(2)}</td><td>$${(p.min_price_cents / 100).toFixed(2)}</td></tr>`
        ).join("");
        priceTable = `<h2>${e(skinName)} Prices by Condition</h2><table><thead><tr><th>Condition</th><th>Avg</th><th>Median</th><th>Min</th></tr></thead><tbody>${rows}</tbody></table>`;
      }

      let tuTable = "";
      if (tradeUps.length > 0) {
        const rows = tradeUps.map((t: { id: number; type: string; total_cost_cents: number; profit_cents: number; roi_percentage: number; chance_to_profit: number }) =>
          `<tr><td><a href="/trade-ups/${t.id}">${e(TRADE_UP_TYPE_LABELS[t.type] || t.type)}</a></td><td>$${(t.total_cost_cents / 100).toFixed(2)}</td><td>$${(t.profit_cents / 100).toFixed(2)}</td><td>${t.roi_percentage.toFixed(1)}%</td><td>${Math.round((t.chance_to_profit ?? 0) * 100)}%</td></tr>`
        ).join("");
        tuTable = `<h2>Trade-Ups Using ${e(skinName)}</h2><table><thead><tr><th>Type</th><th>Cost</th><th>Profit</th><th>ROI</th><th>Chance</th></tr></thead><tbody>${rows}</tbody></table>`;
      }

      // Trade-up stats paragraphs
      let tuStatsParagraphs = "";
      if (inputTuCount > 0) {
        tuStatsParagraphs += `<p>This skin appears in <strong>${inputTuCount} profitable trade-ups</strong> as an input.</p>`;
      }
      if (outputTuCount > 0) {
        tuStatsParagraphs += `<p><strong>${outputTuCount} profitable trade-ups</strong> can produce this skin as an output.</p>`;
      }

      // FAQ section
      const rarityOutputTier: Record<string, string> = {
        "Consumer Grade": "Industrial Grade",
        "Industrial Grade": "Mil-Spec Grade",
        "Mil-Spec": "Restricted",
        "Restricted": "Classified",
        "Classified": "Covert",
        "Covert": "Knife or Glove",
      };
      const outputTier = rarityOutputTier[skinMeta.rarity] || "a higher rarity tier";
      const bestProfit = tradeUps.length > 0 ? Math.max(...tradeUps.map((t: { profit_cents: number }) => t.profit_cents)) : 0;

      // Data-driven research prose (replaces the identical two-paragraph boilerplate that
      // previously rendered on every skin page). Grounded in this skin's own float range,
      // conditions, rarity tier path, collection, and live trade-up role.
      const researchParagraph = buildSkinResearchParagraphs({
        skinName,
        rarity: skinMeta.rarity,
        minFloat: skinMeta.min_float,
        maxFloat: skinMeta.max_float,
        availableConditions,
        collectionDisplay: collDisplay || null,
        // null for terminal items (knives/gloves) so the copy doesn't claim they trade up.
        outputTier: rarityOutputTier[skinMeta.rarity] ?? null,
        inputTuCount,
        outputTuCount,
        bestProfitCents: bestProfit,
      });
      const goodInputAnswer = (() => {
        if (inputTuCount === 0) {
          return `${skinName} is not currently used in any profitable trade-up contracts. It is a ${skinMeta.rarity} skin, which trades up into ${outputTier} outputs, but no profitable contracts are available at current market prices.`;
        }
        const bestFmt = "$" + (bestProfit / 100).toFixed(2);
        return `Yes — ${skinName} appears as an input in ${inputTuCount} profitable trade-up contract${inputTuCount !== 1 ? "s" : ""} at current market prices. As a ${skinMeta.rarity} skin, it trades up into ${outputTier} outputs. The best current contract offers ${bestFmt} profit. Use TradeUpBot's live calculator to find the best entry price.`;
      })();

      const faqEntries = [
        {
          q: `How much does ${skinName} cost?`,
          a: listingCount > 0
            ? `${skinName} prices currently range from $${minPrice} to $${maxPrice} across ${listingCount.toLocaleString()} active listings on CSFloat, DMarket, and Skinport.`
            : `There are currently no active listings for ${skinName}. Check back later for updated pricing.`,
        },
        {
          q: `What is the float range of ${skinName}?`,
          a: `${skinName} has a float range of ${skinMeta.min_float.toFixed(2)} to ${skinMeta.max_float.toFixed(2)}, which means it is available in ${availableConditions.join(", ")} condition.`,
        },
        {
          q: `Is ${skinName} a good trade-up input?`,
          a: goodInputAnswer,
        },
        {
          q: `What trade-ups use ${skinName}?`,
          a: inputTuCount > 0
            ? `${skinName} appears as an input in ${inputTuCount} profitable trade-up contracts.${outputTuCount > 0 ? ` Additionally, ${outputTuCount} profitable trade-ups can produce this skin as an output.` : ""}`
            : `There are currently no profitable trade-ups using ${skinName} as an input.${outputTuCount > 0 ? ` However, ${outputTuCount} profitable trade-ups can produce this skin as an output.` : ""}`,
        },
      ];
      const faqHtml = `<h2>Frequently Asked Questions</h2>`
        + faqEntries.map(f => `<h3>${e(f.q)}</h3><p>${e(f.a)}</p>`).join("");

      const skinBreadcrumb = `<nav aria-label="Breadcrumb"><ol>`
        + `<li><a href="/">Home</a></li>`
        + `<li><a href="/skins">Skins</a></li>`
        + (primaryCollection ? `<li><a href="/collections/${collectionToSlug(primaryCollection)}">${e(collDisplay)} Collection</a></li>` : "")
        + `<li>${e(skinName)}</li>`
        + `</ol></nav>`;
      const skinRelated = `<nav aria-label="Related pages"><h2>Related Pages</h2><ul>`
        + (primaryCollection ? `<li><a href="/collections/${collectionToSlug(primaryCollection)}">${e(collDisplay)} Collection — all skins</a></li>` : "")
        + (primaryCollection ? `<li><a href="/trade-ups/collection/${collectionToSlug(primaryCollection)}">${e(collDisplay)} Collection trade-ups</a></li>` : "")
        + (inputTuCount > 0 ? `<li><a href="/trade-ups">Find profitable trade-ups using ${e(skinName)}</a></li>` : "")
        + `<li><a href="/skins">Browse all CS2 skins</a></li>`
        + `</ul></nav>`;
      const bodyHtml = skinBreadcrumb
        + `<h1>${e(skinName)}</h1>`
        + imgHtml
        + `<p>${naturalParagraph}</p>`
        + `<p><strong>Weapon:</strong> ${e(skinMeta.weapon)} | <strong>Rarity:</strong> ${e(skinMeta.rarity)} | <strong>Float Range:</strong> ${floatRangeText} | <strong>Listings:</strong> ${listingCount}</p>`
        + `<p><strong>Available Conditions:</strong> ${availableConditions.join(", ")}</p>`
        + (collections.length > 0 ? `<p><strong>Collections:</strong> ${collLinks}</p>` : "")
        + researchParagraph
        + tuStatsParagraphs
        + priceTrendHtml
        + priceTable
        + tuTable
        + siblingSkinsHtml
        + faqHtml
        + skinRelated;

      // Structured data: Product + BreadcrumbList + FAQPage
      const jsonLd: Record<string, unknown>[] = [
        {
          "@context": "https://schema.org", "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: "https://tradeupbot.app/" },
            { "@type": "ListItem", position: 2, name: "Skins", item: "https://tradeupbot.app/skins" },
            { "@type": "ListItem", position: 3, name: skinName },
          ],
        },
        {
          "@context": "https://schema.org", "@type": "Product",
          name: skinName,
          description: `${skinName} CS2 skin \u2014 ${skinMeta.rarity} rarity, float range ${skinMeta.min_float.toFixed(2)}\u2013${skinMeta.max_float.toFixed(2)}. ${listingCount} active listings.`,
          url: `https://tradeupbot.app/skins/${req.params.slug}`,
          category: `CS2 Skins > ${skinMeta.rarity}`,
          ...(skinMeta.image_url ? { image: skinMeta.image_url } : {}),
          ...(skinMeta.min_price ? {
            offers: {
              "@type": "AggregateOffer", priceCurrency: "USD",
              lowPrice: (skinMeta.min_price / 100).toFixed(2),
              highPrice: ((skinMeta.max_price ?? skinMeta.min_price) / 100).toFixed(2),
              offerCount: listingCount,
            },
          } : {}),
        },
        {
          "@context": "https://schema.org", "@type": "FAQPage",
          mainEntity: faqEntries.map(f => ({
            "@type": "Question",
            name: f.q,
            acceptedAnswer: { "@type": "Answer", text: f.a },
          })),
        },
      ];

      const tuSuffix = inputTuCount > 0 ? ` ${inputTuCount} profitable trade-ups available.` : "";
      const meta = {
        title: `${skinName} — CS2 Price, Float Range & Trade-Ups | TradeUpBot`,
        description: `${skinName}${collectionSummaryForDescription} prices from $${minPrice} to $${maxPrice}. ${listingSummaryForDescription} on CSFloat, DMarket, Skinport. Float range ${floatRangeText}.${tuSuffix}`,
        url: `https://tradeupbot.app/skins/${req.params.slug}`,
        robots,
        ogImage: skinMeta.image_url || undefined,
        bodyHtml,
        jsonLd,
      };
      const html = buildSeoHtml(meta);
      // Cache both the full crawler HTML and the small meta object — 3600s TTL.
      // Writing unconditionally so human visitors also warm the cache.
      const metaToCache = { title: meta.title, description: meta.description, url: meta.url, robots: meta.robots, ogImage: meta.ogImage };
      cacheSet(cacheKey, html, 3600).catch(() => {});
      cacheSet(metaCacheKey, metaToCache, 3600).catch(() => {});
      res.setHeader("Content-Type", "text/html");
      if (isCrawler(ua)) {
        res.send(html);
      } else {
        const shellHtmlLocal: string | undefined = req.app.locals.shellHtml;
        if (!shellHtmlLocal) return next();
        res.send(injectMetaIntoSpa(shellHtmlLocal, meta));
      }
    } catch (err) { console.error(`SEO route ${req.path} failed:`, err instanceof Error ? err.message : err); next(); }
  });

  // Serve built frontend in production (Vite handles this in dev via proxy)
  const distPath = path.join(__dirname, "..", "dist");
  if (fs.existsSync(distPath)) {
    // Read index.html once for meta injection on list pages
    const indexHtml = fs.readFileSync(path.join(distPath, "index.html"), "utf-8");
    // _shell.html is the pristine Vite output copied before prerender overwrites index.html.
    // SPA routes inject meta into the shell; / serves the fully prerendered landing (indexHtml).
    const shellPath = path.join(distPath, "_shell.html");
    const shellHtml = fs.existsSync(shellPath) ? fs.readFileSync(shellPath, "utf-8") : indexHtml;
    app.locals.shellHtml = shellHtml;

    // List pages: Googlebot gets server-rendered HTML with real DB data and NO JS bundle.
    // WRS executes JS which overwrites content with empty-state React render (API times out
    // during WRS render window). Without JS, WRS sees the server-rendered content directly.
    // Regular users get the SPA shell with injected meta tags.
    app.get("/trade-ups", async (req, res, next) => {
      const ua = req.headers["user-agent"] || "";
      if (!isCrawler(ua)) {
        res.setHeader("Content-Type", "text/html");
        res.send(injectMetaIntoSpa(shellHtml, {
          title: "CS2 Trade-Ups — Live Profitable Contracts | TradeUpBot",
          description: "Find profitable CS2 trade-up contracts from real marketplace listings. Use the calculator, filter by profit, ROI, cost, and rarity. Data from CSFloat, DMarket, and Skinport.",
          url: "https://tradeupbot.app/trade-ups",
        }));
        return;
      }
      const cacheKey = "seo_tradeups_list";
      try {
        const { cacheGet, cacheSet } = await import("./redis.js");
        const cached = await cacheGet<string>(cacheKey);
        if (cached) {
          res.setHeader("Content-Type", "text/html");
          res.setHeader("X-Cache", "HIT");
          res.send(cached);
          return;
        }
      } catch { }
      try {
        const { rows: [stats] } = await pool.query(
          "SELECT COUNT(*)::int as total, COUNT(*) FILTER (WHERE profit_cents > 0)::int as profitable FROM trade_ups WHERE listing_status = 'active' AND is_theoretical = false"
        );
        const { rows: topTradeUps } = await pool.query(`
          SELECT t.id, t.type, t.total_cost_cents, t.profit_cents, t.roi_percentage, t.chance_to_profit
          FROM trade_ups t
          WHERE t.listing_status = 'active' AND t.is_theoretical = false AND t.profit_cents > 0
          ORDER BY t.profit_cents DESC LIMIT 20
        `);
        const { rows: collectionTradeUps } = await pool.query(`
          SELECT ti.collection_name, COUNT(DISTINCT ti.trade_up_id)::int as count
          FROM trade_up_inputs ti
          JOIN trade_ups t ON ti.trade_up_id = t.id
          WHERE t.listing_status = 'active' AND t.is_theoretical = false AND t.profit_cents > 0
          GROUP BY ti.collection_name
          ORDER BY count DESC, ti.collection_name
          LIMIT 12
        `);
        const total = stats?.total || 0;
        const profitable = stats?.profitable || 0;
        const faqSchema = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [
          { "@type": "Question", name: "What is a CS2 trade-up contract?", acceptedAnswer: { "@type": "Answer", text: "A CS2 trade-up contract exchanges 10 weapon skins of the same rarity for 1 skin of the next higher rarity. The output is randomly selected from collections matching your inputs, weighted proportionally by input count per collection." } },
          { "@type": "Question", name: "How does TradeUpBot find profitable trade-ups?", acceptedAnswer: { "@type": "Answer", text: "TradeUpBot scans real marketplace listings across CSFloat, DMarket, and Skinport. For each valid combination of 10 inputs, it calculates expected output value using the actual CS2 float formula and accounts for marketplace fees on both buy and sell sides." } },
          { "@type": "Question", name: "Are these listings live?", acceptedAnswer: { "@type": "Answer", text: "Every trade-up is built from listings that existed on the marketplace at discovery time. Listings can sell before you act — use the Verify button to confirm availability before purchasing." } },
        ] };
        const html = buildSeoHtml({
          title: "CS2 Trade-Ups — Live Profitable Contracts | TradeUpBot",
          description: `${profitable.toLocaleString()} profitable CS2 trade-ups from ${total.toLocaleString()} active contracts. Real listings from CSFloat, DMarket, and Skinport — or model your own contract with the calculator.`,
          url: "https://tradeupbot.app/trade-ups",
          bodyHtml: renderTradeUpsHub({
            total,
            profitable,
            topTradeUps,
            collections: collectionTradeUps.map((collection: { collection_name: string; count: number }) => ({
              name: collection.collection_name.replace(/^The\s+/i, "").replace(/\s+Collection$/i, ""),
              slug: collectionToSlug(collection.collection_name),
              count: collection.count,
            })),
          }),
          jsonLd: [
            { "@context": "https://schema.org", "@type": "WebApplication", name: "TradeUpBot", url: "https://tradeupbot.app/trade-ups", applicationCategory: "GameApplication", operatingSystem: "Web", description: `${profitable} profitable CS2 trade-ups from ${total} active contracts.` },
            faqSchema,
          ],
        });
        try {
          const { cacheSet } = await import("./redis.js");
          await cacheSet(cacheKey, html, 3600).catch(() => {});
        } catch { }
        res.setHeader("Content-Type", "text/html");
        res.send(html);
      } catch (err) { console.error(`SEO route ${req.path} failed:`, err instanceof Error ? err.message : err); next(); }
    });

    app.get("/collections", async (req, res, next) => {
      const ua = req.headers["user-agent"] || "";
      if (!isCrawler(ua)) {
        res.setHeader("Content-Type", "text/html");
        res.send(injectMetaIntoSpa(shellHtml, {
          title: "CS2 Collections — Browse All Weapon Cases & Collections | TradeUpBot",
          description: "Browse all CS2 collections. See skins, float ranges, and trade-up opportunities for every weapon case and collection.",
          url: "https://tradeupbot.app/collections",
        }));
        return;
      }
      try {
        const { rows } = await pool.query("SELECT name FROM collections ORDER BY name");
        const collectionLinks = rows.map((c: { name: string }) => ({
          name: c.name,
          slug: collectionToSlug(c.name),
        }));
        res.setHeader("Content-Type", "text/html");
        res.send(buildSeoHtml({
          title: "CS2 Collections — Browse All Weapon Cases & Collections | TradeUpBot",
          description: `Browse ${rows.length} CS2 collections with skins, float ranges, and trade-up opportunities.`,
          url: "https://tradeupbot.app/collections",
          bodyHtml: renderCollectionsHub(collectionLinks),
        }));
      } catch (err) { console.error(`SEO route ${req.path} failed:`, err instanceof Error ? err.message : err); next(); }
    });

    app.get("/skins", async (req, res, next) => {
      const ua = req.headers["user-agent"] || "";
      if (!isCrawler(ua)) {
        res.setHeader("Content-Type", "text/html");
        res.send(injectMetaIntoSpa(shellHtml, {
          title: "CS2 Skin Prices & Float Data — All Skins | TradeUpBot",
          description: "Browse CS2 skins with live prices from CSFloat, DMarket, and Skinport. Float values, price charts, and trade-up potential.",
          url: "https://tradeupbot.app/skins",
        }));
        return;
      }
      const cacheKey = "seo_skins_list_v2"; // bumped for plan 023 ItemList/CollectionPage schema
      try {
        const { cacheGet, cacheSet } = await import("./redis.js");
        const cached = await cacheGet<string>(cacheKey);
        if (cached) {
          res.setHeader("Content-Type", "text/html");
          res.setHeader("X-Cache", "HIT");
          res.send(cached);
          return;
        }
      } catch { }
      try {
        const { rows } = await pool.query(`
          SELECT s.name, COUNT(l.id)::int as listing_count
          FROM skins s JOIN listings l ON s.id = l.skin_id
          WHERE s.stattrak = false
          GROUP BY s.name HAVING COUNT(l.id) >= 10
          ORDER BY s.name LIMIT 200
        `);
        const links = rows.map((s: { name: string; listing_count: number }) => {
          const slug = toSlug(s.name);
          return `<li><a href="/skins/${slug}">${escapeHtml(s.name)}</a> (${s.listing_count} listings)</li>`;
        }).join("");
        // ItemList JSON-LD (cap elements at 50 to keep the payload compact; numberOfItems = full count)
        const itemListElement = rows.slice(0, 50).map((s: { name: string }, i: number) => ({
          "@type": "ListItem",
          position: i + 1,
          url: `https://tradeupbot.app/skins/${toSlug(s.name)}`,
          name: s.name,
        }));
        const jsonLd: Record<string, unknown>[] = [
          {
            "@context": "https://schema.org", "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Home", item: "https://tradeupbot.app/" },
              { "@type": "ListItem", position: 2, name: "Skins", item: "https://tradeupbot.app/skins" },
            ],
          },
          {
            "@context": "https://schema.org", "@type": "CollectionPage",
            name: "CS2 Skin Prices & Float Data",
            description: `Browse ${rows.length}+ CS2 weapon skins with live prices and float data from CSFloat, DMarket, Skinport, and Buff.`,
            url: "https://tradeupbot.app/skins",
          },
          {
            "@context": "https://schema.org", "@type": "ItemList",
            name: "CS2 Skins",
            numberOfItems: rows.length,
            itemListElement,
          },
        ];
        const html = buildSeoHtml({
          title: "CS2 Skin Prices & Float Data — All Skins | TradeUpBot",
          description: `Browse ${rows.length}+ CS2 skins with live prices from CSFloat, DMarket, and Skinport.`,
          url: "https://tradeupbot.app/skins",
          bodyHtml: `<h1>CS2 Skin Database — Prices, Floats, Trade-Ups</h1><p>Browse ${rows.length}+ CS2 weapon skins with live market prices and float data from CSFloat, DMarket, and Skinport.</p><ul>${links}</ul>`,
          jsonLd,
        });
        try {
          const { cacheSet } = await import("./redis.js");
          await cacheSet(cacheKey, html, 3600).catch(() => {});
        } catch { }
        res.setHeader("Content-Type", "text/html");
        res.send(html);
      } catch (err) { console.error(`SEO route ${req.path} failed:`, err instanceof Error ? err.message : err); next(); }
    });

    for (const staticPage of STATIC_SEO_PAGES) {
      app.get(staticPage.path, (req, res) => {
        const ua = req.headers["user-agent"] || "";
        res.setHeader("Content-Type", "text/html");
        if (isCrawler(ua)) {
          res.send(buildSeoHtml({
            title: staticPage.title,
            description: staticPage.description,
            url: `https://tradeupbot.app${staticPage.path}`,
            bodyHtml: staticPage.bodyHtml,
            jsonLd: staticPage.jsonLd,
            includeFooter: true,
          }));
          return;
        }
        res.send(injectMetaIntoSpa(shellHtml, {
          title: staticPage.title,
          description: staticPage.description,
          url: `https://tradeupbot.app${staticPage.path}`,
          bodyHtml: staticPage.bodyHtml,
        }));
      });
    }

    // SEO: blog index page
    app.get("/blog", (req, res) => {
      const ua = req.headers["user-agent"] || "";
      const title = "Blog — CS2 Trade-Up Guides & Analysis | TradeUpBot";
      const description = "Guides and analysis on CS2 trade-up contracts, float mechanics, marketplace strategy, and how to find profitable trade-ups.";
      const url = "https://tradeupbot.app/blog";
      const postLinks = blogPosts.map((post) =>
        `<li><a href="/blog/${escapeHtml(post.slug)}/">${escapeHtml(post.title)}</a><p>${escapeHtml(post.excerpt)}</p></li>`
      ).join("");
      const bodyHtml = `<h1>CS2 Trade-Up Guides & Analysis</h1><p>Read TradeUpBot guides about CS2 trade-up contracts, float values, marketplace fees, output probability, expected value, collection strategy, and profitable contract discovery. These resources explain how 10 input skins become one output skin, why adjusted float determines wear condition, and how marketplace spreads affect real profit.</p><p>Start with the beginner guide, then explore float targeting, marketplace fees, knife collection strategy, and probability analysis. Each article links back to live tools so you can turn trade-up theory into practical contract research.</p><p><a href="/trade-ups">Browse live profitable trade-ups</a>, <a href="/calculator">calculate a contract</a>, or <a href="/skins">research skin prices</a>.</p><h2>Latest CS2 Trade-Up Articles</h2><ul>${postLinks}</ul>`;
      res.setHeader("Content-Type", "text/html");
      if (isCrawler(ua)) {
        res.send(buildSeoHtml({
          title, description, url,
          bodyHtml,
        }));
      } else {
        res.send(injectMetaIntoSpa(shellHtml, { title, description, url, bodyHtml }));
      }
    });

    registerBlogRoutes(app, shellHtml);

    app.get("/", async (_req, res, next) => {
      const indexPath = path.join(__dirname, "..", "dist", "index.html");
      if (!fs.existsSync(indexPath)) return next();

      let html = dedupeHead(fs.readFileSync(indexPath, "utf-8"));

      try {
        const stats = await Promise.race([
          getGlobalStats(pool),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 350)),
        ]);

        if (stats) {
          const replaceCounter = (source: string, label: string, value: number): string => {
            const pattern = new RegExp(`>0<\\/span>\\s*<span class="text-muted-foreground">${label}`, "i");
            return source.replace(pattern, `>${value.toLocaleString("en-US")}</span> <span class="text-muted-foreground">${label}`);
          };

          html = replaceCounter(html, "trade-ups", stats.total_trade_ups);
          html = replaceCounter(html, "profitable", stats.profitable_trade_ups);
          html = replaceCounter(html, "data points", stats.total_data_points);
        } else {
          console.warn("Homepage stats injection skipped: timed out waiting for global stats");
        }
      } catch (err) {
        console.error("Homepage stats injection failed:", err);
      }

      res.setHeader("Content-Type", "text/html");
      res.setHeader("Cache-Control", "no-cache, must-revalidate");
      res.send(html);
    });

    // Static assets with content-hashed filenames (Vite puts everything in
    // dist/assets/* with hashes) can be cached aggressively. HTML must always
    // revalidate so browsers pick up new asset URLs after a deploy.
    // expressStaticGzip serves pre-compressed .br/.gz artifacts when the client supports them.
    app.use(expressStaticGzip(distPath, {
      enableBrotli: true,
      orderPreference: ["br", "gz"],
      serveStatic: {
        setHeaders(res, filePath) {
          // Strip .br/.gz suffix that express-static-gzip appends when rewriting req.url
          const normalizedPath = filePath.replace(/\.(br|gz)$/, "");
          if (normalizedPath.includes("/assets/")) {
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          } else if (normalizedPath.endsWith(".html")) {
            res.setHeader("Cache-Control", "no-cache, must-revalidate");
          } else if (/\.(png|jpe?g|webp|svg)$/i.test(normalizedPath) && !normalizedPath.includes("/assets/")) {
            // Public images (not content-hashed): 1-day cache
            res.setHeader("Cache-Control", "public, max-age=86400");
          }
        },
      },
    }));
    app.get("*", (_req, res) => {
      res.setHeader("Cache-Control", "no-cache, must-revalidate");
      res.setHeader("Content-Type", "text/html");
      res.send(shellHtml);
    });
  }

  // Global error handler
  app.use((err: Error, _req: express.Request, res: express.Response, _next: NextFunction) => {
    console.error("Unhandled error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  });

  // Start listening
  const server = app.listen(PORT, () => {
    process.send?.("ready"); // signal PM2 wait_ready when configured
    console.log(`Trade-Up Bot API running at http://localhost:${PORT}`);

    // Background cache warming: pre-populate Redis with heavy COUNT queries
    // so the first user request doesn't wait 8-10s for cold PG queries.
    setTimeout(async () => {
      try {
        const { cacheGet, cacheSet } = await import("./redis.js");

        // global-stats: COUNT(*) on 1.25M trade_ups
        if (!(await cacheGet("global_stats"))) {
          console.log("Warming cache: global-stats...");
          const t = Date.now();
          const { rows: [stats] } = await pool.query(`
            SELECT
              (SELECT COUNT(*) FROM trade_ups WHERE is_theoretical = false) as total_tu,
              (SELECT SUM(CASE WHEN profit_cents > 0 THEN 1 ELSE 0 END) FROM trade_ups WHERE is_theoretical = false) as profitable_tu,
              (SELECT COUNT(*) FROM listings) as listings,
              (SELECT COUNT(*) FROM price_observations) as sale_obs,
              (SELECT COUNT(*) FROM sale_history) as sale_hist,
              (SELECT COUNT(*) FROM price_data WHERE source = 'csfloat_ref') as refs,
              (SELECT COUNT(*) FROM daemon_cycle_stats) as cycles
          `);
          const data = {
            total_trade_ups: parseInt(stats.total_tu),
            profitable_trade_ups: parseInt(stats.profitable_tu) || 0,
            total_data_points: parseInt(stats.listings) + parseInt(stats.sale_obs) + parseInt(stats.sale_hist) + parseInt(stats.refs),
            listings: parseInt(stats.listings),
            sale_observations: parseInt(stats.sale_obs),
            sale_history: parseInt(stats.sale_hist),
            ref_prices: parseInt(stats.refs),
            total_cycles: parseInt(stats.cycles),
          };
          await cacheSet("global_stats", data, 1800); // 30-min TTL — survives daemon cycle
          console.log(`Cache warmed: global-stats (${((Date.now() - t) / 1000).toFixed(1)}s)`);
        }

        // Pre-compute type counts (avoids 4s COUNT on 326K-664K rows on first type switch)
        if (!(await cacheGet("type_counts"))) {
          console.log("Warming cache: type-counts...");
          const t2 = Date.now();
          const { rows: countRows } = await pool.query(`
            SELECT type, COUNT(*) as c, SUM(CASE WHEN profit_cents > 0 THEN 1 ELSE 0 END) as profitable
            FROM trade_ups WHERE is_theoretical = false AND listing_status = 'active'
            GROUP BY type
          `);
          const counts: Record<string, { total: number; profitable: number }> = {};
          for (const r of countRows) {
            counts[r.type] = { total: parseInt(r.c), profitable: parseInt(r.profitable) || 0 };
          }
          await cacheSet("type_counts", counts, 1800);
          console.log(`Cache warmed: type-counts (${((Date.now() - t2) / 1000).toFixed(1)}s)`);
        }

        // Warm skin-data for most common rarity tabs (5s cold query, 1800s TTL)
        for (const rarity of ["Covert", "Classified", "knife_glove", "all"]) {
          const key = `skins:${rarity}:::1:0:`;
          if (!(await cacheGet(key))) {
            console.log(`Warming cache: skin-data ${rarity}...`);
            const t3 = Date.now();
            // Hit our own API to warm the cache (reuses all data.ts logic including collectionKnifePool)
            await fetch(`http://localhost:${process.env.PORT || 3001}/api/skin-data?rarity=${encodeURIComponent(rarity)}`).catch(() => {});
            console.log(`Cache warmed: skin-data ${rarity} (${((Date.now() - t3) / 1000).toFixed(1)}s)`);
          }
        }
      } catch (e) {
        console.error("Cache warming failed:", (e as Error).message);
      }
    }, 500);
  });

  process.on("SIGTERM", () => {
    console.log("SIGTERM received — draining");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 8000).unref(); // hard deadline
  });
})();

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});
