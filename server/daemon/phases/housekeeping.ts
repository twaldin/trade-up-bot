/**
 * Phase 1: Housekeeping — purge stale listings, prune observations, clean corrupt data.
 */

import pg from "pg";
import { purgeOldEvents } from "../../db.js";
import {
  purgeStaleListings,
} from "../../sync.js";
import {
  snapshotListingsToObservations,
  pruneObservations,
  purgeExpiredPreserved,
  cascadeTradeUpStatuses,
} from "../../engine.js";

import { timestamp, setDaemonStatus } from "../utils.js";

export async function phase1Housekeeping(pool: pg.Pool, cycleCount: number) {
  console.log(`\n[${timestamp()}] Phase 1: Housekeeping`);
  await setDaemonStatus(pool, "fetching", "Phase 1: Housekeeping");

  // Snapshot listings before purge so KNN keeps the data
  try {
    const snapped = await snapshotListingsToObservations(pool);
    if (snapped > 0) console.log(`  Snapshotted ${snapped} listings to observations`);
  } catch { /* DB may be locked */ }

  const purged = await purgeStaleListings(pool, 90);
  if (purged.deleted > 0) {
    console.log(`  Purged ${purged.deleted} stale listings (>90 days old)`);
  }

  // Aggressively purge old listings that were never staleness-checked.
  const { rows: oldUncheckedRows } = await pool.query(`
    SELECT id FROM listings
    WHERE staleness_checked_at IS NULL
      AND EXTRACT(EPOCH FROM NOW() - created_at) / 86400.0 > 3
  `);
  if (oldUncheckedRows.length > 0) {
    const ids = oldUncheckedRows.map((r: any) => r.id);
    await pool.query(`DELETE FROM listings WHERE id = ANY($1)`, [ids]);
    await cascadeTradeUpStatuses(pool, ids);
    console.log(`  Purged ${ids.length} old unchecked listings (>3 days, never verified)`);
  }

  // Purge DMarket listings older than 24h
  const { rows: dmPurgedRows } = await pool.query(`
    SELECT id FROM listings WHERE source = 'dmarket'
      AND EXTRACT(EPOCH FROM NOW() - created_at) / 86400.0 > 1
  `);
  if (dmPurgedRows.length > 0) {
    const ids = dmPurgedRows.map((r: any) => r.id);
    await pool.query(`DELETE FROM listings WHERE id = ANY($1)`, [ids]);
    await cascadeTradeUpStatuses(pool, ids);
    console.log(`  Purged ${ids.length} DMarket listings (>24h old)`);
  }

  // Skinport cleanup: remove remaining listings + purge trade-ups with Skinport inputs.
  // Skinport listings are no longer stored (sale observations only). Trade-ups referencing
  // Skinport inputs are un-revivable and waste revival cycles.
  const { rows: spRemaining } = await pool.query("SELECT id FROM listings WHERE source = 'skinport' LIMIT 1000");
  if (spRemaining.length > 0) {
    const ids = spRemaining.map((r: any) => r.id);
    await pool.query(`DELETE FROM listings WHERE id = ANY($1)`, [ids]);
    await cascadeTradeUpStatuses(pool, ids);
    console.log(`  Cleaned ${ids.length} remaining Skinport listings`);
  }
  // Purge trade-ups that have any Skinport input (un-revivable)
  const { rows: spTradeUps } = await pool.query(`
    SELECT DISTINCT tui.trade_up_id FROM trade_up_inputs tui
    WHERE tui.listing_id LIKE 'skinport:%' LIMIT 50000
  `);
  if (spTradeUps.length > 0) {
    const tuIds = spTradeUps.map((r: any) => r.trade_up_id);
    await pool.query(`DELETE FROM trade_up_inputs WHERE trade_up_id = ANY($1)`, [tuIds]);
    await pool.query(`DELETE FROM trade_ups WHERE id = ANY($1)`, [tuIds]);
    console.log(`  Purged ${tuIds.length} trade-ups with Skinport inputs (un-revivable)`);
  }

  // Prune observations every 10 cycles
  if (cycleCount % 10 === 0) {
    try {
      const pruned = await pruneObservations(pool);
      if (pruned > 0) console.log(`  Pruned ${pruned} old price observations`);
    } catch { /* DB may be locked */ }
  }

  // Purge old daemon events
  await purgeOldEvents(pool, 6);

  // Clean corrupt trade-ups (0 EV or 0 cost)
  const { rowCount: cleanedCount } = await pool.query(`
    DELETE FROM trade_ups WHERE expected_value_cents = 0 OR total_cost_cents = 0
  `);
  if ((cleanedCount ?? 0) > 0) {
    console.log(`  Cleaned ${cleanedCount} corrupt trade-ups`);
  }

  // Listing statuses now maintained by cascadeTradeUpStatuses() on every listing
  // deletion/staleness check. Full-scan refreshListingStatuses removed — caused
  // deadlocks with concurrent DMarket fetcher on 2.8M trade-ups.

  // Purge trade-ups preserved >7 days
  const purgedPreserved = await purgeExpiredPreserved(pool, 7);
  if (purgedPreserved > 0) {
    console.log(`  Purged ${purgedPreserved} expired preserved trade-ups (>7 days)`);
  }

  // Re-run ANALYZE every 6 hours (every ~30 cycles) to keep query planner current
  if (cycleCount > 0 && cycleCount % 30 === 0) {
    try {
      await pool.query("ANALYZE");
      console.log("  Refreshed ANALYZE statistics");
    } catch { /* ignore */ }
  }
}
