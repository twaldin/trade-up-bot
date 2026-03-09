/**
 * Data loading: DB queries for listings and outcome skins.
 */

import Database from "better-sqlite3";
import { RARITY_ORDER } from "../../shared/types.js";
import type { ListingWithCollection, DbSkinOutcome } from "./types.js";

export function getListingsForRarity(
  db: Database.Database,
  rarity: string,
  maxPriceCents?: number,
  stattrak: boolean = false
): ListingWithCollection[] {
  let sql = `
    SELECT
      l.id, l.skin_id, s.name as skin_name, s.weapon, l.price_cents,
      l.float_value, l.paint_seed, l.stattrak, s.min_float, s.max_float,
      s.rarity, sc.collection_id, c.name as collection_name
    FROM listings l
    JOIN skins s ON l.skin_id = s.id
    JOIN skin_collections sc ON s.id = sc.skin_id
    JOIN collections c ON sc.collection_id = c.id
    WHERE s.rarity = ? AND l.stattrak = ?
      AND (l.listing_type = 'buy_now' OR l.listing_type IS NULL)
  `;
  const params: (string | number)[] = [rarity, stattrak ? 1 : 0];
  if (maxPriceCents) {
    sql += " AND l.price_cents <= ?";
    params.push(maxPriceCents);
  }
  sql += " ORDER BY l.price_cents ASC";
  return db.prepare(sql).all(...params) as ListingWithCollection[];
}

export function getOutcomesForCollections(
  db: Database.Database,
  collectionIds: string[],
  targetRarity: string
): DbSkinOutcome[] {
  if (collectionIds.length === 0) return [];
  const placeholders = collectionIds.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT s.id, s.name, s.weapon, s.min_float, s.max_float, s.rarity,
              sc.collection_id, c.name as collection_name
       FROM skins s
       JOIN skin_collections sc ON s.id = sc.skin_id
       JOIN collections c ON sc.collection_id = c.id
       WHERE sc.collection_id IN (${placeholders})
       AND s.rarity = ?`
    )
    .all(...collectionIds, targetRarity) as DbSkinOutcome[];
}

export function getNextRarity(rarity: string): string | null {
  const order = RARITY_ORDER[rarity];
  if (order === undefined) return null;
  const entries = Object.entries(RARITY_ORDER);
  const next = entries.find(([, v]) => v === order + 1);
  return next?.[0] ?? null;
}
