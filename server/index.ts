import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { initDb } from "./db.js";
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

const app = express();
const PORT = 3001;

app.use(compression());
app.use(cors({ origin: true, credentials: true }));
// Stripe webhook needs raw body for signature verification — capture it before JSON parsing
app.use((req, res, next) => {
  if (req.path === "/api/stripe-webhook") {
    express.raw({ type: "application/json" })(req, res, next);
  } else {
    express.json()(req, res, next);
  }
});

const db = initDb();

// Auth (Steam OpenID + sessions) — must be before route mounting
setupAuth(app, db);

// Mount route modules
app.use(statusRouter(db));
app.use(tradeUpsRouter(db));
app.use(dataRouter(db, knifeTypeToCases, collectionKnifePool));
app.use(collectionsRouter(db, collectionKnifePool));
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

app.listen(PORT, () => {
  console.log(`Trade-Up Bot API running at http://localhost:${PORT}`);
});
