/**
 * Listing and trade-up status management: cascade, delete, refresh, purge.
 */

import pg from "pg";

/**
 * Cascade trade-up listing_status changes when specific listings are deleted or claimed.
 * Lightweight: only re-evaluates trade-ups referencing the given listing IDs.
 * Skips trade-ups with active claims (they stay 'active' for the claimer).
 */
export async function cascadeTradeUpStatuses(pool: pg.Pool, listingIds: string[]): Promise<number> {
  if (listingIds.length === 0) return 0;
  const { cacheInvalidatePrefix } = await import("../redis.js");
  // Batch in chunks of 500 to avoid param limit issues
  let totalUpdated = 0;
  for (let i = 0; i < listingIds.length; i += 500) {
    const chunk = listingIds.slice(i, i + 500);
    // Compute status for affected trade-ups
    const { rows: statusRows } = await pool.query(`
      WITH affected_tus AS (
        SELECT DISTINCT tui.trade_up_id
        FROM trade_up_inputs tui
        WHERE tui.listing_id = ANY($1)
      ),
      status_calc AS (
        SELECT a.trade_up_id,
          COUNT(*) FILTER (WHERE l.id IS NULL OR l.claimed_by IS NOT NULL) as missing,
          COUNT(*) as total
        FROM affected_tus a
        JOIN trade_up_inputs tui ON tui.trade_up_id = a.trade_up_id
        LEFT JOIN listings l ON tui.listing_id = l.id
        WHERE tui.listing_id NOT LIKE 'theor%'
        GROUP BY a.trade_up_id
      )
      SELECT trade_up_id, missing::int, total::int FROM status_calc
    `, [chunk]);

    // Separate: trade-ups to delete (all inputs gone) vs update (partial/active)
    // Skip trade-ups with active claims — they should stay 'active' for the claimer.
    const activelyClaimed = new Set<number>();
    if (statusRows.length > 0) {
      const tuIds = statusRows.map((r: { trade_up_id: number }) => r.trade_up_id);
      const { rows: claimedRows } = await pool.query(
        `SELECT DISTINCT trade_up_id FROM trade_up_claims WHERE trade_up_id = ANY($1) AND released_at IS NULL AND expires_at > NOW()`,
        [tuIds]
      );
      for (const r of claimedRows) activelyClaimed.add(r.trade_up_id);
    }

    const toDelete: number[] = [];
    const toUpdate: { trade_up_id: number; missing: number; total: number }[] = [];
    for (const row of statusRows) {
      if (activelyClaimed.has(row.trade_up_id)) continue; // skip actively claimed
      if (row.missing === row.total) {
        toDelete.push(row.trade_up_id);
      } else {
        toUpdate.push(row);
      }
    }

    // Delete fully stale trade-ups immediately
    if (toDelete.length > 0) {
      await pool.query(`DELETE FROM trade_up_inputs WHERE trade_up_id = ANY($1)`, [toDelete]);
      await pool.query(`DELETE FROM trade_ups WHERE id = ANY($1)`, [toDelete]);
      totalUpdated += toDelete.length;
    }

    // Update partial/active trade-ups — batched by new status to avoid per-row round-trips
    if (toUpdate.length > 0) {
      const partialIds = toUpdate.filter(r => r.missing > 0).map(r => r.trade_up_id);
      const activeIds = toUpdate.filter(r => r.missing === 0).map(r => r.trade_up_id);

      if (partialIds.length > 0) {
        const r = await pool.query(`
          UPDATE trade_ups SET
            listing_status = 'partial',
            preserved_at = CASE
              WHEN listing_status = 'active' THEN NOW()
              ELSE preserved_at
            END
          WHERE id = ANY($1)
            AND listing_status IS DISTINCT FROM 'partial'
            AND NOT EXISTS (
              SELECT 1 FROM trade_up_claims tc
              WHERE tc.trade_up_id = trade_ups.id AND tc.released_at IS NULL AND tc.expires_at > NOW()
            )
        `, [partialIds]);
        totalUpdated += r.rowCount ?? 0;
      }

      if (activeIds.length > 0) {
        const r = await pool.query(`
          UPDATE trade_ups SET
            listing_status = 'active',
            preserved_at = NULL
          WHERE id = ANY($1)
            AND listing_status IS DISTINCT FROM 'active'
            AND NOT EXISTS (
              SELECT 1 FROM trade_up_claims tc
              WHERE tc.trade_up_id = trade_ups.id AND tc.released_at IS NULL AND tc.expires_at > NOW()
            )
        `, [activeIds]);
        totalUpdated += r.rowCount ?? 0;
      }
    }
  }
  if (totalUpdated > 0) {
    await cacheInvalidatePrefix("tu:");
  }
  return totalUpdated;
}

