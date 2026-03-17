/**
 * Continuous DMarket listing fetcher — runs as a separate process.
 *
 * Fetches DMarket listings at a steady 2 RPS, completely independent of the
 * main daemon process. Writes listings directly to SQLite (WAL mode).
 *
 * Strategy (coverage-first):
 *   1. Coverage gaps (skins with fewest DMarket listings — Restricted priority)
 *   2. Staleness refresh (re-check skins not fetched in 30+ minutes)
 *
 * Usage:
 *   npx tsx server/dmarket-fetcher.ts
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import {
  fetchDMarketListings,
  isDMarketConfigured,
} from "./sync/dmarket.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const DB_PATH = path.join(__dirname, "..", "data", "tradeup.db");
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
 * Returns skins ordered by fewest listings first.
 * Priority weighting: Restricted > Mil-Spec > Classified > Covert > Extraordinary.
 * Restricted skins have the biggest coverage gap (19K vs 29K Mil-Spec) and thin
 * profit margins that need fresh data to capture.
 */
function getCoverageGaps(db: Database.Database, limit: number = 50): { skinName: string; rarity: string; listingCount: number }[] {
  // Dynamic priority: rarities with more recent profitable trade-ups get higher priority.
  // Also boosts rarities with lowest coverage relative to total skins.
  const profitCounts = db.prepare(`
    SELECT type, COUNT(*) as cnt FROM trade_ups
    WHERE is_theoretical=0 AND profit_cents > 0
    GROUP BY type
  `).all() as { type: string; cnt: number }[];

  // Map trade-up type → input rarity
  const rarityProfit: Record<string, number> = {};
  for (const r of profitCounts) {
    if (r.type === "covert_knife") rarityProfit["Covert"] = (rarityProfit["Covert"] ?? 0) + r.cnt;
    if (r.type === "classified_covert") rarityProfit["Classified"] = (rarityProfit["Classified"] ?? 0) + r.cnt;
    if (r.type === "restricted_classified") rarityProfit["Restricted"] = (rarityProfit["Restricted"] ?? 0) + r.cnt;
    if (r.type === "milspec_restricted") rarityProfit["Mil-Spec"] = (rarityProfit["Mil-Spec"] ?? 0) + r.cnt;
    if (r.type === "industrial_milspec") rarityProfit["Industrial Grade"] = (rarityProfit["Industrial Grade"] ?? 0) + r.cnt;
  }

  return db.prepare(`
    SELECT s.name as skinName, s.rarity, COUNT(l.id) as listingCount
    FROM skins s
    LEFT JOIN listings l ON s.id = l.skin_id AND l.source = 'dmarket' AND l.listing_type = 'buy_now'
    WHERE s.stattrak = 0
      AND s.rarity IN ('Covert', 'Classified', 'Restricted', 'Mil-Spec', 'Extraordinary', 'Industrial Grade', 'Consumer Grade')
    GROUP BY s.id
    ORDER BY listingCount ASC
    LIMIT ?
  `).all(limit) as { skinName: string; rarity: string; listingCount: number }[];
}

/**
 * Get skins whose DMarket listings are stale (oldest fetch first).
 */
function getStaleSkins(db: Database.Database, limit: number = 30): string[] {
  // Skins with DMarket listings that haven't been refreshed in 30+ minutes
  const rows = db.prepare(`
    SELECT s.name, MAX(l.created_at) as newest
    FROM skins s
    JOIN listings l ON s.id = l.skin_id AND l.source = 'dmarket'
    WHERE s.stattrak = 0
      AND s.rarity IN ('Covert', 'Classified', 'Restricted', 'Mil-Spec', 'Extraordinary', 'Industrial Grade', 'Consumer Grade')
    GROUP BY s.id
    HAVING newest < datetime('now', '-30 minutes')
    ORDER BY newest ASC
    LIMIT ?
  `).all(limit) as { name: string; newest: string }[];
  return rows.map(r => r.name);
}

/**
 * Build a prioritized fetch queue: coverage gaps first, then stale refresh.
 */
