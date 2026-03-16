/**
 * Phase 1: Housekeeping — purge stale listings, prune observations, clean corrupt data.
 */

import { initDb, emitEvent, purgeOldEvents } from "../../db.js";
import {
  purgeStaleListings,
} from "../../sync.js";
import {
  snapshotListingsToObservations,
  pruneObservations,
  cleanupTheoryTracking,
  refreshListingStatuses,
  purgeExpiredPreserved,
} from "../../engine.js";

import { timestamp, setDaemonStatus } from "../utils.js";

/**
 * Clear theory cooldowns for combos that discovery proves profitable.
 * Called after both Phase 5 materialization and Phase 7 re-materialization.
 */
export function clearDiscoveryProfitableCooldowns(db: ReturnType<typeof initDb>): number {
  // Get collection counts per profitable trade-up (need counts, not DISTINCT)
  const profitable = db.prepare(`
    SELECT t.id, i.collection_name, COUNT(*) as cnt
    FROM trade_ups t
    JOIN trade_up_inputs i ON t.id = i.trade_up_id
    WHERE t.is_theoretical = 0 AND t.profit_cents > 0
    GROUP BY t.id, i.collection_name
  `).all() as { id: number; collection_name: string; cnt: number }[];

  if (profitable.length === 0) return 0;

  // Build combo keys from profitable trade-ups
  const profitableComboKeys = new Set<string>();
  const byTradeUp = new Map<number, { collection_name: string; cnt: number }[]>();
  for (const row of profitable) {
    const list = byTradeUp.get(row.id) ?? [];
    list.push({ collection_name: row.collection_name, cnt: row.cnt });
    byTradeUp.set(row.id, list);
  }
  for (const [, cols] of byTradeUp) {
    const ck = cols.map(c => `${c.collection_name}:${c.cnt}`).sort().join("|");
    profitableComboKeys.add(ck);
  }

  // Only clear cooldowns — don't override accuracy-based status.
  // Discovery proving a combo profitable doesn't mean theory was accurate.
  const clearCooldown = db.prepare(`
    UPDATE theory_tracking
    SET cooldown_until = NULL, last_profitable_at = datetime('now')
    WHERE combo_key = ? AND cooldown_until IS NOT NULL
  `);
  let cleared = 0;
  for (const ck of profitableComboKeys) {
    const result = clearCooldown.run(ck);
    if (result.changes > 0) cleared++;
  }
  return cleared;
}

export async function phase1Housekeeping(db: ReturnType<typeof initDb>, cycleCount: number) {
  console.log(`\n[${timestamp()}] Phase 1: Housekeeping`);
  setDaemonStatus(db, "fetching", "Phase 1: Housekeeping");

  // Snapshot listings before purge so KNN keeps the data
  try {
    const snapped = snapshotListingsToObservations(db);
    if (snapped > 0) console.log(`  Snapshotted ${snapped} listings to observations`);
  } catch { /* DB may be locked */ }

  const purged = purgeStaleListings(db, 90);
  if (purged.deleted > 0) {
    console.log(`  Purged ${purged.deleted} stale listings (>90 days old)`);
  }

  // Aggressively purge old listings that were never staleness-checked.
  // CSFloat listings typically sell within 1-3 days. If we fetched a listing >3 days ago
  // and never verified it, it's almost certainly sold or delisted.
  const oldUnchecked = db.prepare(`
    DELETE FROM listings
    WHERE staleness_checked_at IS NULL
      AND julianday('now') - julianday(created_at) > 3
  `).run();
  if (oldUnchecked.changes > 0) {
    console.log(`  Purged ${oldUnchecked.changes} old unchecked listings (>3 days, never verified)`);
  }

  // Purge DMarket listings older than 24h (no staleness checker for DMarket)
  const dmPurged = db.prepare(`
    DELETE FROM listings WHERE source = 'dmarket'
      AND julianday('now') - julianday(created_at) > 1
  `).run();
  if (dmPurged.changes > 0) {
    console.log(`  Purged ${dmPurged.changes} DMarket listings (>24h old)`);
  }

  // Prune observations every 10 cycles
  if (cycleCount % 10 === 0) {
    try {
      const pruned = pruneObservations(db);
      if (pruned > 0) console.log(`  Pruned ${pruned} old price observations`);
    } catch { /* DB may be locked */ }
  }

  // Purge old daemon events
  purgeOldEvents(db, 6);

  // Clean old theory tracking entries
  cleanupTheoryTracking(db);

  // Clean corrupt trade-ups (0 EV or 0 cost)
  const cleaned = db.prepare(`
    DELETE FROM trade_ups WHERE expected_value_cents = 0 OR total_cost_cents = 0
  `).run();
  if (cleaned.changes > 0) {
    console.log(`  Cleaned ${cleaned.changes} corrupt trade-ups`);
  }

  // Refresh listing statuses (marks partial/stale trade-ups)
  const lsResult = refreshListingStatuses(db);
  if (lsResult.partial > 0 || lsResult.stale > 0) {
    console.log(`  Listing status: ${lsResult.active} active, ${lsResult.partial} partial, ${lsResult.stale} stale (${lsResult.preserved} preserved)`);
  }

  // Purge trade-ups preserved >7 days
  const purgedPreserved = purgeExpiredPreserved(db, 7);
  if (purgedPreserved > 0) {
    console.log(`  Purged ${purgedPreserved} expired preserved trade-ups (>7 days)`);
  }
}
