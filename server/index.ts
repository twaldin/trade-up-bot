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

// Build forward map: collection name → knife/glove pool
const collectionKnifePool = new Map<string, { knifeTypes: string[]; gloveTypes: string[]; finishCount: number }>();
for (const [collectionName, mapping] of Object.entries(CASE_KNIFE_MAP)) {
  const knPool: { knifeTypes: string[]; gloveTypes: string[]; finishCount: number } = {
    knifeTypes: [...mapping.knifeTypes],
    gloveTypes: [],
    finishCount: mapping.knifeFinishes?.length ?? 0,
  };
  if (mapping.gloveGen) {
    const genSkins = GLOVE_GEN_SKINS[mapping.gloveGen];
    if (genSkins) knPool.gloveTypes = Object.keys(genSkins);
  }
  collectionKnifePool.set(collectionName, knPool);
}

// Load .env
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^(\w+)=(.*)$/);
    if (match) process.env[match[1]] = match[2].trim();
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
  app.use(stripeRouter(pool));

  // Serve built frontend in production (Vite handles this in dev via proxy)
  const distPath = path.join(__dirname, "..", "dist");
  if (fs.existsSync(distPath)) {
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
              (SELECT COUNT(*) FROM trade_ups WHERE is_theoretical = 0) as total_tu,
              (SELECT SUM(CASE WHEN profit_cents > 0 THEN 1 ELSE 0 END) FROM trade_ups WHERE is_theoretical = 0) as profitable_tu,
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
