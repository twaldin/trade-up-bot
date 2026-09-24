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
import { setCycleVersion } from "../redis.js";

/** At most one heal per this window, including concurrent triggers. */
export const LEAKED_TRADEUP_HEAL_INTERVAL_MS = 45_000;

/** Cap each pass so a bulk listing loss cannot lock the trade-up table. */
const LEAKED_TRADEUP_HEAL_BATCH = 5_000;

export interface LeakedTradeUpHealResult {
  updated: number;
  cacheBumped: boolean;
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

/**
 * One pass: missing listing ids on column-active trade-ups, then
 * cascadeTradeUpStatuses. Fully-missing rows stay as `stale` (include_stale)
 * instead of being deleted. Live claims are skipped inside the cascade.
 * Cache: one cycle_version bump per pass, never SCAN+DEL of `tu:*`.
 */
export async function healLeakedTradeUps(pool: pg.Pool): Promise<LeakedTradeUpHealResult> {
  const { rows } = await pool.query<{ listing_id: string }>(
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
  const listingIds = rows.map((row) => row.listing_id);
  const updated = await cascadeTradeUpStatuses(pool, listingIds, {
    invalidateCache: false,
    preserveFullyMissing: true,
  });
  let cacheBumped = false;
  if (updated > 0) {
    await setCycleVersion(String(Date.now()));
    cacheBumped = true;
  }
  return { updated, cacheBumped };
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