/**
 * Delete listings by ID and cascade status changes to affected trade-ups.
 * Use this instead of raw DELETE FROM listings everywhere.
 */
export async function deleteListings(pool: pg.Pool, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { rowCount } = await pool.query(`DELETE FROM listings WHERE id = ANY($1)`, [ids]);
  await cascadeTradeUpStatuses(pool, ids);
  return rowCount ?? 0;
}

/**
 * Refresh listing_status for all real trade-ups based on whether their
 * input listings still exist in the DB. Fast — single SQL pass.
 */
export async function refreshListingStatuses(pool: pg.Pool): Promise<{ active: number; partial: number; stale: number; preserved: number }> {
  // JOIN-based approach: pre-compute missing/present counts per trade-up in one pass,
  // then UPDATE using the aggregated results. Avoids correlated subqueries on 1.25M rows.
  // Treats both deleted listings (l.id IS NULL) and claimed listings (l.claimed_by IS NOT NULL) as missing.
  // Skips trade-ups with active claims (they stay 'active' for the claimer).
  await pool.query(`
    UPDATE trade_ups t SET
      listing_status = s.new_status,
      preserved_at = CASE
        WHEN s.new_status = 'active' THEN NULL
        ELSE COALESCE(t.preserved_at, NOW())
      END
    FROM (
      SELECT tui.trade_up_id,
        CASE
          WHEN COUNT(*) FILTER (WHERE l.id IS NULL OR l.claimed_by IS NOT NULL) = 0 THEN 'active'
          WHEN COUNT(*) FILTER (WHERE l.id IS NOT NULL AND l.claimed_by IS NULL) > 0 THEN 'partial'
          ELSE 'stale'
        END as new_status
      FROM trade_up_inputs tui
      LEFT JOIN listings l ON tui.listing_id = l.id
      WHERE tui.listing_id NOT LIKE 'theor%'
      GROUP BY tui.trade_up_id
    ) s
    WHERE t.id = s.trade_up_id
      AND t.is_theoretical = false
      AND (t.listing_status IS DISTINCT FROM s.new_status)
      AND NOT EXISTS (
        SELECT 1 FROM trade_up_claims tc
        WHERE tc.trade_up_id = t.id AND tc.released_at IS NULL AND tc.expires_at > NOW()
      )
  `);
  const { cacheInvalidatePrefix } = await import("../redis.js");
  await cacheInvalidatePrefix("tu:");

  const { rows: counts } = await pool.query(`
    SELECT listing_status, COUNT(*) as cnt
    FROM trade_ups WHERE is_theoretical = false
    GROUP BY listing_status
  `);

  const m: Record<string, number> = {};
  for (const r of counts) m[r.listing_status] = parseInt(r.cnt, 10);

  const { rows: preservedRows } = await pool.query(
    "SELECT COUNT(*) as cnt FROM trade_ups WHERE preserved_at IS NOT NULL"
  );
  const preserved = parseInt(preservedRows[0].cnt, 10);

  return { active: m.active ?? 0, partial: m.partial ?? 0, stale: m.stale ?? 0, preserved };
}

/**
 * Purge preserved trade-ups older than maxDays.
 */
export async function purgeExpiredPreserved(pool: pg.Pool, maxDays = 2): Promise<number> {
  // Use listing_status IN + preserved_at range to leverage composite index
  // idx_trade_ups_listing_status(listing_status, preserved_at) instead of EXTRACT() function scan.
  // Both 'partial' (cascadeTradeUpStatuses) and 'stale' (refreshListingStatuses, claims) can have
  // preserved_at set and must be purged together.
  const condition = "listing_status IN ('partial', 'stale') AND preserved_at < NOW() - ($1 * INTERVAL '1 day')";

  // Delete inputs first (trade_up_inputs.trade_up_id FK has ON DELETE CASCADE but explicit
  // batch delete is faster than row-by-row trigger for large counts), then trade-ups.
  await pool.query(`DELETE FROM trade_up_inputs WHERE trade_up_id IN (SELECT id FROM trade_ups WHERE ${condition})`, [maxDays]);
  const { rowCount } = await pool.query(`DELETE FROM trade_ups WHERE ${condition}`, [maxDays]);
  return rowCount ?? 0;
}
