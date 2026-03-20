/**
 * Continuous CSFloat listing staleness checker — runs as a separate process.
 *
 * Owns the CSFloat individual lookup pool (50K/24h). Checks listings one at a
 * time via GET /api/v1/listings/:id at a steady ~35/min pace.
 *
 * Priority:
 *   1. Listings used in profitable trade-ups (highest value)
 *   2. Never-checked listings (staleness_checked_at IS NULL)
 *   3. Oldest-checked listings (general staleness sweep)
 *
 * Self-pacing: reads x-ratelimit-remaining/reset headers from each response,
 * dynamically adjusts interval. Accounts for user verify calls via Redis.
 *
 * Usage:
 *   npx tsx server/csfloat-checker.ts
 */

import pg from "pg";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import Redis from "ioredis";
import { cascadeTradeUpStatuses } from "./engine.js";
import { emitEvent } from "./db.js";

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

const LOG_PATH = "/tmp/csfloat-checker.log";
const SAFETY_BUFFER = 100;
const MIN_INTERVAL_MS = 1000;  // Never faster than 1/s
const MAX_INTERVAL_MS = 5000;  // Slowest pace when pool is low
const DEFAULT_INTERVAL_MS = 1700; // ~35/min
const QUEUE_SIZE = 2000;
const QUEUE_REBUILD_INTERVAL_MS = 30 * 60 * 1000; // 30 min
const VERIFY_POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 min
const CASCADE_BATCH_SIZE = 50;

