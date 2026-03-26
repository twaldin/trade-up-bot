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
import { statusRouter } from "./routes/status.js";
import { tradeUpsRouter } from "./routes/trade-ups.js";
import { dataRouter } from "./routes/data.js";
import { collectionsRouter } from "./routes/collections.js";
import { snapshotsRouter } from "./routes/snapshots.js";
import { calculatorRouter } from "./routes/calculator.js";
import { claimsRouter } from "./routes/claims.js";
import { stripeRouter } from "./routes/stripe.js";
import { discordRouter } from "./routes/discord.js";
import myTradeUpsRouter from "./routes/my-trade-ups.js";
import { sitemapRouter } from "./routes/sitemap.js";
import { buildSeoHtml, isCrawler, injectMetaIntoSpa, escapeHtml } from "./seo.js";
import { toSlug, collectionToSlug } from "../shared/slugs.js";
import { TRADE_UP_TYPE_LABELS } from "../shared/types.js";

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
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import type { NextFunction } from "express";

const app = express();
const PORT = 3001;

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
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "https://avatars.steamstatic.com", "https://community.fastly.steamstatic.com", "data:"],
      connectSrc: ["'self'", "https://checkout.stripe.com"],
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

// Async startup: initialize PostgreSQL pool and create tables
(async () => {
  const pool: pg.Pool = initDb();
  await createTables(pool);
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

  // Dynamic OG image for shareable trade-up pages
  const { generateOgImage } = await import("./og-image.js");

  app.get("/og/trade-ups/:id.png", async (req, res) => {
    try {
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
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.send(png);
    } catch (e) {
      console.error("OG image error:", e instanceof Error ? e.message : e);
      res.status(500).end();
    }
  });

  // Dynamic OG tags + SEO for shareable trade-up pages (social/crawler bots)
  app.get("/trade-ups/:id", async (req, res, next) => {
    const ua = req.headers["user-agent"] || "";
    if (!isCrawler(ua)) return next();
    try {
      const { rows: [row] } = await pool.query(
        "SELECT type, total_cost_cents, profit_cents, roi_percentage, chance_to_profit, listing_status, preserved_at FROM trade_ups WHERE id = $1",
        [req.params.id]
      );
      if (!row) return next();
      const typeLabel = TRADE_UP_TYPE_LABELS[row.type] || row.type;
      const profit = (row.profit_cents / 100).toFixed(2);
      const cost = (row.total_cost_cents / 100).toFixed(2);
      const chance = Math.round((row.chance_to_profit ?? 0) * 100);
      const roi = row.roi_percentage?.toFixed(1) ?? "0";

      // Noindex stale or old preserved trade-ups
      const isStale = row.listing_status === "stale"
        || (row.preserved_at && Date.now() - new Date(row.preserved_at).getTime() > 7 * 24 * 60 * 60 * 1000);

      const { rows: inputs } = await pool.query(
        "SELECT skin_name, condition FROM trade_up_inputs WHERE trade_up_id = $1 LIMIT 3",
        [row.id ?? req.params.id]
      );
      const inputNames = inputs.map((i: { skin_name: string }) => i.skin_name).join(", ");

      res.send(buildSeoHtml({
        title: `${typeLabel} Trade-Up — $${profit} profit (${chance}% chance) | TradeUpBot`,
        description: `$${cost} cost, ${roi}% ROI. Inputs: ${inputNames}. Found on TradeUpBot.`,
        url: `https://tradeupbot.app/trade-ups/${req.params.id}`,
        ogImage: `https://tradeupbot.app/og/trade-ups/${req.params.id}.png`,
        robots: isStale ? "noindex, follow" : "index, follow",
        bodyText: `${typeLabel} Trade-Up: $${profit} profit, ${roi}% ROI, ${chance}% chance to profit. Cost: $${cost}. Inputs: ${inputNames}.`,
      }));
    } catch { next(); }
  });

  // SEO: crawler handler for /collections/:slug pages
  app.get("/collections/:slug", async (req, res, next) => {
    const ua = req.headers["user-agent"] || "";
    if (!isCrawler(ua)) return next();
    try {
      const { getCollectionSlugMap } = await import("./routes/data.js");
      const slugMap = await getCollectionSlugMap(pool);
      const collectionName = slugMap.get(req.params.slug);
      if (!collectionName) return next();
      const displayName = collectionName.replace(/^The\s+/i, "").replace(/\s+Collection$/i, "");

      res.send(buildSeoHtml({
        title: `${displayName} Collection — CS2 Trade-Ups & Skins | TradeUpBot`,
        description: `Browse skins and find profitable trade-ups from the ${displayName} collection.`,
        url: `https://tradeupbot.app/collections/${req.params.slug}`,
        bodyText: `${displayName} collection — browse skins and find profitable trade-ups on TradeUpBot.`,
      }));
    } catch { next(); }
  });

  // SEO: crawler handler for /skins/:slug pages
  app.get("/skins/:slug", async (req, res, next) => {
    const ua = req.headers["user-agent"] || "";
    if (!isCrawler(ua)) return next();
    try {
      const { getSlugMap } = await import("./routes/data.js");
      const slugMap = await getSlugMap(pool);
      const skinName = slugMap.get(req.params.slug);
      if (!skinName) return next();

      const { rows: [stats] } = await pool.query(`
        SELECT COUNT(l.id)::int as listing_count, MIN(l.price_cents) as min_price, MAX(l.price_cents) as max_price
        FROM skins s JOIN listings l ON s.id = l.skin_id
        WHERE s.name = $1 AND s.stattrak = false
      `, [skinName]);

      const listingCount = stats?.listing_count || 0;
      const minPrice = stats?.min_price ? (stats.min_price / 100).toFixed(2) : "N/A";
      const maxPrice = stats?.max_price ? (stats.max_price / 100).toFixed(2) : "N/A";
      const robots = listingCount < 5 ? "noindex, follow" : "index, follow";

      res.send(buildSeoHtml({
        title: `${skinName} Price & Float Data — CS2 | TradeUpBot`,
        description: `${skinName} prices from $${minPrice} to $${maxPrice}. ${listingCount} active listings across CSFloat, DMarket, and Skinport.`,
        url: `https://tradeupbot.app/skins/${req.params.slug}`,
        robots,
        bodyText: `${skinName} — ${listingCount} listings, $${minPrice} to $${maxPrice}. View price charts, float data, and trade-up opportunities on TradeUpBot.`,
      }));
    } catch { next(); }
  });

  // Serve built frontend in production (Vite handles this in dev via proxy)
  const distPath = path.join(__dirname, "..", "dist");
  if (fs.existsSync(distPath)) {
    // Read index.html once for meta injection on list pages
    const indexHtml = fs.readFileSync(path.join(distPath, "index.html"), "utf-8");

    // List pages: Googlebot gets server-rendered HTML with real DB data and NO JS bundle.
    // WRS executes JS which overwrites content with empty-state React render (API times out
    // during WRS render window). Without JS, WRS sees the server-rendered content directly.
    // Regular users get the SPA shell with injected meta tags.
    app.get("/trade-ups", async (req, res, next) => {
      const ua = req.headers["user-agent"] || "";
      if (!isCrawler(ua)) {
        res.setHeader("Content-Type", "text/html");
        res.send(injectMetaIntoSpa(indexHtml, {
          title: "CS2 Trade-Up Contracts — Live Profitable Deals | TradeUpBot",
          description: "Find profitable CS2 trade-up contracts from real marketplace listings. Filter by profit, ROI, cost, and rarity. Data from CSFloat, DMarket, and Skinport.",
          url: "https://tradeupbot.app/trade-ups",
        }));
        return;
      }
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
        const total = stats?.total || 0;
        const profitable = stats?.profitable || 0;
        const rows = topTradeUps.map((t: { id: number; type: string; total_cost_cents: number; profit_cents: number; roi_percentage: number; chance_to_profit: number }) =>
          `<tr><td><a href="/trade-ups/${t.id}">${TRADE_UP_TYPE_LABELS[t.type] || t.type}</a></td><td>$${(t.total_cost_cents / 100).toFixed(2)}</td><td>$${(t.profit_cents / 100).toFixed(2)}</td><td>${t.roi_percentage?.toFixed(1)}%</td><td>${Math.round((t.chance_to_profit ?? 0) * 100)}%</td></tr>`
        ).join("");
        res.setHeader("Content-Type", "text/html");
        res.send(buildSeoHtml({
          title: "CS2 Trade-Up Contracts — Live Profitable Deals | TradeUpBot",
          description: `${profitable.toLocaleString()} profitable trade-ups from ${total.toLocaleString()} active contracts. Real listings from CSFloat, DMarket, and Skinport.`,
          url: "https://tradeupbot.app/trade-ups",
          bodyText: `Browse ${total.toLocaleString()} active CS2 trade-up contracts. ${profitable.toLocaleString()} are currently profitable. Filter by rarity tier, ROI, profit, cost, and more.`,
          jsonLd: { "@context": "https://schema.org", "@type": "WebApplication", name: "TradeUpBot", url: "https://tradeupbot.app/trade-ups", applicationCategory: "GameApplication", operatingSystem: "Web", description: `${profitable} profitable CS2 trade-ups from ${total} active contracts.` },
        }).replace("</main>", `<table><thead><tr><th>Type</th><th>Cost</th><th>Profit</th><th>ROI</th><th>Chance</th></tr></thead><tbody>${rows}</tbody></table></main>`));
      } catch { next(); }
    });

    app.get("/collections", async (req, res, next) => {
      const ua = req.headers["user-agent"] || "";
      if (!isCrawler(ua)) {
        res.setHeader("Content-Type", "text/html");
        res.send(injectMetaIntoSpa(indexHtml, {
          title: "CS2 Collections — Browse All Weapon Cases & Collections | TradeUpBot",
          description: "Browse all CS2 collections. See skins, float ranges, and trade-up opportunities for every weapon case and collection.",
          url: "https://tradeupbot.app/collections",
        }));
        return;
      }
      try {
        const { rows } = await pool.query("SELECT name FROM collections ORDER BY name");
        const links = rows.map((c: { name: string }) => {
          const slug = collectionToSlug(c.name);
          return `<li><a href="/collections/${slug}">${escapeHtml(c.name)}</a></li>`;
        }).join("");
        res.setHeader("Content-Type", "text/html");
        res.send(buildSeoHtml({
          title: "CS2 Collections — Browse All Weapon Cases & Collections | TradeUpBot",
          description: `Browse ${rows.length} CS2 collections with skins, float ranges, and trade-up opportunities.`,
          url: "https://tradeupbot.app/collections",
          bodyText: `Browse all ${rows.length} CS2 collections on TradeUpBot.`,
        }).replace("</main>", `<ul>${links}</ul></main>`));
      } catch { next(); }
    });

    app.get("/skins", async (req, res, next) => {
      const ua = req.headers["user-agent"] || "";
      if (!isCrawler(ua)) {
        res.setHeader("Content-Type", "text/html");
        res.send(injectMetaIntoSpa(indexHtml, {
          title: "CS2 Skin Prices & Float Data — All Skins | TradeUpBot",
          description: "Browse CS2 skins with live prices from CSFloat, DMarket, and Skinport. Float values, price charts, and trade-up potential.",
          url: "https://tradeupbot.app/skins",
        }));
        return;
      }
      try {
        const { rows } = await pool.query(`
          SELECT s.name, COUNT(l.id)::int as listing_count
          FROM skins s JOIN listings l ON s.id = l.skin_id
          WHERE s.stattrak = false
          GROUP BY s.name HAVING COUNT(l.id) >= 5
          ORDER BY s.name LIMIT 200
        `);
        const links = rows.map((s: { name: string; listing_count: number }) => {
          const slug = toSlug(s.name);
          return `<li><a href="/skins/${slug}">${escapeHtml(s.name)}</a> (${s.listing_count} listings)</li>`;
        }).join("");
        res.setHeader("Content-Type", "text/html");
        res.send(buildSeoHtml({
          title: "CS2 Skin Prices & Float Data — All Skins | TradeUpBot",
          description: `Browse ${rows.length}+ CS2 skins with live prices from CSFloat, DMarket, and Skinport.`,
          url: "https://tradeupbot.app/skins",
          bodyText: `Browse CS2 skins with live market prices and float data.`,
        }).replace("</main>", `<ul>${links}</ul></main>`));
      } catch { next(); }
    });

    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Global error handler
  app.use((err: Error, _req: express.Request, res: express.Response, _next: NextFunction) => {
    console.error("Unhandled error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  });

  // Start listening
  app.listen(PORT, () => {
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
          await cacheSet("global_stats", data, 600);
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
      } catch (e) {
        console.error("Cache warming failed:", (e as Error).message);
      }
    }, 500);
  });
})();

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});
