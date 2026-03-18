/**
 * Data loading: DB queries for listings and outcome skins.
 */

import pg from "pg";
import { RARITY_ORDER } from "../../shared/types.js";
import type { ListingWithCollection, DbSkinOutcome } from "./types.js";

export async function getListingsForRarity(
  pool: pg.Pool,
  rarity: string,
  maxPriceCents?: number,
  stattrak: boolean = false
): Promise<ListingWithCollection[]> {
  let sql = `
    SELECT
      l.id, l.skin_id, s.name as skin_name, s.weapon, l.price_cents,
      l.float_value, l.paint_seed, l.stattrak, s.min_float, s.max_float,
      s.rarity, l.source, sc.collection_id, c.name as collection_name
    FROM listings l
    JOIN skins s ON l.skin_id = s.id
    JOIN skin_collections sc ON s.id = sc.skin_id
    JOIN collections c ON sc.collection_id = c.id
    WHERE s.rarity = $1 AND l.stattrak = $2
      AND (l.listing_type = 'buy_now' OR l.listing_type IS NULL)
      AND l.claimed_by IS NULL
  `;
  const params: (string | number | boolean)[] = [rarity, stattrak ? 1 : 0];
  let paramIdx = 3;
  if (maxPriceCents) {
    sql += ` AND l.price_cents <= $${paramIdx}`;
    params.push(maxPriceCents);
    paramIdx++;
  }
  sql += " ORDER BY l.price_cents ASC";
  const { rows } = await pool.query(sql, params);
  return rows as ListingWithCollection[];
}

export async function getOutcomesForCollections(
  pool: pg.Pool,
  collectionIds: string[],
  targetRarity: string,
  stattrak: boolean = false
): Promise<DbSkinOutcome[]> {
  if (collectionIds.length === 0) return [];
  const placeholders = collectionIds.map((_, i) => `$${i + 1}`).join(",");
  const nextParam = collectionIds.length + 1;
  const { rows } = await pool.query(
    `SELECT s.id, s.name, s.weapon, s.min_float, s.max_float, s.rarity,
            sc.collection_id, c.name as collection_name
     FROM skins s
     JOIN skin_collections sc ON s.id = sc.skin_id
     JOIN collections c ON sc.collection_id = c.id
     WHERE sc.collection_id IN (${placeholders})
     AND s.rarity = $${nextParam} AND s.stattrak = $${nextParam + 1}`,
    [...collectionIds, targetRarity, stattrak ? 1 : 0]
  );
  return rows as DbSkinOutcome[];
}

export function getNextRarity(rarity: string): string | null {
  const order = RARITY_ORDER[rarity];
  if (order === undefined) return null;
  const entries = Object.entries(RARITY_ORDER);
  const next = entries.find(([, v]) => v === order + 1);
  return next?.[0] ?? null;
}
