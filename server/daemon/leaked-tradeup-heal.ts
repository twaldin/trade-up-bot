/**
 * Debounced repair for active trade-ups whose input listings disappeared
 * without cascadeTradeUpStatuses (fetcher race, raw DELETE).
 *
 * GET /api/trade-ups used to run this UPDATE and SCAN+DEL every `tu:*` key
 * on a cache miss. Anonymous clients could vary the query string and stampede
 * Postgres. The list handler now only hides those rows; this job writes.
 */

import pg from "pg";
import { cascadeTradeUpStatuses } from "../engine.js";
import { cacheInvalidatePrefix } from "../redis.js";

/** At most one heal per this window, including concurrent triggers. */
export const LEAKED_TRADEUP_HEAL_INTERVAL_MS = 90_000;

/** Cap each pass so a bulk listing loss cannot lock the trade-up table. */
const LEAKED_TRADEUP_HEAL_BATCH = 5_000;

const DISCOVERY_STATEMENT_TIMEOUT = "10s";

export interface LeakedTradeUpHealResult {
  updated: number;
  cacheFlushed: boolean;
}

let lastStartedAt = 0;
let inFlight: Promise<LeakedTradeUpHealResult> | null = null;
let runCount = 0;

export function leakedTradeUpHealRunCount(): number {
  return runCount;
}

/** Test hook: forget the debounce window and any in-flight run. */
export function resetLeakedTradeUpHealSchedule(): void {
  lastStartedAt = 0;
  inFlight = null;
  runCount = 0;
}

function isStatementTimeout(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "57014";
}

/**
 * One pass: missing listing ids on column-active trade-ups, then
 * cascadeTradeUpStatuses. Fully-missing rows stay as `stale` (include_stale)
 * instead of being deleted. Live claims are skipped inside the cascade.
 * Cache: one SCAN+DEL of `tu:*` when at least one row changed, and never
 * more than once per debounce window.
 */
export async function healLeakedTradeUps(pool: pg.Pool): Promise<LeakedTradeUpHealResult> {
  const listingIds = await discoverMissingListingIds(pool);
  if (listingIds === null) return { updated: 0, cacheFlushed: false };

  const updated = await cascadeTradeUpStatuses(pool, listingIds, {
    invalidateCache: false,
    preserveFullyMissing: true,
  });
  let cacheFlushed = false;
  if (updated > 0) {
    await cacheInvalidatePrefix("tu:");
    cacheFlushed = true;
  }
  return { updated, cacheFlushed };
}

/**
 * Missing listing ids on column-active trade-ups. null means the statement
 * timed out: log and skip this cycle. The caller does not retry.
 */
async function discoverMissingListingIds(pool: pg.Pool): Promise<string[] | null> {
  const client = await pool.connect();
  let releaseErr: Error | undefined;
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL statement_timeout = '${DISCOVERY_STATEMENT_TIMEOUT}'`);
    const { rows } = await client.query<{ listing_id: string }>(
      `SELECT DISTINCT tui.listing_id
       FROM trade_up_inputs tui
       JOIN trade_ups t ON t.id = tui.trade_up_id
       LEFT JOIN listings l ON l.id = tui.listing_id
       WHERE t.listing_status = 'active'
         AND t.is_theoretical = false
         AND tui.listing_id NOT LIKE 'theor%'
         AND l.id IS NULL
       LIMIT $1`,
      [LEAKED_TRADEUP_HEAL_BATCH],
    );
    await client.query("COMMIT");
    return rows.map((row) => row.listing_id);
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      releaseErr = rollbackErr instanceof Error ? rollbackErr : new Error("ROLLBACK failed");
    }
    if (isStatementTimeout(err)) {
      console.error("[leaked-tradeup-heal] discovery statement_timeout; skipping cycle");
      return null;
    }
    throw err;
  } finally {
    if (releaseErr) client.release(releaseErr);
    else client.release();
  }
}

/**
 * Run the heal now, or join the in-flight run. Returns null when the last
 * start is still inside LEAKED_TRADEUP_HEAL_INTERVAL_MS.
 */
export function triggerLeakedTradeUpHeal(
  pool: pg.Pool,
  now = Date.now(),
): Promise<LeakedTradeUpHealResult | null> {
  if (inFlight) return inFlight;
  if (lastStartedAt !== 0 && now - lastStartedAt < LEAKED_TRADEUP_HEAL_INTERVAL_MS) {
    return Promise.resolve(null);
  }
  lastStartedAt = now;
  runCount += 1;
  const run = healLeakedTradeUps(pool).finally(() => {
    inFlight = null;
  });
  inFlight = run;
  return run;
}

/** Daemon timer. Does not fire immediately — call trigger once at startup. */
export function startLeakedTradeUpHeal(pool: pg.Pool): () => void {
  const timer = setInterval(() => {
    void triggerLeakedTradeUpHeal(pool).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[leaked-tradeup-heal] ${message}`);
    });
  }, LEAKED_TRADEUP_HEAL_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
