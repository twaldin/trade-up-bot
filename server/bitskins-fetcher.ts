/**
 * Continuous BitSkins listing + sale fetcher — runs as a separate process.
 *
 * Fetches listings and sale history via REST API at ~2 RPS,
 * enriches listing float values via WebSocket extra_info channel.
 * Writes to isolated bitskins_* tables.
 *
 * Strategy (coverage-first):
 *   1. Coverage gaps (skins with fewest bitskins listings)
 *   2. Staleness refresh (re-check skins not fetched in 30+ minutes)
 *
 * Auth: API key from .env (BITSKINS_API_KEY).
 *
 * Usage:
 *   npx tsx server/bitskins-fetcher.ts
 */

import pg from "pg";
import path from "path";
import fs from "fs";
import WebSocket from "ws";
import { fileURLToPath } from "url";
import {
  fetchSkinCatalog,
  searchListings,
  fetchSaleHistory,
  parseSkinCatalog,
  parseSaleHistory,
  composeSaleId,
  stripCondition,
  extractCondition,
  isVanillaKnife,
  type BitskinsListing,
  type BitskinsSale,
} from "./sync/bitskins.js";

const { Pool } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const LOG_PATH = "/tmp/bitskins-fetcher.log";
const STATUS_META_KEY = "bitskins_fetcher_status";

