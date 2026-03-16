/**
 * Daemon utilities: logging, status, coverage reporting, rate limit detection, cycle stats.
 */

import Database from "better-sqlite3";
import { setSyncMeta } from "../db.js";

export function timestamp() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

// Module-level daemon metadata — set once on startup, included in every status update
let _daemonCycle = 0;
let _daemonStartedAt = "";

export function setDaemonMeta(cycle: number, startedAt: string) {
  _daemonCycle = cycle;
  _daemonStartedAt = startedAt;
}

export function setDaemonStatus(db: Database.Database, phase: string, detail: string = "") {
  const status = JSON.stringify({
    phase,
    detail,
    timestamp: new Date().toISOString(),
    cycle: _daemonCycle,
    startedAt: _daemonStartedAt,
  });
  try { setSyncMeta(db, "daemon_status", status); } catch { /* non-critical metadata */ }
}

export function updateExplorationStats(
  db: Database.Database,
  stats: Record<string, string | number>
) {
  try {
    const existing = getSyncMeta(db, "exploration_stats");
    const merged = existing ? { ...JSON.parse(existing), ...stats } : stats;
    setSyncMeta(db, "exploration_stats", JSON.stringify(merged));
  } catch { /* JSON parse of existing stats can fail */ }
}

function getSyncMeta(db: Database.Database, key: string): string | null {
  const row = db.prepare("SELECT value FROM sync_meta WHERE key = ?").get(key) as
    | { value: string } | undefined;
  return row?.value ?? null;
}

export interface RateLimitInfo {
  limit: number | null;
  remaining: number | null;
  resetAt: number | null; // unix timestamp
}

/**
 * CSFloat has 3 separate rate limit pools:
 *   - Listing search (/api/v1/listings?market_hash_name=...): 200/~30min
 *   - Individual listing (/api/v1/listings/<id>): 50,000/~12h
 *   - Sale history (/api/v1/history/.../sales): 500/~12h
 * Each must be probed independently.
 */
export interface ApiProbeResult {
  listingSearch: { available: boolean; rateLimit: RateLimitInfo };
  saleHistory: { available: boolean; rateLimit: RateLimitInfo };
  individualListing: { available: boolean; rateLimit: RateLimitInfo };
}

