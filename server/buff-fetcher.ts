/**
 * Continuous buff.market listing + sale fetcher — runs as a separate process.
 *
 * Fetches buff.market listings and sale history at ~15 req/min (4s interval),
 * completely independent of the main daemon process. Writes to isolated
 * buff_listings, buff_sale_history, and buff_observations tables.
 *
 * Strategy (coverage-first):
 *   1. Coverage gaps (skins with fewest buff listings)
 *   2. Staleness refresh (re-check skins not fetched in 30+ minutes)
 *
 * Auth: Session cookie read from Redis (hot-reloadable).
 *   redis-cli SET buff_session_cookie "<cookie string>"
 *
 * Usage:
 *   npx tsx server/buff-fetcher.ts
 */

import pg from "pg";
import path from "path";
import fs from "fs";
import Redis from "ioredis";
import { fileURLToPath } from "url";
import {
  fetchBuffListings,
  fetchBuffSales,
  type BuffListing,
  type BuffSale,
} from "./sync/buff.js";

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

const LOG_PATH = "/tmp/buff-fetcher.log";
const COOKIE_REDIS_KEY = "buff_session_cookie";
const COOKIE_CACHE_TTL_MS = 60_000; // re-read from Redis every 60s
const SLEEP_MODE_INTERVAL_MS = 15 * 60 * 1000; // check for new cookie every 15 min
const STATUS_META_KEY = "buff_fetcher_status";

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
  coverageFetched: number;
  cycleCount: number;
  startedAt: string;
  lastSkinFetched: string;
  errorsThisHour: number;
  cookieHealthy: boolean;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
}

const stats: FetchStats = {
  totalCalls: 0,
  totalListingsStored: 0,
  totalSalesStored: 0,
  totalObservationsStored: 0,
  coverageFetched: 0,
  cycleCount: 0,
  startedAt: new Date().toISOString(),
  lastSkinFetched: "",
  errorsThisHour: 0,
  cookieHealthy: true,
  lastSuccessAt: null,
  lastErrorAt: null,
  lastError: null,
};

// ---------- Goods ID mapping ----------

type GoodsIdMap = Map<string, number>; // market_hash_name → buffmarket_goods_id

function loadGoodsIdMapping(): GoodsIdMap {
  const mapPath = path.join(__dirname, "..", "data", "cs2-marketplace-ids.json");
  if (!fs.existsSync(mapPath)) {
    throw new Error(`Goods ID mapping not found at ${mapPath}. Download from https://github.com/ModestSerhat/cs2-marketplace-ids`);
  }
  const raw = JSON.parse(fs.readFileSync(mapPath, "utf-8"));
  const items = raw.items ?? raw; // support both {items: {...}} and flat format
  const map: GoodsIdMap = new Map();
  for (const [name, data] of Object.entries(items)) {
    const d = data as { buffmarket_goods_id?: number };
    if (d.buffmarket_goods_id) {
      map.set(name, d.buffmarket_goods_id);
    }
  }
  log(`  Loaded ${map.size} goods ID mappings`);
  return map;
}

/** Strip condition suffix from market_hash_name to get skin name.
 *  "AK-47 | Redline (Field-Tested)" → "AK-47 | Redline"
 *  "★ Karambit | Fade (Factory New)" → "★ Karambit | Fade" */
function stripCondition(marketHashName: string): string {
  return marketHashName
    .replace(/\s*\((?:Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)\s*$/, "")
    .trim();
}

/** Extract condition from market_hash_name.
 *  "AK-47 | Redline (Field-Tested)" → "Field-Tested" */
function extractCondition(marketHashName: string): string | null {
  const match = marketHashName.match(/\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)\s*$/);
  return match ? match[1] : null;
}

// ---------- Cookie management ----------

let _cachedCookie: string | null = null;
let _cookieFetchedAt = 0;

async function getCookie(redis: Redis): Promise<string | null> {
  const now = Date.now();
  if (_cachedCookie && (now - _cookieFetchedAt) < COOKIE_CACHE_TTL_MS) {
    return _cachedCookie;
  }
  try {
    const cookie = await redis.get(COOKIE_REDIS_KEY);
    _cachedCookie = cookie;
    _cookieFetchedAt = now;
    return cookie;
  } catch {
    return _cachedCookie; // return stale cache on Redis error
  }
}

// ---------- DB queries ----------

