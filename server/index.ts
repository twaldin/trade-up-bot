import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { initDb, getReadDb } from "./db.js";
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
  const pool: { knifeTypes: string[]; gloveTypes: string[]; finishCount: number } = {
    knifeTypes: [...mapping.knifeTypes],
    gloveTypes: [],
    finishCount: mapping.knifeFinishes?.length ?? 0,
  };
  if (mapping.gloveGen) {
    const genSkins = GLOVE_GEN_SKINS[mapping.gloveGen];
    if (genSkins) pool.gloveTypes = Object.keys(genSkins);
  }
  collectionKnifePool.set(collectionName, pool);
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
const rlKeyGen = (req: express.Request) => (req.headers["x-real-ip"] as string) || req.ip || "unknown";
const rlOpts = { validate: { xForwardedForHeader: false } }; // nginx sets x-real-ip, not x-forwarded-for
app.use(rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false, keyGenerator: rlKeyGen, ...rlOpts }));
app.use("/auth", rateLimit({ windowMs: 60_000, max: 10, keyGenerator: rlKeyGen, ...rlOpts }));
app.use("/api/subscribe", rateLimit({ windowMs: 60_000, max: 5, keyGenerator: rlKeyGen, ...rlOpts }));
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

const db = initDb();
const readDb = getReadDb(); // Read-only connection — never blocked by daemon writes

// Auth (Steam OpenID + sessions) — must be before route mounting (needs write access)
setupAuth(app, db);

// Mount route modules — read-heavy routes use readDb for non-blocking reads
app.use(statusRouter(readDb));
app.use(tradeUpsRouter(db, readDb));  // readDb for queries, db for writes
app.use(dataRouter(readDb, knifeTypeToCases, collectionKnifePool));
app.use(collectionsRouter(readDb, collectionKnifePool));
app.use(snapshotsRouter(db));
app.use(calculatorRouter(db));
app.use(claimsRouter(db));
app.use(stripeRouter(db));

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

app.listen(PORT, () => {
  console.log(`Trade-Up Bot API running at http://localhost:${PORT}`);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});