async function probeEndpoint(url: string, apiKey: string): Promise<{ available: boolean; rateLimit: RateLimitInfo }> {
  try {
    const res = await fetch(url, {
      headers: {
        "Authorization": apiKey,
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });

    const rateLimit: RateLimitInfo = {
      limit: parseIntHeader(res.headers.get("x-ratelimit-limit")),
      remaining: parseIntHeader(res.headers.get("x-ratelimit-remaining")),
      resetAt: parseIntHeader(res.headers.get("x-ratelimit-reset")),
    };

    if (res.status === 429) return { available: false, rateLimit };
    return { available: res.ok || res.status === 404, rateLimit };
  } catch { /* network error — non-critical */
    return { available: false, rateLimit: { limit: null, remaining: null, resetAt: null } };
  }
}

/**
 * Probe all 3 CSFloat rate limit pools independently.
 * Uses minimal calls: listing search (1 call from 200 pool),
 * sale history (1 call from 500 pool). Individual listing pool
 * is checked via a dummy ID that returns 404 but still shows headers.
 */
export async function probeApiRateLimits(apiKey: string): Promise<ApiProbeResult> {
  const [listingSearch, saleHistory] = await Promise.all([
    probeEndpoint(
      "https://csfloat.com/api/v1/listings?market_hash_name=AK-47+%7C+Redline+%28Field-Tested%29&sort_by=lowest_price&limit=1&category=1",
      apiKey
    ),
    probeEndpoint(
      "https://csfloat.com/api/v1/history/AK-47+%7C+Redline+%28Field-Tested%29/sales",
      apiKey
    ),
  ]);

  // Individual listing pool is checked cheaply with a non-existent ID
  // (returns 404 but still includes rate limit headers)
  const individualListing = await probeEndpoint(
    "https://csfloat.com/api/v1/listings/00000000-0000-0000-0000-000000000000",
    apiKey
  );

  return { listingSearch, saleHistory, individualListing };
}

/** Backward-compat wrapper — returns listing search availability */
export async function probeApiRateLimit(apiKey: string): Promise<{
  available: boolean;
  rateLimit: RateLimitInfo;
}> {
  const result = await probeApiRateLimits(apiKey);
  return result.listingSearch;
}

function parseIntHeader(value: string | null): number | null {
  if (!value) return null;
  const n = parseInt(value, 10);
  return isNaN(n) ? null : n;
}

export interface CycleStats {
  cycle: number;
  startedAt: string;
  durationMs: number;
  apiCallsUsed: number;
  apiLimitDetected: number | null;
  apiAvailable: boolean;
  knifeTradeUpsTotal: number;
  knifeProfitable: number;
  theoriesGenerated: number;
  theoriesProfitable: number;
  gapsFilled: number;
  cooldownPasses: number;
  cooldownNewFound: number;
  cooldownImproved: number;
  topProfit: number; // best trade-up profit in cents
  avgProfit: number; // average profitable trade-up profit in cents
  // Classified→Covert stats
  classifiedTotal: number;
  classifiedProfitable: number;
  classifiedTheories: number;
  classifiedTheoriesProfitable: number;
}

export function ensureStatsTable(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS daemon_cycle_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cycle INTEGER NOT NULL,
      daemon_version TEXT NOT NULL DEFAULT 'knife-v2',
      started_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      api_calls_used INTEGER NOT NULL DEFAULT 0,
      api_limit_detected INTEGER,
      api_available INTEGER NOT NULL DEFAULT 1,
      knife_tradeups_total INTEGER NOT NULL DEFAULT 0,
      knife_profitable INTEGER NOT NULL DEFAULT 0,
      theories_generated INTEGER NOT NULL DEFAULT 0,
      theories_profitable INTEGER NOT NULL DEFAULT 0,
      gaps_filled INTEGER NOT NULL DEFAULT 0,
      cooldown_passes INTEGER NOT NULL DEFAULT 0,
      cooldown_new_found INTEGER NOT NULL DEFAULT 0,
      cooldown_improved INTEGER NOT NULL DEFAULT 0,
      top_profit_cents INTEGER NOT NULL DEFAULT 0,
      avg_profit_cents INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_daemon_stats_cycle ON daemon_cycle_stats(cycle);
    CREATE INDEX IF NOT EXISTS idx_daemon_stats_version ON daemon_cycle_stats(daemon_version);
  `);

  // Add classified columns if missing
  const statCols = db.pragma("table_info(daemon_cycle_stats)") as { name: string }[];
  if (!statCols.some(c => c.name === "classified_total")) {
    db.exec("ALTER TABLE daemon_cycle_stats ADD COLUMN classified_total INTEGER NOT NULL DEFAULT 0");
    db.exec("ALTER TABLE daemon_cycle_stats ADD COLUMN classified_profitable INTEGER NOT NULL DEFAULT 0");
    db.exec("ALTER TABLE daemon_cycle_stats ADD COLUMN classified_theories INTEGER NOT NULL DEFAULT 0");
    db.exec("ALTER TABLE daemon_cycle_stats ADD COLUMN classified_theories_profitable INTEGER NOT NULL DEFAULT 0");
  }
}

export function saveCycleStats(db: Database.Database, stats: CycleStats) {
  db.prepare(`
    INSERT INTO daemon_cycle_stats (
      cycle, daemon_version, started_at, duration_ms,
      api_calls_used, api_limit_detected, api_available,
      knife_tradeups_total, knife_profitable,
      theories_generated, theories_profitable, gaps_filled,
      cooldown_passes, cooldown_new_found, cooldown_improved,
      top_profit_cents, avg_profit_cents,
      classified_total, classified_profitable, classified_theories, classified_theories_profitable
    ) VALUES (?, 'knife-v2', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    stats.cycle, stats.startedAt, stats.durationMs,
    stats.apiCallsUsed, stats.apiLimitDetected, stats.apiAvailable ? 1 : 0,
    stats.knifeTradeUpsTotal, stats.knifeProfitable,
    stats.theoriesGenerated, stats.theoriesProfitable, stats.gapsFilled,
    stats.cooldownPasses, stats.cooldownNewFound, stats.cooldownImproved,
    stats.topProfit, stats.avgProfit,
    stats.classifiedTotal ?? 0, stats.classifiedProfitable ?? 0,
    stats.classifiedTheories ?? 0, stats.classifiedTheoriesProfitable ?? 0
  );
}

/**
 * Print comparison of current daemon performance vs historical averages.
 */
export function printPerformanceComparison(db: Database.Database) {
  const hasTable = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='daemon_cycle_stats'"
  ).get();
  if (!hasTable) return;

  const recent = db.prepare(`
    SELECT
      COUNT(*) as cycles,
      AVG(duration_ms) as avg_duration,
      AVG(api_calls_used) as avg_api_calls,
      AVG(knife_profitable) as avg_profitable,
      AVG(top_profit_cents) as avg_top_profit,
      AVG(cooldown_new_found) as avg_new_found,
      AVG(cooldown_improved) as avg_improved,
      MAX(api_limit_detected) as max_api_limit
    FROM daemon_cycle_stats
    WHERE daemon_version = 'knife-v2'
    ORDER BY id DESC LIMIT 20
  `).get() as {
    cycles: number;
    avg_duration: number;
    avg_api_calls: number;
    avg_profitable: number;
    avg_top_profit: number;
    avg_new_found: number;
    avg_improved: number;
    max_api_limit: number | null;
  };

  if (recent.cycles < 2) return;

  console.log(`\n[${timestamp()}] === Performance (last ${recent.cycles} cycles) ===`);
  console.log(`  Avg cycle: ${(recent.avg_duration / 60000).toFixed(1)} min`);
  console.log(`  Avg API calls: ${Math.round(recent.avg_api_calls)}${recent.max_api_limit ? ` / ${recent.max_api_limit} limit` : ""}`);
  console.log(`  Avg profitable: ${Math.round(recent.avg_profitable)} trade-ups`);
  console.log(`  Avg top profit: $${(recent.avg_top_profit / 100).toFixed(2)}`);
  console.log(`  Avg cooldown: +${recent.avg_new_found.toFixed(1)} new, ${recent.avg_improved.toFixed(1)} improved`);
}