function log(msg: string) {
  const line = `[${new Date().toISOString().replace("T", " ").slice(0, 19)}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_PATH, line + "\n");
}

// ---------- Stats ----------

interface FetchStats {
  totalCalls: number;
  totalListingsStored: number;
  totalSalesStored: number;
  totalObservationsStored: number;
  totalFloatsEnriched: number;
  coverageFetched: number;
  cycleCount: number;
  startedAt: string;
  lastSkinFetched: string;
  errorsThisHour: number;
  wsConnected: boolean;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
}

const stats: FetchStats = {
  totalCalls: 0,
  totalListingsStored: 0,
  totalSalesStored: 0,
  totalObservationsStored: 0,
  totalFloatsEnriched: 0,
  coverageFetched: 0,
  cycleCount: 0,
  startedAt: new Date().toISOString(),
  lastSkinFetched: "",
  errorsThisHour: 0,
  wsConnected: false,
  lastSuccessAt: null,
  lastErrorAt: null,
  lastError: null,
};

// ---------- DB queries ----------

async function getCoverageGaps(pool: pg.Pool, limit: number = 200) {
  const { rows } = await pool.query(`
    SELECT s.name as "skinName", s.rarity,
      COALESCE(bl.cnt, 0) as "listingCount"
    FROM skins s
    LEFT JOIN (
      SELECT skin_id, COUNT(*) as cnt FROM bitskins_listings GROUP BY skin_id
    ) bl ON s.id = bl.skin_id
    WHERE s.stattrak = false AND s.souvenir = false
      AND s.rarity IN ('Covert', 'Classified', 'Restricted', 'Mil-Spec', 'Extraordinary', 'Industrial Grade', 'Consumer Grade')
    ORDER BY COALESCE(bl.cnt, 0) ASC
    LIMIT $1
  `, [limit]);
  return rows.map((r: any) => ({ skinName: r.skinName, rarity: r.rarity, listingCount: Number(r.listingCount) }));
}

async function getStaleSkins(pool: pg.Pool, limit: number = 100) {
  const { rows } = await pool.query(`
    SELECT s.name
    FROM skins s
    JOIN bitskins_listings bl ON s.id = bl.skin_id
    WHERE s.stattrak = false AND s.souvenir = false
      AND s.rarity IN ('Covert', 'Classified', 'Restricted', 'Mil-Spec', 'Extraordinary', 'Industrial Grade', 'Consumer Grade')
    GROUP BY s.id, s.name
    HAVING MAX(bl.fetched_at) < NOW() - INTERVAL '30 minutes'
    ORDER BY MAX(bl.fetched_at) ASC
    LIMIT $1
  `, [limit]);
  return rows.map((r: any) => r.name);
}

async function buildFetchQueue(pool: pg.Pool): Promise<string[]> {
  const queue: string[] = [];
  const seen = new Set<string>();
  const gaps = await getCoverageGaps(pool, 200);
  for (const g of gaps) {
    if (!seen.has(g.skinName)) { queue.push(g.skinName); seen.add(g.skinName); }
  }
  const stale = await getStaleSkins(pool, 100);
  for (const s of stale) {
    if (!seen.has(s)) { queue.push(s); seen.add(s); }
  }
  return queue;
}

// ---------- Data storage ----------

async function upsertListing(pool: pg.Pool, listing: BitskinsListing, skinId: string) {
  await pool.query(`
    INSERT INTO bitskins_listings (id, skin_id, bitskins_skin_id, price_cents, stattrak, fetched_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
    ON CONFLICT (id) DO UPDATE SET
      price_cents = $4, fetched_at = NOW()
  `, [listing.id, skinId, listing.skinId, listing.priceCents, listing.stattrak]);
}

async function insertSale(
  pool: pg.Pool,
  sale: BitskinsSale,
  skinName: string,
  condition: string,
  vanilla: boolean,
): Promise<{ saleInserted: boolean; obsInserted: boolean }> {
  let saleInserted = false;
  let obsInserted = false;

  const saleId = composeSaleId(sale.skinId || 0, sale.transactTime, sale.priceCents);

  try {
    const { rowCount } = await pool.query(`
      INSERT INTO bitskins_sale_history (id, skin_name, condition, price_cents, float_value, sold_at, bitskins_skin_id)
      VALUES ($1, $2, $3, $4, $5, to_timestamp($6), $7)
      ON CONFLICT (id) DO NOTHING
    `, [saleId, skinName, condition, sale.priceCents, sale.floatValue >= 0 ? sale.floatValue : null, sale.transactTime, sale.skinId]);
    saleInserted = (rowCount ?? 0) > 0;
  } catch { /* duplicate */ }

  if (!vanilla && sale.floatValue >= 0 && sale.floatValue <= 1) {
    try {
      const { rowCount } = await pool.query(`
        INSERT INTO bitskins_observations (skin_name, float_value, price_cents, observed_at)
        VALUES ($1, $2, $3, to_timestamp($4))
        ON CONFLICT (skin_name, float_value, price_cents) DO NOTHING
      `, [skinName, sale.floatValue, sale.priceCents, sale.transactTime]);
      obsInserted = (rowCount ?? 0) > 0;
    } catch { /* duplicate */ }
  }

  return { saleInserted, obsInserted };
}

async function writeStatus(pool: pg.Pool) {
  await pool.query(
    "INSERT INTO sync_meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2",
    [STATUS_META_KEY, JSON.stringify({ ...stats, updatedAt: new Date().toISOString() })],
  );
}

// ---------- WebSocket float enrichment ----------

function connectWebSocket(pool: pg.Pool, apiKey: string): WebSocket {
  const ws = new WebSocket("wss://ws.bitskins.com");

  ws.on("open", () => {
    log("  WebSocket connected");
    stats.wsConnected = true;
    ws.send(JSON.stringify(["WS_AUTH_APIKEY", apiKey]));
    ws.send(JSON.stringify(["WS_SUB", "extra_info"]));
    ws.send(JSON.stringify(["WS_SUB", "delisted_or_sold"]));
  });

  ws.on("message", async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (!Array.isArray(msg) || msg.length < 2) return;
      const [channel, payload] = msg;

      if (channel === "extra_info" && payload?.id) {
        // Float enrichment: update stored listing with float data
        const floatVal = payload.float_value ?? payload.floatvalue ?? null;
        const paintSeed = payload.paint_seed ?? payload.paintseed ?? null;
        if (floatVal != null && typeof floatVal === "number") {
          const { rowCount } = await pool.query(
            "UPDATE bitskins_listings SET float_value = $1, paint_seed = $2 WHERE id = $3 AND float_value IS NULL",
            [floatVal, paintSeed, String(payload.id)],
          );
          if ((rowCount ?? 0) > 0) stats.totalFloatsEnriched++;
        }
      } else if (channel === "delisted_or_sold" && payload?.id) {
        await pool.query("DELETE FROM bitskins_listings WHERE id = $1", [String(payload.id)]);
      }
    } catch { /* malformed message */ }
  });

  ws.on("close", () => {
    log("  WebSocket disconnected — reconnecting in 5s");
    stats.wsConnected = false;
    setTimeout(() => {
      try { connectWebSocket(pool, apiKey); } catch { /* retry next cycle */ }
    }, 5000);
  });

  ws.on("error", (err) => {
    log(`  WebSocket error: ${(err as Error).message?.slice(0, 100)}`);
  });

  return ws;
}

// ---------- Skin fetching ----------

interface SkinFetchResult {
  listingsInserted: number;
  listingsRemoved: number;
  salesInserted: number;
  observationsInserted: number;
  apiCalls: number;
}

async function fetchSkinData(
  pool: pg.Pool,
  skinName: string,
  skinIdMap: Map<string, number>,
  apiKey: string,
): Promise<SkinFetchResult> {
  const result: SkinFetchResult = { listingsInserted: 0, listingsRemoved: 0, salesInserted: 0, observationsInserted: 0, apiCalls: 0 };

  // Find all conditions for this skin that have a bitskins skin_id
  const conditions = ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"];
  const conditionEntries: { condition: string; bsSkinId: number; marketHashName: string }[] = [];

  for (const cond of conditions) {
    const hashName = `${skinName} (${cond})`;
    const bsSkinId = skinIdMap.get(hashName);
    if (bsSkinId) {
      conditionEntries.push({ condition: cond, bsSkinId, marketHashName: hashName });
    }
  }

  // Vanilla knives
  if (isVanillaKnife(skinName)) {
    const bsSkinId = skinIdMap.get(skinName);
    if (bsSkinId) {
      conditionEntries.push({ condition: "Vanilla", bsSkinId, marketHashName: skinName });
    }
  }

  if (conditionEntries.length === 0) return result;

  // Resolve our internal skin_id
  const { rows: skinRows } = await pool.query(
    "SELECT id FROM skins WHERE name = $1 AND stattrak = false LIMIT 1",
    [skinName],
  );
  const internalSkinId = (skinRows[0] as { id: string } | undefined)?.id;
  if (!internalSkinId) return result;

  for (const entry of conditionEntries) {
    const activeIds = new Set<string>();
    const vanilla = entry.condition === "Vanilla";
    const bareSkinName = vanilla ? skinName : stripCondition(entry.marketHashName);

    // Interleave listing pages and sale pages
    let listingOffset = 0;
    let salePage = 0;
    let listingTotal = 1;
    let listingsDone = false;
    let salesDone = false;
    const PAGE_SIZE = 50;

    while (!listingsDone || !salesDone) {
      // Listing page
      if (!listingsDone) {
        try {
          const searchResult = await searchListings(entry.bsSkinId, apiKey, { limit: PAGE_SIZE, offset: listingOffset });
          result.apiCalls++;
          listingTotal = searchResult.total;

          for (const item of searchResult.listings) {
            if (item.stattrak) continue; // skip StatTrak
            activeIds.add(item.id);
            await upsertListing(pool, item, internalSkinId);
            result.listingsInserted++;
          }

          if (listingOffset + PAGE_SIZE >= listingTotal || searchResult.listings.length === 0) {
            listingsDone = true;
          } else {
            listingOffset += PAGE_SIZE;
          }
        } catch (err) {
          const msg = (err as Error).message;
          if (msg.includes("429")) throw err;
          listingsDone = true;
        }
      }

      // Sale page
      if (!salesDone) {
        try {
          const sales = await fetchSaleHistory(entry.bsSkinId, apiKey, PAGE_SIZE);
          result.apiCalls++;

          let newSalesOnPage = 0;
          for (const sale of sales) {
            const { saleInserted, obsInserted } = await insertSale(pool, sale, bareSkinName, entry.condition, vanilla);
            if (saleInserted) { result.salesInserted++; newSalesOnPage++; }
            if (obsInserted) result.observationsInserted++;
          }

          // Sale dedup: if all sales on this page already stored, stop
          if (sales.length > 0 && newSalesOnPage === 0) {
            salesDone = true;
          } else {
            salesDone = true; // BitSkins pricing/list doesn't paginate like buff — single batch
          }
        } catch (err) {
          const msg = (err as Error).message;
          if (msg.includes("429")) throw err;
          salesDone = true;
        }
      }
    }

    // Staleness diff: remove stored listings not in API response
    if (activeIds.size > 0) {
      const { rows: stored } = await pool.query(
        "SELECT id FROM bitskins_listings WHERE skin_id = $1 AND bitskins_skin_id = $2",
        [internalSkinId, entry.bsSkinId],
      );
      for (const s of stored) {
        if (!activeIds.has(s.id)) {
          await pool.query("DELETE FROM bitskins_listings WHERE id = $1", [s.id]);
          result.listingsRemoved++;
        }
      }
    }
  }

  return result;
}

// ---------- Main loop ----------

async function main() {
  const apiKey = process.env.BITSKINS_API_KEY;
  if (!apiKey) {
    log("ERROR: BITSKINS_API_KEY not set in .env");
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_URL
    || "postgresql://localhost:5432/tradeupbot";
  const pool = new Pool({ connectionString, max: 5, idleTimeoutMillis: 30_000 });

  log("BitSkins continuous fetcher started");
  log(`  DB: PostgreSQL (${connectionString.replace(/:[^@]*@/, ":***@")})`);
  log(`  Log: ${LOG_PATH}`);
  log(`  Rate limit: ~2 RPS (500ms interval)`);

  // Fetch skin catalog
  log("  Loading skin catalog from BitSkins API...");
  const catalog = await fetchSkinCatalog(apiKey);
  const skinIdMap = parseSkinCatalog(catalog);
  log(`  Loaded ${skinIdMap.size} skin ID mappings`);

  // Ensure tables exist
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bitskins_listings (
      id TEXT PRIMARY KEY,
      skin_id TEXT NOT NULL,
      bitskins_skin_id INTEGER NOT NULL,
      price_cents INTEGER NOT NULL,
      float_value DOUBLE PRECISION,
      paint_seed INTEGER,
      stattrak BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      FOREIGN KEY (skin_id) REFERENCES skins(id)
    );
    CREATE INDEX IF NOT EXISTS idx_bitskins_listings_skin ON bitskins_listings(skin_id);
    CREATE INDEX IF NOT EXISTS idx_bitskins_listings_fetched ON bitskins_listings(fetched_at);
    CREATE INDEX IF NOT EXISTS idx_bitskins_listings_float ON bitskins_listings(float_value) WHERE float_value IS NOT NULL;

    CREATE TABLE IF NOT EXISTS bitskins_sale_history (
      id TEXT PRIMARY KEY,
      skin_name TEXT NOT NULL,
      condition TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      float_value DOUBLE PRECISION,
      sold_at TIMESTAMPTZ NOT NULL,
      bitskins_skin_id INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_bitskins_sales_skin ON bitskins_sale_history(skin_name, condition);

    CREATE TABLE IF NOT EXISTS bitskins_observations (
      id SERIAL PRIMARY KEY,
      skin_name TEXT NOT NULL,
      float_value DOUBLE PRECISION NOT NULL,
      price_cents INTEGER NOT NULL,
      observed_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(skin_name, float_value, price_cents)
    );
    CREATE INDEX IF NOT EXISTS idx_bitskins_obs_skin ON bitskins_observations(skin_name);
  `);
  log("  BitSkins tables ready");

  // Connect WebSocket for float enrichment
  let ws: WebSocket | null = null;
  try {
    ws = connectWebSocket(pool, apiKey);
  } catch (err) {
    log(`  WebSocket failed to connect: ${(err as Error).message} — continuing without float enrichment`);
  }

  // Graceful shutdown
  let running = true;
  process.on("SIGINT", () => { running = false; log("Shutting down..."); });
  process.on("SIGTERM", () => { running = false; log("Shutting down..."); });

  // Reset hourly error counter
  setInterval(() => { stats.errorsThisHour = 0; }, 3600_000);

  while (running) {
    stats.cycleCount++;
    let queue: string[];
    try {
      queue = await buildFetchQueue(pool);
    } catch {
      log("  DB error during queue build — waiting 10s");
      await new Promise(r => setTimeout(r, 10_000));
      continue;
    }
    log(`\nCycle ${stats.cycleCount}: ${queue.length} skins to fetch`);
    try { await writeStatus(pool); } catch { /* non-critical */ }

    let cycleCalls = 0;
    let cycleListings = 0;
    let cycleSales = 0;
    let cycleErrors = 0;

    for (const skinName of queue) {
      if (!running) break;

      try {
        const result = await fetchSkinData(pool, skinName, skinIdMap, apiKey);

        stats.totalCalls += result.apiCalls;
        stats.totalListingsStored += result.listingsInserted;
        stats.totalSalesStored += result.salesInserted;
        stats.totalObservationsStored += result.observationsInserted;
        stats.lastSkinFetched = skinName;
        stats.lastSuccessAt = new Date().toISOString();
        stats.coverageFetched++;

        cycleCalls += result.apiCalls;
        cycleListings += result.listingsInserted;
        cycleSales += result.salesInserted;

        if (stats.coverageFetched % 50 === 0 && stats.coverageFetched > 0) {
          log(`  Progress: ${stats.coverageFetched}/${queue.length} skins, ${cycleListings} listings, ${cycleSales} sales, ${stats.totalFloatsEnriched} floats enriched`);
          try { await writeStatus(pool); } catch { /* non-critical */ }
        }
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes("429")) {
          log(`  Rate limited — backing off 30s`);
          stats.errorsThisHour++;
          stats.lastErrorAt = new Date().toISOString();
          stats.lastError = "429 rate limited";
          await new Promise(r => setTimeout(r, 30_000));
        } else {
          cycleErrors++;
          stats.errorsThisHour++;
          if (cycleErrors <= 5) {
            log(`  Error fetching ${skinName}: ${msg.slice(0, 100)}`);
          }
          stats.lastErrorAt = new Date().toISOString();
          stats.lastError = msg.slice(0, 200);
        }
      }
    }

    log(`Cycle ${stats.cycleCount} complete: ${cycleCalls} API calls, ${cycleListings} listings, ${cycleSales} sales, ${cycleErrors} errors`);
    try { await writeStatus(pool); } catch { /* non-critical */ }

    if (running) {
      log("  Waiting 30s before next cycle...");
      await new Promise(r => setTimeout(r, 30_000));
    }
  }

  try { await writeStatus(pool); } catch { /* non-critical */ }
  if (ws) ws.close();
  await pool.end();
  log("BitSkins fetcher stopped");
}

main().catch(err => {
  log(`FATAL: ${(err as Error).message ?? ""}`);
  process.exit(1);
});
