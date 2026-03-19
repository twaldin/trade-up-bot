/**
 * Continuous DMarket listing fetcher — runs as a separate process.
 *
 * Fetches DMarket listings at a steady 2 RPS, completely independent of the
 * main daemon process. Writes listings directly to PostgreSQL.
 *
 * Strategy (coverage-first):
 *   1. Coverage gaps (skins with fewest DMarket listings — Restricted priority)
 *   2. Staleness refresh (re-check skins not fetched in 30+ minutes)
 *
 * Usage:
 *   npx tsx server/dmarket-fetcher.ts
 */

import pg from "pg";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import {
  fetchDMarketListings,
  isDMarketConfigured,
} from "./sync/dmarket.js";
import { cascadeTradeUpStatuses } from "./engine.js";

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

const LOG_PATH = "/tmp/dmarket-fetcher.log";

function log(msg: string) {
  const line = `[${new Date().toISOString().replace("T", " ").slice(0, 19)}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_PATH, line + "\n");
}

interface FetchStats {
  totalCalls: number;
  totalInserted: number;
  coverageFetched: number;
  cycleCount: number;
  startedAt: string;
  lastSkinFetched: string;
  errorsThisHour: number;
}

const stats: FetchStats = {
  totalCalls: 0,
  totalInserted: 0,
  coverageFetched: 0,
  cycleCount: 0,
  startedAt: new Date().toISOString(),
  lastSkinFetched: "",
  errorsThisHour: 0,
};


/**
 * Get skins with lowest DMarket coverage, across all rarities.
 */
async function getCoverageGaps(pool: pg.Pool, limit: number = 50): Promise<{ skinName: string; rarity: string; listingCount: number }[]> {
  const { rows } = await pool.query(`
    SELECT s.name as "skinName", s.rarity, COUNT(l.id) as "listingCount"
    FROM skins s
    LEFT JOIN listings l ON s.id = l.skin_id AND l.source = 'dmarket' AND l.listing_type = 'buy_now'
    WHERE s.stattrak = 0
      AND s.rarity IN ('Covert', 'Classified', 'Restricted', 'Mil-Spec', 'Extraordinary', 'Industrial Grade', 'Consumer Grade')
    GROUP BY s.id, s.name, s.rarity
    ORDER BY COUNT(l.id) ASC
    LIMIT $1
  `, [limit]);
  return rows.map(r => ({ skinName: r.skinName, rarity: r.rarity, listingCount: Number(r.listingCount) }));
}

/**
 * Get skins whose DMarket listings are stale (oldest fetch first).
 */
async function getStaleSkins(pool: pg.Pool, limit: number = 30): Promise<string[]> {
  const { rows } = await pool.query(`
    SELECT s.name, MAX(l.created_at) as newest
    FROM skins s
    JOIN listings l ON s.id = l.skin_id AND l.source = 'dmarket'
    WHERE s.stattrak = 0
      AND s.rarity IN ('Covert', 'Classified', 'Restricted', 'Mil-Spec', 'Extraordinary', 'Industrial Grade', 'Consumer Grade')
    GROUP BY s.id, s.name
    HAVING MAX(l.created_at) < NOW() - INTERVAL '30 minutes'
    ORDER BY MAX(l.created_at) ASC
    LIMIT $1
  `, [limit]);
  return rows.map(r => r.name);
}

/**
 * Build a prioritized fetch queue: coverage gaps first, then stale refresh.
 */
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

/**
 * Write fetcher status to sync_meta for the daemon/frontend to read.
 */
async function writeStatus(pool: pg.Pool) {
  await pool.query(
    "INSERT INTO sync_meta (key, value) VALUES ('dmarket_fetcher_status', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
    [JSON.stringify({
      ...stats,
      updatedAt: new Date().toISOString(),
    })]
  );
}

/**
 * Main continuous fetch loop.
 */
async function main() {
  if (!isDMarketConfigured()) {
    log("ERROR: DMarket not configured (missing DMARKET_PUBLIC_KEY or DMARKET_SECRET_KEY)");
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_URL
    || "postgresql://tradeupbot:tradeupbot_pg_2026@localhost:5432/tradeupbot";
  const pool = new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
  });

  log("DMarket continuous fetcher started");
  log(`  DB: PostgreSQL (${connectionString.replace(/:[^@]*@/, ':***@')})`);
  log(`  Log: ${LOG_PATH}`);
  log(`  Rate limit: 2 RPS (550ms interval)`);

  // Graceful shutdown
  let running = true;
  process.on("SIGINT", () => { running = false; log("Shutting down..."); });
  process.on("SIGTERM", () => { running = false; log("Shutting down..."); });

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

    let cycleInserted = 0;
    let cycleCalls = 0;
    let cycleErrors = 0;

    for (const skinName of queue) {
      if (!running) break;

      // Pause when daemon is in heavy DB write phases
      try {
        const { rows } = await pool.query("SELECT value FROM sync_meta WHERE key = 'daemon_status'");
        if (rows[0]) {
          const parsed = JSON.parse(rows[0].value);
          if (parsed.phase === "calculating") {
            await new Promise(r => setTimeout(r, 5000));
            continue;
          }
        }
      } catch { /* ignore parse errors */ }

      try {
        const { items } = await fetchDMarketListings(skinName, { limit: 100 });
        const activeIds = new Set<string>();

        // Upsert active listings
        const { rows: skinRows } = await pool.query("SELECT id FROM skins WHERE name = $1 AND stattrak = 0 LIMIT 1", [skinName]);
        const { rows: stSkinRows } = await pool.query("SELECT id FROM skins WHERE name = $1 AND stattrak = 1 LIMIT 1", [`StatTrak™ ${skinName}`]);
        const skin = skinRows[0] as { id: string } | undefined;
        const stSkin = stSkinRows[0] as { id: string } | undefined;

        let inserted = 0;
        if (skin || stSkin) {
          for (const item of items) {
            if (!item.extra?.floatValue && item.extra?.floatValue !== 0) continue;
            const priceCents = parseInt(item.price?.USD ?? "0", 10);
            if (priceCents <= 0) continue;
            const isSouvenir = item.title.includes("Souvenir") || item.extra?.category === "souvenir";
            if (isSouvenir) continue;
            const cleanTitle = item.title
              .replace(/\s*\((?:Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)\s*$/, "")
              .replace(/^StatTrak™\s+/, "");
            if (cleanTitle !== skinName) continue;

            const dmId = `dmarket:${item.itemId}`;
            activeIds.add(dmId);
            const isStatTrak = item.title.includes("StatTrak") || item.extra?.category === "stattrak™";
            const targetSkin = isStatTrak ? stSkin : skin;
            if (!targetSkin) continue;
            await pool.query(`
              INSERT INTO listings (id, skin_id, price_cents, float_value, paint_seed, stattrak, created_at, source, listing_type, phase, price_updated_at)
              VALUES ($1, $2, $3, $4, $5, $6, NOW(), 'dmarket', 'buy_now', $7, NOW())
              ON CONFLICT (id) DO UPDATE SET
                skin_id = $2, price_cents = $3, float_value = $4, paint_seed = $5, stattrak = $6, created_at = NOW(), source = 'dmarket', listing_type = 'buy_now', phase = $7, price_updated_at = NOW()
            `, [dmId, targetSkin.id, priceCents, item.extra.floatValue, item.extra.paintSeed ?? null, isStatTrak ? 1 : 0, item.extra.phase ?? null]);
            inserted++;
          }
        }

        // Staleness: remove DB listings not in the API response
        const { rows: stored } = await pool.query(
          "SELECT l.id FROM listings l JOIN skins s ON l.skin_id = s.id WHERE s.name = $1 AND l.source = 'dmarket'",
          [skinName]
        );
        let removed = 0;
        const deletedIds: string[] = [];
        for (const s of stored) {
          if (!activeIds.has(s.id)) {
            await pool.query("DELETE FROM listings WHERE id = $1", [s.id]);
            deletedIds.push(s.id);
            removed++;
          }
        }
        if (deletedIds.length > 0) {
          await cascadeTradeUpStatuses(pool, deletedIds);
        }

        stats.totalCalls++;
        stats.totalInserted += inserted;
        stats.lastSkinFetched = skinName;
        cycleCalls++;
        cycleInserted += inserted;

        stats.coverageFetched++;

        if (cycleCalls % 50 === 0) {
          log(`  Progress: ${cycleCalls}/${queue.length} skins, ${cycleInserted} listings inserted`);
          try { await writeStatus(pool); } catch { /* non-critical */ }
        }
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes("429")) {
          log(`  Rate limited — backing off 30s`);
          stats.errorsThisHour++;
          await new Promise(r => setTimeout(r, 30_000));
        } else {
          cycleErrors++;
          stats.errorsThisHour++;
          if (cycleErrors <= 5) {
            log(`  Error fetching ${skinName}: ${msg.slice(0, 100)}`);
          }
        }
      }
    }

    log(`Cycle ${stats.cycleCount} complete: ${cycleCalls} API calls, ${cycleInserted} listings, ${cycleErrors} errors`);
    try { await writeStatus(pool); } catch { /* non-critical */ }

    if (running) {
      log("  Waiting 30s before next cycle...");
      await new Promise(r => setTimeout(r, 30_000));
    }
  }

  try { await writeStatus(pool); } catch { /* non-critical */ }
  await pool.end();
  log("DMarket fetcher stopped");
}

main().catch(err => {
  log(`FATAL: ${(err as Error).message ?? ""}`);
  process.exit(1);
});
