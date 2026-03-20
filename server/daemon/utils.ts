/**
 * Daemon utilities: logging, status, coverage reporting, rate limit detection, cycle stats.
 */

import pg from "pg";
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

export async function setDaemonStatus(pool: pg.Pool, phase: string, detail: string = "") {
  const status = JSON.stringify({
    phase,
    detail,
    timestamp: new Date().toISOString(),
    cycle: _daemonCycle,
    startedAt: _daemonStartedAt,
  });
  try { await setSyncMeta(pool, "daemon_status", status); } catch { /* non-critical metadata */ }
}

export async function updateExplorationStats(
  pool: pg.Pool,
  stats: Record<string, string | number>
) {
  try {
    const existing = await _getSyncMeta(pool, "exploration_stats");
    const merged = existing ? { ...JSON.parse(existing), ...stats } : stats;
    await setSyncMeta(pool, "exploration_stats", JSON.stringify(merged));
  } catch { /* JSON parse of existing stats can fail */ }
}

async function _getSyncMeta(pool: pg.Pool, key: string): Promise<string | null> {
  const { rows } = await pool.query("SELECT value FROM sync_meta WHERE key = $1", [key]);
  return rows[0]?.value ?? null;
}

export interface RateLimitInfo {
  limit: number | null;
  remaining: number | null;
  resetAt: number | null; // unix timestamp
}

/**
 * CSFloat has 3 separate rate limit pools:
 *   - Listing search (/api/v1/listings?market_hash_name=...): 200/~1h
 *   - Individual listing (/api/v1/listings/<id>): 50,000/~24h
 *   - Sale history (/api/v1/history/.../sales): 500/~24h
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
  // Classified->Covert stats
  classifiedTotal: number;
  classifiedProfitable: number;
  classifiedTheories: number;
  classifiedTheoriesProfitable: number;
}

export async function ensureStatsTable(pool: pg.Pool) {
  // Table already created by createTables() in db.ts — just check for missing columns
  const { rows: statCols } = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'daemon_cycle_stats'
  `);
  const colNames = statCols.map(c => c.column_name);
  if (colNames.length > 0 && !colNames.includes("classified_total")) {
    await pool.query("ALTER TABLE daemon_cycle_stats ADD COLUMN IF NOT EXISTS classified_total INTEGER NOT NULL DEFAULT 0");
    await pool.query("ALTER TABLE daemon_cycle_stats ADD COLUMN IF NOT EXISTS classified_profitable INTEGER NOT NULL DEFAULT 0");
    await pool.query("ALTER TABLE daemon_cycle_stats ADD COLUMN IF NOT EXISTS classified_theories INTEGER NOT NULL DEFAULT 0");
    await pool.query("ALTER TABLE daemon_cycle_stats ADD COLUMN IF NOT EXISTS classified_theories_profitable INTEGER NOT NULL DEFAULT 0");
  }
}

export async function saveCycleStats(pool: pg.Pool, stats: CycleStats) {
  await pool.query(`
    INSERT INTO daemon_cycle_stats (
      cycle, daemon_version, started_at, duration_ms,
      api_calls_used, api_limit_detected, api_available,
      knife_tradeups_total, knife_profitable,
      theories_generated, theories_profitable, gaps_filled,
      cooldown_passes, cooldown_new_found, cooldown_improved,
      top_profit_cents, avg_profit_cents,
      classified_total, classified_profitable, classified_theories, classified_theories_profitable
    ) VALUES ($1, 'knife-v2', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
  `, [
    stats.cycle, stats.startedAt, stats.durationMs,
    stats.apiCallsUsed, stats.apiLimitDetected, stats.apiAvailable ? 1 : 0,
    stats.knifeTradeUpsTotal, stats.knifeProfitable,
    stats.theoriesGenerated, stats.theoriesProfitable, stats.gapsFilled,
    stats.cooldownPasses, stats.cooldownNewFound, stats.cooldownImproved,
    stats.topProfit, stats.avgProfit,
    stats.classifiedTotal ?? 0, stats.classifiedProfitable ?? 0,
    stats.classifiedTheories ?? 0, stats.classifiedTheoriesProfitable ?? 0,
  ]);
}

/**
 * Print comparison of current daemon performance vs historical averages.
 */