export function printCoverageReport(db: Database.Database) {
  const covertCoverage = db.prepare(`
    SELECT
      COUNT(DISTINCT s.id) as total_skins,
      COUNT(DISTINCT CASE WHEN l.id IS NOT NULL THEN s.id END) as with_listings,
      COUNT(l.id) as total_listings
    FROM skins s
    LEFT JOIN listings l ON s.id = l.skin_id
    WHERE s.rarity = 'Covert' AND s.stattrak = 0
  `).get() as { total_skins: number; with_listings: number; total_listings: number };

  const classifiedCoverage = db.prepare(`
    SELECT
      COUNT(DISTINCT s.id) as total_skins,
      COUNT(DISTINCT CASE WHEN l.id IS NOT NULL THEN s.id END) as with_listings,
      COUNT(l.id) as total_listings
    FROM skins s
    LEFT JOIN listings l ON s.id = l.skin_id
    WHERE s.rarity = 'Classified' AND s.stattrak = 0
  `).get() as { total_skins: number; with_listings: number; total_listings: number };

  const salePrices = db.prepare(
    "SELECT COUNT(*) as cnt FROM price_data WHERE source = 'csfloat_sales'"
  ).get() as { cnt: number };

  const refPrices = db.prepare(
    "SELECT COUNT(*) as cnt FROM price_data WHERE source = 'csfloat_ref'"
  ).get() as { cnt: number };

  const tradeUpCounts = db.prepare(`
    SELECT COALESCE(type, 'unknown') as type, COUNT(*) as cnt,
           SUM(CASE WHEN profit_cents > 0 THEN 1 ELSE 0 END) as profitable
    FROM trade_ups WHERE is_theoretical = 0 GROUP BY type
  `).all() as { type: string; cnt: number; profitable: number }[];

  console.log(`\n[${timestamp()}] === Coverage Report ===`);
  console.log(`  Covert inputs: ${covertCoverage.with_listings}/${covertCoverage.total_skins} skins (${covertCoverage.total_listings} listings)`);
  console.log(`  Classified inputs: ${classifiedCoverage.with_listings}/${classifiedCoverage.total_skins} skins (${classifiedCoverage.total_listings} listings)`);
  console.log(`  Output prices: ${salePrices.cnt} sale-based + ${refPrices.cnt} reference`);
  for (const tc of tradeUpCounts) {
    console.log(`  ${tc.type}: ${tc.cnt} total, ${tc.profitable} profitable`);
  }
}