async function getCoverageGaps(
  pool: pg.Pool,
  limit: number = 200,
): Promise<{ skinName: string; marketHashName: string; rarity: string; listingCount: number }[]> {
  // Get skins with fewest buff listings, across all rarities
  // We query by market_hash_name (with condition) since buff uses goods_id per condition
  const { rows } = await pool.query(`
    SELECT s.name as "skinName", s.rarity,
      COALESCE(bl.cnt, 0) as "listingCount"
    FROM skins s
    LEFT JOIN (
      SELECT skin_id, COUNT(*) as cnt FROM buff_listings GROUP BY skin_id
    ) bl ON s.id = bl.skin_id
    WHERE s.stattrak = false AND s.souvenir = false
      AND s.rarity IN ('Covert', 'Classified', 'Restricted', 'Mil-Spec', 'Extraordinary', 'Industrial Grade', 'Consumer Grade')
    ORDER BY COALESCE(bl.cnt, 0) ASC
    LIMIT $1
  `, [limit]);
  return rows.map((r: any) => ({
    skinName: r.skinName,
    marketHashName: "", // will be resolved per-condition via goods ID map
    rarity: r.rarity,
    listingCount: Number(r.listingCount),
  }));
}

async function getStaleSkins(
  pool: pg.Pool,
  limit: number = 100,
): Promise<string[]> {
  const { rows } = await pool.query(`
    SELECT s.name
    FROM skins s
    JOIN buff_listings bl ON s.id = bl.skin_id
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
    if (!seen.has(g.skinName)) {
      queue.push(g.skinName);
      seen.add(g.skinName);
    }
  }

  const stale = await getStaleSkins(pool, 100);
  for (const s of stale) {
    if (!seen.has(s)) {
      queue.push(s);
      seen.add(s);
    }
  }

  return queue;
}

// ---------- Data storage ----------

async function upsertBuffListing(
  pool: pg.Pool,
  listing: BuffListing,
  skinId: string,
): Promise<boolean> {
  const { rowCount } = await pool.query(`
    INSERT INTO buff_listings (id, skin_id, price_cents, float_value, paint_seed, paint_index, stattrak, fetched_at, buff_goods_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)
    ON CONFLICT (id) DO UPDATE SET
      price_cents = $3, float_value = $4, paint_seed = $5, paint_index = $6,
      fetched_at = NOW(), buff_goods_id = $8
  `, [listing.id, skinId, listing.priceCents, listing.floatValue, listing.paintSeed, listing.paintIndex, listing.stattrak, listing.goodsId]);
  return (rowCount ?? 0) > 0;
}

async function insertBuffSale(
  pool: pg.Pool,
  sale: BuffSale,
  skinName: string,
  condition: string,
  isVanilla: boolean,
): Promise<{ saleInserted: boolean; obsInserted: boolean }> {
  let saleInserted = false;
  let obsInserted = false;

  // Sale history
  try {
    const { rowCount } = await pool.query(`
      INSERT INTO buff_sale_history (id, skin_name, condition, price_cents, float_value, sold_at, buff_goods_id)
      VALUES ($1, $2, $3, $4, $5, to_timestamp($6), $7)
      ON CONFLICT (id) DO NOTHING
    `, [sale.id, skinName, condition, sale.priceCents, sale.floatValue >= 0 ? sale.floatValue : null, sale.transactTime, sale.goodsId]);
    saleInserted = (rowCount ?? 0) > 0;
  } catch { /* duplicate or constraint violation */ }

  // Observation (only if float is valid and NOT a vanilla knife — vanilla knives have no float-price relationship)
  if (!isVanilla && sale.floatValue >= 0 && sale.floatValue <= 1) {
    try {
      const { rowCount } = await pool.query(`
        INSERT INTO buff_observations (skin_name, float_value, price_cents, observed_at)
        VALUES ($1, $2, $3, to_timestamp($4))
        ON CONFLICT (skin_name, float_value, price_cents) DO NOTHING
      `, [skinName, sale.floatValue, sale.priceCents, sale.transactTime]);
      obsInserted = (rowCount ?? 0) > 0;
    } catch { /* duplicate */ }
  }

  return { saleInserted, obsInserted };
}

// ---------- Status writing ----------

async function writeStatus(pool: pg.Pool) {
  await pool.query(
    "INSERT INTO sync_meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2",
    [STATUS_META_KEY, JSON.stringify({ ...stats, updatedAt: new Date().toISOString() })],
  );
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
  goodsIdMap: GoodsIdMap,
  cookie: string,
): Promise<SkinFetchResult> {
  const result: SkinFetchResult = { listingsInserted: 0, listingsRemoved: 0, salesInserted: 0, observationsInserted: 0, apiCalls: 0 };

  // Find all conditions for this skin that have a buff goods_id
  const conditions = ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"];
  const conditionEntries: { condition: string; goodsId: number; marketHashName: string }[] = [];

  for (const cond of conditions) {
    const hashName = `${skinName} (${cond})`;
    const goodsId = goodsIdMap.get(hashName);
    if (goodsId) {
      conditionEntries.push({ condition: cond, goodsId, marketHashName: hashName });
    }
  }

  // Also check vanilla knife format: "★ Karambit" (no condition, no pipe)
  if (skinName.startsWith("★") && !skinName.includes("|")) {
    const goodsId = goodsIdMap.get(skinName);
    if (goodsId) {
      conditionEntries.push({ condition: "Vanilla", goodsId, marketHashName: skinName });
    }
  }

  if (conditionEntries.length === 0) return result;

  // Resolve skin_id once
  const { rows: skinRows } = await pool.query(
    "SELECT id FROM skins WHERE name = $1 AND stattrak = false LIMIT 1",
    [skinName],
  );
  const skinId = (skinRows[0] as { id: string } | undefined)?.id;
  if (!skinId) return result;

  for (const entry of conditionEntries) {
    const activeBuffIds = new Set<string>();

    // Interleave listing pages and sale pages
    let listingPage = 1;
    let salePage = 1;
    let listingTotalPages = 1;
    let saleTotalPages = 1;
    let listingsDone = false;
    let salesDone = false;

    while (!listingsDone || !salesDone) {
      // Fetch a listing page
      if (!listingsDone) {
        try {
          const listingResult = await fetchBuffListings(entry.goodsId, listingPage, cookie);
          result.apiCalls++;
          listingTotalPages = listingResult.totalPages;

          for (const item of listingResult.items) {
            if (item.stattrak || item.souvenir) continue;
            activeBuffIds.add(item.id);
            const ok = await upsertBuffListing(pool, item, skinId);
            if (ok) result.listingsInserted++;
          }

          if (listingPage >= listingTotalPages || listingResult.items.length === 0) {
            listingsDone = true;
          } else {
            listingPage++;
          }
        } catch (err) {
          const msg = (err as Error).message;
          if (msg.includes("login required")) throw err; // bubble up auth errors
          if (msg.includes("429")) throw err;
          listingsDone = true; // skip remaining pages on other errors
        }
      }

      // Fetch a sale page
      if (!salesDone) {
        try {
          const saleResult = await fetchBuffSales(entry.goodsId, salePage, cookie);
          result.apiCalls++;
          saleTotalPages = saleResult.totalPages;

          const isVanilla = entry.condition === "Vanilla";
          const bareSkinName = isVanilla ? skinName : stripCondition(entry.marketHashName);
          const condition = entry.condition;

          let newSalesOnPage = 0;
          for (const sale of saleResult.items) {
            const { saleInserted, obsInserted } = await insertBuffSale(pool, sale, bareSkinName, condition, isVanilla);
            if (saleInserted) { result.salesInserted++; newSalesOnPage++; }
            if (obsInserted) result.observationsInserted++;
          }

          // bill_order returns newest-first. If every sale on this page was already
          // in our DB, everything beyond is older and already stored — stop early.
          if (saleResult.items.length > 0 && newSalesOnPage === 0) {
            salesDone = true;
          } else if (salePage >= saleTotalPages || saleResult.items.length === 0) {
            salesDone = true;
          } else {
            salePage++;
          }
        } catch (err) {
          const msg = (err as Error).message;
          if (msg.includes("login required")) throw err;
          if (msg.includes("429")) throw err;
          salesDone = true;
        }
      }
    }

    // Staleness diff: remove stored buff listings for this goods_id that aren't in API response
    if (activeBuffIds.size > 0) {
      const { rows: stored } = await pool.query(
        "SELECT id FROM buff_listings WHERE skin_id = $1 AND buff_goods_id = $2",
        [skinId, entry.goodsId],
      );
      for (const s of stored) {
        if (!activeBuffIds.has(s.id)) {
          await pool.query("DELETE FROM buff_listings WHERE id = $1", [s.id]);
          result.listingsRemoved++;
        }
      }
    }
  }

  return result;
}

// ---------- Main loop ----------

async function main() {
  const connectionString = process.env.DATABASE_URL
    || "postgresql://tradeupbot:tradeupbot_pg_2026@localhost:5432/tradeupbot";
  const pool = new Pool({ connectionString, max: 5, idleTimeoutMillis: 30_000 });

  // Redis connection
  const redis = new Redis({ host: "127.0.0.1", port: 6379, maxRetriesPerRequest: 1 });

  log("Buff.market continuous fetcher started");
  log(`  DB: PostgreSQL (${connectionString.replace(/:[^@]*@/, ":***@")})`);
  log(`  Redis: 127.0.0.1:6379`);
  log(`  Log: ${LOG_PATH}`);
  log(`  Rate limit: ~15 req/min (4s interval)`);

  // Load goods ID mapping
  const goodsIdMap = loadGoodsIdMapping();

  // Ensure buff tables exist
  await pool.query(`
    CREATE TABLE IF NOT EXISTS buff_listings (
      id TEXT PRIMARY KEY,
      skin_id TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      float_value DOUBLE PRECISION NOT NULL,
      paint_seed INTEGER,
      paint_index INTEGER,
      stattrak BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      buff_goods_id INTEGER NOT NULL,
      FOREIGN KEY (skin_id) REFERENCES skins(id)
    );
    CREATE INDEX IF NOT EXISTS idx_buff_listings_skin ON buff_listings(skin_id);
    CREATE INDEX IF NOT EXISTS idx_buff_listings_fetched ON buff_listings(fetched_at);

    CREATE TABLE IF NOT EXISTS buff_sale_history (
      id TEXT PRIMARY KEY,
      skin_name TEXT NOT NULL,
      condition TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      float_value DOUBLE PRECISION,
      sold_at TIMESTAMPTZ NOT NULL,
      buff_goods_id INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_buff_sales_skin ON buff_sale_history(skin_name, condition);

    CREATE TABLE IF NOT EXISTS buff_observations (
      id SERIAL PRIMARY KEY,
      skin_name TEXT NOT NULL,
      float_value DOUBLE PRECISION NOT NULL,
      price_cents INTEGER NOT NULL,
      observed_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(skin_name, float_value, price_cents)
    );
    CREATE INDEX IF NOT EXISTS idx_buff_obs_skin ON buff_observations(skin_name);
  `);
  log("  Buff tables ready");

  // Check initial cookie
  const initialCookie = await getCookie(redis);
  if (!initialCookie) {
    log("WARNING: No cookie in Redis. Set it with: redis-cli SET buff_session_cookie \"<cookie>\"");
    log("  Entering sleep mode until cookie is available...");
    stats.cookieHealthy = false;
  }

  // Graceful shutdown
  let running = true;
  process.on("SIGINT", () => { running = false; log("Shutting down..."); });
  process.on("SIGTERM", () => { running = false; log("Shutting down..."); });

  // Reset hourly error counter
  setInterval(() => { stats.errorsThisHour = 0; }, 3600_000);

  while (running) {
    // Get cookie (may have been updated in Redis)
    const cookie = await getCookie(redis);
    if (!cookie) {
      stats.cookieHealthy = false;
      try { await writeStatus(pool); } catch { /* non-critical */ }
      log("  No cookie — sleeping 15 min...");
      await new Promise(r => setTimeout(r, SLEEP_MODE_INTERVAL_MS));
      continue;
    }

    // If previously unhealthy, log recovery
    if (!stats.cookieHealthy) {
      log("  Cookie detected — resuming fetching");
      stats.cookieHealthy = true;
    }

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

      // Re-check cookie freshness periodically
      const freshCookie = await getCookie(redis);
      if (!freshCookie) {
        log("  Cookie disappeared mid-cycle — entering sleep mode");
        stats.cookieHealthy = false;
        break;
      }

      try {
        const result = await fetchSkinData(pool, skinName, goodsIdMap, freshCookie);

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

        if (cycleCalls % 50 === 0 && cycleCalls > 0) {
          log(`  Progress: ${stats.coverageFetched}/${queue.length} skins, ${cycleListings} listings, ${cycleSales} sales`);
          try { await writeStatus(pool); } catch { /* non-critical */ }
        }
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes("login required") || msg.includes("Login Required")) {
          log(`  Cookie expired/invalid — entering sleep mode`);
          stats.cookieHealthy = false;
          stats.lastErrorAt = new Date().toISOString();
          stats.lastError = "Login required — cookie expired";
          // Invalidate cached cookie so we re-read from Redis
          _cachedCookie = null;
          _cookieFetchedAt = 0;
          break;
        } else if (msg.includes("429")) {
          log(`  Rate limited — backing off 60s`);
          stats.errorsThisHour++;
          stats.lastErrorAt = new Date().toISOString();
          stats.lastError = "429 rate limited";
          await new Promise(r => setTimeout(r, 60_000));
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

    if (running && stats.cookieHealthy) {
      log("  Waiting 30s before next cycle...");
      await new Promise(r => setTimeout(r, 30_000));
    }
  }

  try { await writeStatus(pool); } catch { /* non-critical */ }
  await redis.quit();
  await pool.end();
  log("Buff fetcher stopped");
}

main().catch(err => {
  log(`FATAL: ${(err as Error).message ?? ""}`);
  process.exit(1);
});