export async function printPerformanceComparison(pool: pg.Pool) {
  const { rows: tableCheck } = await pool.query(
    "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'daemon_cycle_stats') as exists"
  );
  if (!tableCheck[0]?.exists) return;

  const { rows } = await pool.query(`
    SELECT
      COUNT(*) as cycles,
      AVG(duration_ms) as avg_duration,
      AVG(api_calls_used) as avg_api_calls,
      AVG(knife_profitable) as avg_profitable,
      AVG(top_profit_cents) as avg_top_profit,
      AVG(cooldown_new_found) as avg_new_found,
      AVG(cooldown_improved) as avg_improved,
      MAX(api_limit_detected) as max_api_limit
    FROM (
      SELECT * FROM daemon_cycle_stats
      WHERE daemon_version = 'knife-v2'
      ORDER BY id DESC LIMIT 20
    ) sub
  `);
  const raw = rows[0];
  if (!raw || Number(raw.cycles) < 2) return;

  // PG returns AVG() as string (numeric type) — parse to float
  const recent = {
    cycles: Number(raw.cycles),
    avg_duration: parseFloat(raw.avg_duration) || 0,
    avg_api_calls: parseFloat(raw.avg_api_calls) || 0,
    avg_profitable: parseFloat(raw.avg_profitable) || 0,
    avg_top_profit: parseFloat(raw.avg_top_profit) || 0,
    avg_new_found: parseFloat(raw.avg_new_found) || 0,
    avg_improved: parseFloat(raw.avg_improved) || 0,
    max_api_limit: raw.max_api_limit ? Number(raw.max_api_limit) : null,
  };

  console.log(`\n[${timestamp()}] === Performance (last ${recent.cycles} cycles) ===`);
  console.log(`  Avg cycle: ${(recent.avg_duration / 60000).toFixed(1)} min`);
  console.log(`  Avg API calls: ${Math.round(recent.avg_api_calls)}${recent.max_api_limit ? ` / ${recent.max_api_limit} limit` : ""}`);
  console.log(`  Avg profitable: ${Math.round(recent.avg_profitable)} trade-ups`);
  console.log(`  Avg top profit: $${(recent.avg_top_profit / 100).toFixed(2)}`);
  console.log(`  Avg cooldown: +${recent.avg_new_found.toFixed(1)} new, ${recent.avg_improved.toFixed(1)} improved`);
}

export async function printCoverageReport(pool: pg.Pool) {
  const { rows: [covertCoverage] } = await pool.query(`
    SELECT
      COUNT(DISTINCT s.id) as total_skins,
      COUNT(DISTINCT CASE WHEN l.id IS NOT NULL THEN s.id END) as with_listings,
      COUNT(l.id) as total_listings
    FROM skins s
    LEFT JOIN listings l ON s.id = l.skin_id
    WHERE s.rarity = 'Covert' AND s.stattrak = false
  `);

  const { rows: [classifiedCoverage] } = await pool.query(`
    SELECT
      COUNT(DISTINCT s.id) as total_skins,
      COUNT(DISTINCT CASE WHEN l.id IS NOT NULL THEN s.id END) as with_listings,
      COUNT(l.id) as total_listings
    FROM skins s
    LEFT JOIN listings l ON s.id = l.skin_id
    WHERE s.rarity = 'Classified' AND s.stattrak = false
  `);

  const { rows: [salePrices] } = await pool.query(
    "SELECT COUNT(*) as cnt FROM price_data WHERE source = 'csfloat_sales'"
  );

  const { rows: [refPrices] } = await pool.query(
    "SELECT COUNT(*) as cnt FROM price_data WHERE source = 'csfloat_ref'"
  );

  const { rows: tradeUpCounts } = await pool.query(`
    SELECT COALESCE(type, 'unknown') as type, COUNT(*) as cnt,
           SUM(CASE WHEN profit_cents > 0 THEN 1 ELSE 0 END) as profitable
    FROM trade_ups WHERE is_theoretical = false GROUP BY type
  `);

  console.log(`\n[${timestamp()}] === Coverage Report ===`);
  console.log(`  Covert inputs: ${covertCoverage.with_listings}/${covertCoverage.total_skins} skins (${covertCoverage.total_listings} listings)`);
  console.log(`  Classified inputs: ${classifiedCoverage.with_listings}/${classifiedCoverage.total_skins} skins (${classifiedCoverage.total_listings} listings)`);
  console.log(`  Output prices: ${salePrices.cnt} sale-based + ${refPrices.cnt} reference`);
  for (const tc of tradeUpCounts) {
    console.log(`  ${tc.type}: ${tc.cnt} total, ${tc.profitable} profitable`);
  }
}
