
import Database from "better-sqlite3";
import { emitEvent } from "../db.js";
import type { SkinCoverageInfo, ListingCheckResult } from "./types.js";

/**
 * Delete listings older than maxAgeDays. Old listings are likely sold/delisted
 * and produce false profitable trade-ups that can't actually be executed.
 */
export function purgeStaleListings(
  db: Database.Database,
  maxAgeDays: number = 14
): { deleted: number } {
  const result = db.prepare(`
    DELETE FROM listings
    WHERE julianday('now') - julianday(created_at) > ?
  `).run(maxAgeDays);
  return { deleted: result.changes };
}

/**
 * Find skins that need more listing coverage.
 * Returns skins with fewer than `minListings` total listings or fewer than
 * `minConditions` conditions covered, prioritized by least coverage.
 */
export function getSkinsNeedingCoverage(
  db: Database.Database,
  rarity: string,
  options: { minListings?: number; minConditions?: number; limit?: number } = {}
): SkinCoverageInfo[] {
  const minListings = options.minListings ?? 5;
  const minConditions = options.minConditions ?? 3;
  const limit = options.limit ?? 100;

  return db.prepare(`
    SELECT
      s.id, s.name, s.rarity, s.min_float, s.max_float,
      COUNT(l.id) as listing_count,
      COUNT(DISTINCT CASE
        WHEN l.float_value < 0.07 THEN 'FN'
        WHEN l.float_value < 0.15 THEN 'MW'
        WHEN l.float_value < 0.38 THEN 'FT'
        WHEN l.float_value < 0.45 THEN 'WW'
        ELSE 'BS'
      END) as condition_count
    FROM skins s
    LEFT JOIN listings l ON s.id = l.skin_id
    WHERE s.rarity = ? AND s.stattrak = 0
    GROUP BY s.id
    HAVING listing_count < ? OR condition_count < ?
    ORDER BY listing_count ASC, condition_count ASC
    LIMIT ?
  `).all(rarity, minListings, minConditions, limit) as SkinCoverageInfo[];
}

/**
 * Check listing staleness via individual listing lookups (50K/12h pool).
 * For each listing in our DB, fetches its current state:
 *   - "listed" -> keep it (update price if changed)
 *   - "sold" -> record as sale observation + delete from listings
 *   - "delisted"/"refunded"/"unknown" -> delete from listings
 *
 * Returns stats on what happened. Processes oldest listings first.
 */
export async function checkListingStaleness(
  db: Database.Database,
  options: {
    apiKey: string;
    maxChecks?: number;
    onProgress?: (msg: string) => void;
  }
): Promise<ListingCheckResult> {
  const maxChecks = options.maxChecks ?? 200;

  // Priority order:
  // 1. Listings used in profitable trade-ups (most valuable to verify — stale = invalid trade-up)
  // 2. Never-checked listings
  // 3. Oldest-checked listings
  const listings = db.prepare(`
    SELECT l.id, l.skin_id, l.price_cents, l.float_value, l.created_at, s.name as skin_name, l.phase
    FROM listings l
    JOIN skins s ON l.skin_id = s.id
    ORDER BY
      CASE
        WHEN l.id IN (
          SELECT tui.listing_id FROM trade_up_inputs tui
          JOIN trade_ups tu ON tui.trade_up_id = tu.id
          WHERE tu.profit_cents > 0 AND tu.is_theoretical = 0
        ) THEN 0
        WHEN l.staleness_checked_at IS NULL THEN 1
        ELSE 2
      END,
      COALESCE(l.staleness_checked_at, l.created_at) ASC
    LIMIT ?
  `).all(maxChecks) as {
    id: string; skin_id: string; price_cents: number;
    float_value: number; created_at: string; skin_name: string; phase: string | null;
  }[];

  const deleteListing = db.prepare("DELETE FROM listings WHERE id = ?");
  const updateListingPrice = db.prepare("UPDATE listings SET price_cents = ?, created_at = ?, price_updated_at = datetime('now') WHERE id = ?");
  const markChecked = db.prepare("UPDATE listings SET staleness_checked_at = datetime('now') WHERE id = ?");
  const insertObservation = db.prepare(`
    INSERT OR IGNORE INTO price_observations (skin_name, float_value, price_cents, source, observed_at)
    VALUES (?, ?, ?, 'sale', ?)
  `);

  const result: ListingCheckResult = {
    checked: 0, stillListed: 0, sold: 0, delisted: 0, errors: 0, salesRecorded: 0,
  };

  for (const listing of listings) {
    try {
      const res = await fetch(`https://csfloat.com/api/v1/listings/${listing.id}`, {
        headers: {
          Authorization: options.apiKey,
          Accept: "application/json",
        },
      });

      result.checked++;

      if (res.status === 429) {
        // Individual listing pool exhausted — stop
        options.onProgress?.(`Listing check: rate limited after ${result.checked} checks`);
        break;
      }

      if (!res.ok) {
        // 404 or other error — listing no longer exists
        deleteListing.run(listing.id);
        result.delisted++;
        continue;
      }

      const data = await res.json() as {
        state: string;
        price: number;
        sold_at?: string;
        created_at?: string;
        item?: { float_value?: number };
      };

      if (data.state === "listed") {
        result.stillListed++;
        // Update price if changed, mark as checked
        if (data.price && data.price !== listing.price_cents) {
          updateListingPrice.run(data.price, new Date().toISOString(), listing.id);
        }
        markChecked.run(listing.id);
      } else if (data.state === "sold") {
        // Record as sale observation (valuable price data!)
        const salePrice = data.price || listing.price_cents;
        const saleFloat = data.item?.float_value || listing.float_value;
        const soldAt = data.sold_at || data.created_at || new Date().toISOString();

        // Use phase-qualified name for Dopplers (e.g., "★ Bayonet | Doppler Phase 2")
        // so sale observations are phase-specific, not mixed across P1-P4/Ruby/Sapphire
        const obsName = listing.phase && listing.skin_name.includes("Doppler")
          ? `${listing.skin_name} ${listing.phase}`
          : listing.skin_name;
        insertObservation.run(obsName, saleFloat, salePrice, soldAt);
        result.salesRecorded++;
        emitEvent(db, "listing_sold", `${listing.skin_name} sold $${(salePrice / 100).toFixed(2)} @ ${saleFloat.toFixed(4)}`);

        deleteListing.run(listing.id);
        result.sold++;
      } else {
        // delisted, refunded, etc.
        deleteListing.run(listing.id);
        result.delisted++;
      }

      // Brief pause between requests to be respectful
      if (result.checked % 20 === 0) {
        options.onProgress?.(
          `Listing check: ${result.checked}/${maxChecks} (${result.stillListed} active, ${result.sold} sold, ${result.delisted} removed)`
        );
        await new Promise(r => setTimeout(r, 100));
      }
    } catch { /* network error — non-critical */
      result.errors++;
    }
  }

  return result;
}
