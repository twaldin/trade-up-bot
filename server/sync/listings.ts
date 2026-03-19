
import pg from "pg";
import { emitEvent } from "../db.js";
import { deleteListings, cascadeTradeUpStatuses } from "../engine.js";
import type { SkinCoverageInfo, ListingCheckResult } from "./types.js";

/**
 * Delete listings older than maxAgeDays. Old listings are likely sold/delisted
 * and produce false profitable trade-ups that can't actually be executed.
 */
export async function purgeStaleListings(
  pool: pg.Pool,
  maxAgeDays: number = 14
): Promise<{ deleted: number }> {
  // Collect IDs first, then use deleteListings to cascade status changes
  const { rows } = await pool.query(
    "SELECT id FROM listings WHERE EXTRACT(EPOCH FROM NOW() - created_at) / 86400.0 > $1",
    [maxAgeDays]
  );
  const ids = rows.map((r: any) => r.id);
  if (ids.length === 0) return { deleted: 0 };
  const deleted = await deleteListings(pool, ids);
  return { deleted };
}

/**
 * Find skins that need more listing coverage.
 * Returns skins with fewer than `minListings` total listings or fewer than
 * `minConditions` conditions covered, prioritized by least coverage.
 */
export async function getSkinsNeedingCoverage(
  pool: pg.Pool,
  rarity: string,
  options: { minListings?: number; minConditions?: number; limit?: number } = {}
): Promise<SkinCoverageInfo[]> {
  const minListings = options.minListings ?? 5;
  const minConditions = options.minConditions ?? 3;
  const limit = options.limit ?? 100;

  const { rows } = await pool.query(`
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
    WHERE s.rarity = $1 AND s.stattrak = 0
    GROUP BY s.id, s.name, s.rarity, s.min_float, s.max_float
    HAVING COUNT(l.id) < $2 OR COUNT(DISTINCT CASE
        WHEN l.float_value < 0.07 THEN 'FN'
        WHEN l.float_value < 0.15 THEN 'MW'
        WHEN l.float_value < 0.38 THEN 'FT'
        WHEN l.float_value < 0.45 THEN 'WW'
        ELSE 'BS'
      END) < $3
    ORDER BY COUNT(l.id) ASC, COUNT(DISTINCT CASE
        WHEN l.float_value < 0.07 THEN 'FN'
        WHEN l.float_value < 0.15 THEN 'MW'
        WHEN l.float_value < 0.38 THEN 'FT'
        WHEN l.float_value < 0.45 THEN 'WW'
        ELSE 'BS'
      END) ASC
    LIMIT $4
  `, [rarity, minListings, minConditions, limit]);
  return rows as SkinCoverageInfo[];
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
  pool: pg.Pool,
  options: {
    apiKey: string;
    maxChecks?: number;
    onProgress?: (msg: string) => void;
  }
): Promise<ListingCheckResult> {
  const maxChecks = options.maxChecks ?? 200;

  // Priority order:
  // 1. Listings used in profitable trade-ups (most valuable to verify)
  // 2. Never-checked listings
  // 3. Oldest-checked listings
  // Uses CTE to pre-compute profitable listing IDs (avoids correlated subquery on 12M rows)
  const { rows: listings } = await pool.query(`
    WITH profitable_listings AS (
      SELECT DISTINCT tui.listing_id
      FROM trade_up_inputs tui
      JOIN trade_ups tu ON tui.trade_up_id = tu.id
      WHERE tu.profit_cents > 0 AND tu.is_theoretical = 0
    )
    SELECT l.id, l.skin_id, l.price_cents, l.float_value, l.created_at, s.name as skin_name, l.phase
    FROM listings l
    JOIN skins s ON l.skin_id = s.id
    LEFT JOIN profitable_listings pl ON l.id = pl.listing_id
    ORDER BY
      CASE WHEN pl.listing_id IS NOT NULL THEN 0 ELSE 1 END,
      COALESCE(l.staleness_checked_at, l.created_at) ASC
    LIMIT $1
  `, [maxChecks]) as { rows: {
    id: string; skin_id: string; price_cents: number;
    float_value: number; created_at: string; skin_name: string; phase: string | null;
  }[] };

  const result: ListingCheckResult = {
    checked: 0, stillListed: 0, sold: 0, delisted: 0, errors: 0, salesRecorded: 0,
  };

  const deletedIds: string[] = [];

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
        await pool.query("DELETE FROM listings WHERE id = $1", [listing.id]);
        deletedIds.push(listing.id);
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
          await pool.query(
            "UPDATE listings SET price_cents = $1, created_at = $2, price_updated_at = NOW() WHERE id = $3",
            [data.price, new Date().toISOString(), listing.id]
          );
          // Recalc trade-up costs for all trade-ups using this listing
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
              await pool.query(
                `UPDATE trade_ups SET total_cost_cents = $1,
                 profit_cents = expected_value_cents - $1,
                 roi_percentage = CASE WHEN $1 > 0 THEN ROUND(((expected_value_cents - $1)::numeric / $1) * 100, 2) ELSE 0 END
                 WHERE id = $2`,
                [newCost, trade_up_id]
              );
            }
          }
        }
        await pool.query("UPDATE listings SET staleness_checked_at = NOW() WHERE id = $1", [listing.id]);
      } else if (data.state === "sold") {
        // Record as sale observation (valuable price data!)
        const salePrice = data.price || listing.price_cents;
        const saleFloat = data.item?.float_value || listing.float_value;
        const soldAt = data.sold_at || data.created_at || new Date().toISOString();

        // Use phase-qualified name for Dopplers (e.g., "Bayonet | Doppler Phase 2")
        // so sale observations are phase-specific, not mixed across P1-P4/Ruby/Sapphire
        const obsName = listing.phase && listing.skin_name.includes("Doppler")
          ? `${listing.skin_name} ${listing.phase}`
          : listing.skin_name;
        await pool.query(`
          INSERT INTO price_observations (skin_name, float_value, price_cents, source, observed_at)
          VALUES ($1, $2, $3, 'sale', $4)
          ON CONFLICT DO NOTHING
        `, [obsName, saleFloat, salePrice, soldAt]);
        result.salesRecorded++;
        await emitEvent(pool, "listing_sold", `${listing.skin_name} sold $${(salePrice / 100).toFixed(2)} @ ${saleFloat.toFixed(4)}`);

        await pool.query("DELETE FROM listings WHERE id = $1", [listing.id]);
        deletedIds.push(listing.id);
        result.sold++;
      } else {
        // delisted, refunded, etc.
        await pool.query("DELETE FROM listings WHERE id = $1", [listing.id]);
        deletedIds.push(listing.id);
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

  if (deletedIds.length > 0) {
    await cascadeTradeUpStatuses(pool, deletedIds);
  }

  return result;
}