function log(msg: string) {
  const line = `[${new Date().toISOString().replace("T", " ").slice(0, 19)}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_PATH, line + "\n");
}

interface CheckerStats {
  totalChecked: number;
  totalActive: number;
  totalSold: number;
  totalDelisted: number;
  salesRecorded: number;
  totalErrors: number;
  cycleCount: number;
  startedAt: string;
  lastListingChecked: string;
  errorsThisHour: number;
  poolRemaining: number | null;
  poolResetAt: number | null;
  currentInterval: number;
  queueSize: number;
}

const stats: CheckerStats = {
  totalChecked: 0,
  totalActive: 0,
  totalSold: 0,
  totalDelisted: 0,
  salesRecorded: 0,
  totalErrors: 0,
  cycleCount: 0,
  startedAt: new Date().toISOString(),
  lastListingChecked: "",
  errorsThisHour: 0,
  poolRemaining: null,
  poolResetAt: null,
  currentInterval: DEFAULT_INTERVAL_MS,
  queueSize: 0,
};

interface QueueListing {
  id: string;
  skin_id: string;
  price_cents: number;
  float_value: number;
  skin_name: string;
  phase: string | null;
}

/**
 * Build a prioritized check queue:
 * 1. Listings in profitable trade-ups (oldest-checked first)
 * 2. Never-checked listings
 * 3. General staleness sweep (oldest-checked first)
 */
async function buildCheckQueue(pool: pg.Pool, maxSize: number): Promise<QueueListing[]> {
  const { rows } = await pool.query(`
    WITH profitable_listings AS (
      SELECT DISTINCT tui.listing_id
      FROM trade_up_inputs tui
      JOIN trade_ups tu ON tui.trade_up_id = tu.id
      WHERE tu.profit_cents > 0 AND tu.is_theoretical = false
    )
    SELECT l.id, l.skin_id, l.price_cents, l.float_value, s.name as skin_name, l.phase
    FROM listings l
    JOIN skins s ON l.skin_id = s.id
    LEFT JOIN profitable_listings pl ON l.id = pl.listing_id
    WHERE l.source = 'csfloat'
    ORDER BY
      CASE WHEN pl.listing_id IS NOT NULL THEN 0 ELSE 1 END,
      COALESCE(l.staleness_checked_at, '2000-01-01'::timestamptz) ASC
    LIMIT $1
  `, [maxSize]);
  return rows;
}

/**
 * Calculate dynamic check interval based on pool state.
 */
function calculateInterval(
  poolRemaining: number | null,
  poolResetAt: number | null,
  verifyCallsPerInterval: number
): number {
  if (poolRemaining === null || poolResetAt === null) return DEFAULT_INTERVAL_MS;

  const nowS = Date.now() / 1000;
  const timeToResetS = Math.max(1, poolResetAt - nowS);
  const effectiveBudget = poolRemaining - SAFETY_BUFFER - verifyCallsPerInterval;

  if (effectiveBudget <= 0) return MAX_INTERVAL_MS;

  // Target: spread remaining budget evenly across time until reset
  const intervalMs = (timeToResetS / effectiveBudget) * 1000;
  return Math.max(MIN_INTERVAL_MS, Math.min(MAX_INTERVAL_MS, Math.round(intervalMs)));
}

/**
 * Write checker status to sync_meta for daemon/frontend visibility.
 */
async function writeStatus(pool: pg.Pool) {
  await pool.query(
    "INSERT INTO sync_meta (key, value) VALUES ('csfloat_checker_status', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
    [JSON.stringify({
      ...stats,
      updatedAt: new Date().toISOString(),
    })]
  );
}

/**
 * Main continuous check loop.
 */
async function main() {
  const apiKey = process.env.CSFLOAT_API_KEY;
  if (!apiKey) {
    log("ERROR: Missing CSFLOAT_API_KEY");
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_URL
    || "postgresql://tradeupbot:tradeupbot_pg_2026@localhost:5432/tradeupbot";
  const pool = new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
  });

  // Redis for verify_api_calls tracking
  let redis: Redis | null = null;
  try {
    redis = new Redis({ host: "127.0.0.1", port: 6379, maxRetriesPerRequest: 1, lazyConnect: true });
    await redis.connect();
  } catch {
    log("Redis not available — proceeding without verify call tracking");
    redis = null;
  }

  log("CSFloat staleness checker started");
  log(`  DB: PostgreSQL (${connectionString.replace(/:[^@]*@/, ':***@')})`);
  log(`  Log: ${LOG_PATH}`);
  log(`  Pool: 50K/24h individual lookups, ${SAFETY_BUFFER} safety buffer`);
  log(`  Default pace: ~${Math.round(60000 / DEFAULT_INTERVAL_MS)}/min`);

  // Graceful shutdown
  let running = true;
  process.on("SIGINT", () => { running = false; log("Shutting down..."); });
  process.on("SIGTERM", () => { running = false; log("Shutting down..."); });

  let verifyCallsEstimate = 0;
  let lastVerifyPoll = 0;

  while (running) {
    stats.cycleCount++;
    let queue: QueueListing[];
    try {
      queue = await buildCheckQueue(pool, QUEUE_SIZE);
    } catch (err) {
      log(`  DB error during queue build: ${(err as Error).message?.slice(0, 200)} — waiting 10s`);
      await new Promise(r => setTimeout(r, 10_000));
      continue;
    }

    stats.queueSize = queue.length;
    if (queue.length === 0) {
      log("  No CSFloat listings to check — waiting 60s");
      await new Promise(r => setTimeout(r, 60_000));
      continue;
    }

    log(`\nQueue ${stats.cycleCount}: ${queue.length} listings to check`);
    try { await writeStatus(pool); } catch { /* non-critical */ }

    let cycleChecked = 0;
    let cycleActive = 0;
    let cycleSold = 0;
    let cycleDelisted = 0;
    let cycleErrors = 0;
    const deletedIds: string[] = [];
    const queueStarted = Date.now();
    let rateLimitPaused = false;

    for (const listing of queue) {
      if (!running) break;

      // Yield during daemon calc phase
      try {
        const { rows } = await pool.query("SELECT value FROM sync_meta WHERE key = 'daemon_status'");
        if (rows[0]) {
          const parsed = JSON.parse(rows[0].value);
          if (parsed.phase === "calculating") {
            await new Promise(r => setTimeout(r, 5000));
            continue;
          }
        }
      } catch { /* ignore */ }

      // Poll verify_api_calls from Redis periodically
      if (redis && Date.now() - lastVerifyPoll > VERIFY_POLL_INTERVAL_MS) {
        try {
          const raw = await redis.getset("verify_api_calls", "0");
          verifyCallsEstimate = parseInt(raw || "0");
          lastVerifyPoll = Date.now();
        } catch { /* Redis unavailable */ }
      }

      // Rebuild queue if it's been too long
      if (Date.now() - queueStarted > QUEUE_REBUILD_INTERVAL_MS) {
        log(`  Queue timeout — rebuilding after ${cycleChecked} checks`);
        break;
      }

      try {
        const res = await fetch(`https://csfloat.com/api/v1/listings/${listing.id}`, {
          headers: {
            Authorization: apiKey,
            Accept: "application/json",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          },
        });

        // Read rate limit headers from every response
        const remaining = parseInt(res.headers.get("x-ratelimit-remaining") || "", 10);
        const resetAt = parseInt(res.headers.get("x-ratelimit-reset") || "", 10);
        if (!isNaN(remaining)) stats.poolRemaining = remaining;
        if (!isNaN(resetAt)) stats.poolResetAt = resetAt;

        cycleChecked++;
        stats.totalChecked++;
        stats.lastListingChecked = listing.id;

        if (res.status === 429) {
          // Pool exhausted — pause until reset
          const waitS = stats.poolResetAt
            ? Math.max(60, stats.poolResetAt - Date.now() / 1000)
            : 3600;
          log(`  Rate limited — pausing ${Math.round(waitS / 60)} min until pool reset`);
          rateLimitPaused = true;
          stats.errorsThisHour++;
          await new Promise(r => setTimeout(r, waitS * 1000));
          rateLimitPaused = false;
          // Re-check headers on next request
          continue;
        }

        // Pool nearly exhausted — pause until reset
        if (stats.poolRemaining !== null && stats.poolRemaining <= SAFETY_BUFFER) {
          const waitS = stats.poolResetAt
            ? Math.max(60, stats.poolResetAt - Date.now() / 1000)
            : 3600;
          log(`  Pool at safety buffer (${stats.poolRemaining} remaining) — pausing ${Math.round(waitS / 60)} min`);
          rateLimitPaused = true;
          await new Promise(r => setTimeout(r, waitS * 1000));
          rateLimitPaused = false;
          continue;
        }

        if (!res.ok) {
          // 404 or other error — listing gone
          await pool.query("DELETE FROM listings WHERE id = $1", [listing.id]);
          deletedIds.push(listing.id);
          cycleDelisted++;
          stats.totalDelisted++;
        } else {
          const data = await res.json() as {
            state: string;
            price: number;
            sold_at?: string;
            created_at?: string;
            item?: { float_value?: number };
          };

          if (data.state === "listed") {
            cycleActive++;
            stats.totalActive++;
            // Update price if changed
            if (data.price && data.price !== listing.price_cents) {
              await pool.query(
                "UPDATE listings SET price_cents = $1, created_at = $2, price_updated_at = NOW() WHERE id = $3",
                [data.price, new Date().toISOString(), listing.id]
              );
              // Inline recalc for affected trade-ups
              const { rows: affectedTus } = await pool.query(
                "SELECT DISTINCT trade_up_id FROM trade_up_inputs WHERE listing_id = $1", [listing.id]
              );
              if (affectedTus.length > 0) {
                await pool.query(
                  "UPDATE trade_up_inputs SET price_cents = $1 WHERE listing_id = $2", [data.price, listing.id]
                );
                for (const { trade_up_id } of affectedTus) {
                  const { rows: [costRow] } = await pool.query(
                    "SELECT SUM(price_cents) as total FROM trade_up_inputs WHERE trade_up_id = $1", [trade_up_id]
                  );
                  const newCost = parseInt(costRow.total);
                  await pool.query(`
                    UPDATE trade_ups SET total_cost_cents = $1,
                      profit_cents = expected_value_cents - $1,
                      roi_percentage = CASE WHEN $1 > 0 THEN ROUND(((expected_value_cents - $1)::numeric / $1) * 100, 2) ELSE 0 END
                    WHERE id = $2
                  `, [newCost, trade_up_id]);
                }
              }
            }
            await pool.query("UPDATE listings SET staleness_checked_at = NOW() WHERE id = $1", [listing.id]);
          } else if (data.state === "sold") {
            const salePrice = data.price || listing.price_cents;
            const saleFloat = data.item?.float_value || listing.float_value;
            const soldAt = data.sold_at || data.created_at || new Date().toISOString();

            // Phase-qualify Doppler names for accurate per-phase pricing
            const obsName = listing.phase && listing.skin_name.includes("Doppler")
              ? `${listing.skin_name} ${listing.phase}`
              : listing.skin_name;
            await pool.query(`
              INSERT INTO price_observations (skin_name, float_value, price_cents, source, observed_at)
              VALUES ($1, $2, $3, 'sale', $4)
              ON CONFLICT DO NOTHING
            `, [obsName, saleFloat, salePrice, soldAt]);
            stats.salesRecorded++;
            cycleSold++;
            stats.totalSold++;
            await emitEvent(pool, "listing_sold", `${listing.skin_name} sold $${(salePrice / 100).toFixed(2)} @ ${saleFloat.toFixed(4)}`);

            await pool.query("DELETE FROM listings WHERE id = $1", [listing.id]);
            deletedIds.push(listing.id);
          } else {
            // delisted, refunded, etc.
            await pool.query("DELETE FROM listings WHERE id = $1", [listing.id]);
            deletedIds.push(listing.id);
            cycleDelisted++;
            stats.totalDelisted++;
          }
        }

        // Batch cascade deletions
        if (deletedIds.length >= CASCADE_BATCH_SIZE) {
          await cascadeTradeUpStatuses(pool, deletedIds.splice(0));
        }

        // Progress logging
        if (cycleChecked % 100 === 0) {
          log(`  Progress: ${cycleChecked}/${queue.length} (${cycleActive} active, ${cycleSold} sold, ${cycleDelisted} removed) | pool: ${stats.poolRemaining ?? "?"} remaining`);
          try { await writeStatus(pool); } catch { /* non-critical */ }
        }

        // Dynamic pacing
        stats.currentInterval = calculateInterval(stats.poolRemaining, stats.poolResetAt, verifyCallsEstimate);
        await new Promise(r => setTimeout(r, stats.currentInterval));
      } catch {
        cycleErrors++;
        stats.totalErrors++;
        stats.errorsThisHour++;
        if (cycleErrors <= 5) {
          log(`  Error checking ${listing.id}: network error`);
        }
      }
    }

    // Flush remaining deletions
    if (deletedIds.length > 0) {
      await cascadeTradeUpStatuses(pool, deletedIds.splice(0));
    }

    log(`Queue ${stats.cycleCount} complete: ${cycleChecked} checked, ${cycleActive} active, ${cycleSold} sold, ${cycleDelisted} removed, ${cycleErrors} errors`);
    try { await writeStatus(pool); } catch { /* non-critical */ }

    // Brief pause before rebuilding queue
    if (running && !rateLimitPaused) {
      await new Promise(r => setTimeout(r, 5_000));
    }
  }

  try { await writeStatus(pool); } catch { /* non-critical */ }
  if (redis) await redis.quit().catch(() => {});
  await pool.end();
  log("CSFloat checker stopped");
}

main().catch(err => {
  log(`FATAL: ${(err as Error).message ?? ""}`);
  process.exit(1);
});