function buildFetchQueue(db: Database.Database): string[] {
  const queue: string[] = [];
  const seen = new Set<string>();

  // 1. Coverage gaps (skins with fewest/no DMarket listings — Restricted priority)
  const gaps = getCoverageGaps(db, 200);
  for (const g of gaps) {
    if (!seen.has(g.skinName)) {
      queue.push(g.skinName);
      seen.add(g.skinName);
    }
  }

  // 2. Stale skins (refresh old data)
  const stale = getStaleSkins(db, 100);
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
function writeStatus(db: Database.Database) {
  db.prepare(
    "INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('dmarket_fetcher_status', ?)"
  ).run(JSON.stringify({
    ...stats,
    updatedAt: new Date().toISOString(),
  }));
}

/**
 * Main continuous fetch loop.
 * Builds a queue, fetches each skin at ~2 RPS, then rebuilds when exhausted.
 */
async function main() {
  if (!isDMarketConfigured()) {
    log("ERROR: DMarket not configured (missing DMARKET_PUBLIC_KEY or DMARKET_SECRET_KEY)");
    process.exit(1);
  }

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 10000"); // Wait up to 10s for DB lock

  log("DMarket continuous fetcher started");
  log(`  DB: ${DB_PATH}`);
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
      queue = buildFetchQueue(db);
    } catch {
      // DB locked during queue build — wait and retry
      log("  DB locked during queue build — waiting 10s");
      await new Promise(r => setTimeout(r, 10_000));
      continue;
    }
    log(`\nCycle ${stats.cycleCount}: ${queue.length} skins to fetch`);
    try { writeStatus(db); } catch { /* non-critical */ }

    let cycleInserted = 0;
    let cycleCalls = 0;
    let cycleErrors = 0;

    for (const skinName of queue) {
      if (!running) break;

      // Pause when daemon is in heavy DB write phases to avoid SQLITE_BUSY_SNAPSHOT.
      // The daemon sets phase="calculating" during Phase 5-7 (discovery+save).
      try {
        const status = db.prepare("SELECT value FROM sync_meta WHERE key = 'daemon_status'").get() as { value: string } | undefined;
        if (status) {
          const parsed = JSON.parse(status.value);
          if (parsed.phase === "calculating") {
            await new Promise(r => setTimeout(r, 5000));
            continue;
          }
        }
      } catch { /* ignore parse errors */ }

      try {
        // Fetch listings from DMarket API (single call — used for both upsert and staleness)
        const { items } = await fetchDMarketListings(skinName, { limit: 100 });
        const activeIds = new Set<string>();

        // Upsert active listings (same logic as syncDMarketListingsForSkin but inline)
        const skin = db.prepare("SELECT id FROM skins WHERE name = ? AND stattrak = 0 LIMIT 1").get(skinName) as { id: string } | undefined;
        const stSkin = db.prepare("SELECT id FROM skins WHERE name = ? AND stattrak = 1 LIMIT 1").get(`StatTrak™ ${skinName}`) as { id: string } | undefined;
        const upsert = db.prepare(
          "INSERT OR REPLACE INTO listings (id, skin_id, price_cents, float_value, paint_seed, stattrak, created_at, source, listing_type, phase) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), 'dmarket', 'buy_now', ?)"
        );

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
            upsert.run(dmId, targetSkin.id, priceCents, item.extra.floatValue, item.extra.paintSeed ?? null, isStatTrak ? 1 : 0, item.extra.phase ?? null);
            inserted++;
          }
        }

        // Staleness: remove DB listings not in the API response (gone from DMarket)
        const stored = db.prepare(
          "SELECT l.id FROM listings l JOIN skins s ON l.skin_id = s.id WHERE s.name = ? AND l.source = 'dmarket'"
        ).all(skinName) as { id: string }[];
        const del = db.prepare("DELETE FROM listings WHERE id = ?");
        let removed = 0;
        for (const s of stored) {
          if (!activeIds.has(s.id)) { del.run(s.id); removed++; }
        }

        stats.totalCalls++;
        stats.totalInserted += inserted;
        stats.lastSkinFetched = skinName;
        cycleCalls++;
        cycleInserted += inserted;

        stats.coverageFetched++;

        // Log progress every 50 skins
        if (cycleCalls % 50 === 0) {
          log(`  Progress: ${cycleCalls}/${queue.length} skins, ${cycleInserted} listings inserted`);
          try { writeStatus(db); } catch { /* non-critical */ }
        }
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes("429")) {
          // Rate limited — back off for 30 seconds
          log(`  Rate limited — backing off 30s`);
          stats.errorsThisHour++;
          await new Promise(r => setTimeout(r, 30_000));
        } else if (msg.includes("database is locked") || msg.includes("SQLITE_BUSY")) {
          // DB locked by daemon — pause and retry
          await new Promise(r => setTimeout(r, 5000));
        } else {
          // Other error — skip this skin
          cycleErrors++;
          stats.errorsThisHour++;
          if (cycleErrors <= 5) {
            log(`  Error fetching ${skinName}: ${msg.slice(0, 100)}`);
          }
        }
      }
    }

    log(`Cycle ${stats.cycleCount} complete: ${cycleCalls} API calls, ${cycleInserted} listings, ${cycleErrors} errors`);
    try { writeStatus(db); } catch { /* DB may be locked — non-critical */ }

    // Brief pause before rebuilding queue (let daemon update wanted list)
    if (running) {
      log("  Waiting 30s before next cycle...");
      await new Promise(r => setTimeout(r, 30_000));
    }
  }

  try { writeStatus(db); } catch { /* DB may be locked */ }
  db.close();
  log("DMarket fetcher stopped");
}

main().catch(err => {
  const msg = (err as Error).message ?? "";
  if (msg.includes("database is locked") || msg.includes("SQLITE_BUSY")) {
    // DB contention — not a real crash, just restart the loop
    console.error("DMarket fetcher: DB locked, will restart");
    setTimeout(() => main(), 10_000);
  } else {
    log(`FATAL: ${msg}`);
    process.exit(1);
  }
});
