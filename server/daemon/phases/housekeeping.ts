/**
 * Phase 1: Housekeeping — purge stale listings, prune observations, clean corrupt data.
 */

import { initDb, purgeOldEvents } from "../../db.js";
import {
  purgeStaleListings,
} from "../../sync.js";
import {
  snapshotListingsToObservations,
  pruneObservations,
  refreshListingStatuses,
  purgeExpiredPreserved,
} from "../../engine.js";

import { timestamp, setDaemonStatus } from "../utils.js";

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

  // Purge Skinport listings older than 24h (passive WS feed, no staleness verification.
  // Short TTL because items sell fast and we can't verify individually.)
  const spPurged = db.prepare(`
    DELETE FROM listings WHERE source = 'skinport'
      AND julianday('now') - julianday(created_at) > 1
  `).run();
  if (spPurged.changes > 0) {
    console.log(`  Purged ${spPurged.changes} Skinport listings (>24h old)`);
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

  // WAL checkpoint — keep WAL file small (prevents I/O bloat)
  // PASSIVE won't block writers, safe to run every cycle
  try {
    const ckpt = db.pragma("wal_checkpoint(PASSIVE)") as { busy: number; log: number; checkpointed: number }[];
    if (ckpt[0]?.checkpointed > 0) {
      console.log(`  WAL checkpoint: ${ckpt[0].checkpointed}/${ckpt[0].log} pages`);
    }
  } catch { /* ignore */ }

  // Re-run ANALYZE every 6 hours (every ~30 cycles) to keep query planner current
  if (cycleCount > 0 && cycleCount % 30 === 0) {
    try {
      db.exec("ANALYZE");
      console.log("  Refreshed ANALYZE statistics");
    } catch { /* ignore */ }
  }
}
