/**
 * Observation management — seeding, snapshots, and pruning of price_observations.
 *
 * price_observations stores individual float/price data points used by KNN pricing.
 * This module handles the lifecycle of that data: initial seeding from existing
 * sale_history/listings, periodic snapshots of aging listings, and pruning old data.
 */

import pg from "pg";
import { clearKnnCache, KNN_MAX_OBS_AGE_DAYS } from "./knn-pricing.js";

/**
 * Seed knife/glove sale_history into price_observations.
 * These records have float+price tuples ideal for KNN output pricing.
 * Also snapshots current knife/glove listings as observations.
 */
export async function seedKnifeSaleObservations(pool: pg.Pool): Promise<number> {
  let inserted = 0;

  // Seed knife/glove sales from sale_history
  const sales = await pool.query(`
    INSERT INTO price_observations (skin_name, float_value, price_cents, source, observed_at)
    SELECT skin_name, float_value, price_cents, 'sale', sold_at
    FROM sale_history WHERE skin_name LIKE '★%' AND float_value > 0 AND price_cents > 0
    ON CONFLICT DO NOTHING
  `);
  inserted += sales.rowCount ?? 0;

  // Seed knife/glove listings as observations (Extraordinary rarity)
  const listings = await pool.query(`
    INSERT INTO price_observations (skin_name, float_value, price_cents, source, observed_at)
    SELECT s.name, l.float_value, l.price_cents, 'listing', l.created_at
    FROM listings l JOIN skins s ON l.skin_id = s.id
    WHERE s.rarity = 'Extraordinary' AND l.float_value > 0 AND l.price_cents > 0
      AND l.stattrak = false
      AND (l.source = 'csfloat' OR l.source IS NULL)
    ON CONFLICT DO NOTHING
  `);
  inserted += listings.rowCount ?? 0;

  if (inserted > 0) clearKnnCache();
  return inserted;
}

export async function seedPriceObservations(pool: pg.Pool): Promise<number> {
  const { rows } = await pool.query("SELECT COUNT(*) as n FROM price_observations");
  const existing = parseInt(rows[0].n, 10);
  if (existing > 1000) return 0;

  let inserted = 0;

  const sales = await pool.query(`
    INSERT INTO price_observations (skin_name, float_value, price_cents, source, observed_at)
    SELECT skin_name, float_value, price_cents,
      CASE WHEN source = 'buff' THEN 'buff_sale' ELSE 'sale' END,
      sold_at
    FROM sale_history WHERE float_value > 0 AND price_cents > 0
    ON CONFLICT DO NOTHING
  `);
  inserted += sales.rowCount ?? 0;

  const listings = await pool.query(`
    INSERT INTO price_observations (skin_name, float_value, price_cents, source, observed_at)
    SELECT s.name, l.float_value, l.price_cents, 'listing', l.created_at
    FROM listings l JOIN skins s ON l.skin_id = s.id
    WHERE l.float_value > 0 AND l.price_cents > 0 AND l.stattrak = false
    ON CONFLICT DO NOTHING
  `);
  inserted += listings.rowCount ?? 0;

  clearKnnCache();
  return inserted;
}

export async function snapshotListingsToObservations(
  pool: pg.Pool,
  maxAgeDays: number = 14
): Promise<number> {
  let total = 0;

  // CSFloat listings → source 'listing'
  // Phase-qualify Doppler skins so observations are per-phase
  const csfloat = await pool.query(`
    INSERT INTO price_observations (skin_name, float_value, price_cents, source, observed_at)
    SELECT CASE WHEN s.name LIKE '%Doppler%' AND l.phase IS NOT NULL AND l.phase != ''
                THEN s.name || ' ' || l.phase ELSE s.name END,
           l.float_value, l.price_cents, 'listing', l.created_at
    FROM listings l JOIN skins s ON l.skin_id = s.id
    WHERE l.float_value > 0 AND l.price_cents > 0 AND l.stattrak = false
      AND (l.source = 'csfloat' OR l.source IS NULL)
      AND l.created_at < NOW() - ($1 || ' days')::interval
    ON CONFLICT DO NOTHING
  `, [maxAgeDays]);
  total += csfloat.rowCount ?? 0;

  // DMarket listings → source 'listing_dmarket' (price normalized with 2.5% buyer fee)
  const dmarket = await pool.query(`
    INSERT INTO price_observations (skin_name, float_value, price_cents, source, observed_at)
    SELECT CASE WHEN s.name LIKE '%Doppler%' AND l.phase IS NOT NULL AND l.phase != ''
                THEN s.name || ' ' || l.phase ELSE s.name END,
           l.float_value, CAST(ROUND(l.price_cents * 1.025) AS INTEGER), 'listing_dmarket', l.created_at
    FROM listings l JOIN skins s ON l.skin_id = s.id
    WHERE l.float_value > 0 AND l.price_cents > 0 AND l.stattrak = false
      AND l.source = 'dmarket'
      AND l.created_at < NOW() - ($1 || ' days')::interval
    ON CONFLICT DO NOTHING
  `, [maxAgeDays]);
  total += dmarket.rowCount ?? 0;

  // Skinport listings → source 'listing_skinport'
  const skinport = await pool.query(`
    INSERT INTO price_observations (skin_name, float_value, price_cents, source, observed_at)
    SELECT s.name, l.float_value, l.price_cents, 'listing_skinport', l.created_at
    FROM listings l JOIN skins s ON l.skin_id = s.id
    WHERE l.float_value > 0 AND l.price_cents > 0 AND l.stattrak = false
      AND l.source = 'skinport'
      AND l.created_at < NOW() - ($1 || ' days')::interval
    ON CONFLICT DO NOTHING
  `, [maxAgeDays]);
  total += skinport.rowCount ?? 0;

  if (total > 0) clearKnnCache();
  return total;
}

export async function pruneObservations(pool: pg.Pool, maxPerSkin: number = 500): Promise<number> {
  let pruned = 0;

  const stale = await pool.query(`
    DELETE FROM price_observations
    WHERE EXTRACT(EPOCH FROM NOW() - observed_at::timestamptz) / 86400.0 > $1
  `, [KNN_MAX_OBS_AGE_DAYS]);
  pruned += stale.rowCount ?? 0;

  const { rows: overLimit } = await pool.query(`
    SELECT skin_name, COUNT(*) as cnt FROM price_observations
    GROUP BY skin_name HAVING COUNT(*) > $1
  `, [maxPerSkin]);

  for (const { skin_name, cnt } of overLimit) {
    const excess = parseInt(cnt, 10) - maxPerSkin;
    const result = await pool.query(`
      DELETE FROM price_observations WHERE id IN (
        SELECT id FROM price_observations
        WHERE skin_name = $1
        ORDER BY source ASC, observed_at ASC
        LIMIT $2
      )
    `, [skin_name, excess]);
    pruned += result.rowCount ?? 0;
  }
  if (pruned > 0) clearKnnCache();
  return pruned;
}
