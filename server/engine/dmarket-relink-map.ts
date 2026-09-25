/**
 * Short-lived old DMarket offer id → new offer id map.
 * The fetcher deletes the old listing row when it relinks, so a daemon save
 * that still holds the id it loaded at cycle start can look the live id up
 * here. Rows older than the TTL are ignored and pruned.
 */

import type pg from "pg";
import type { TradeUp, TradeUpInput } from "../../shared/types.js";

export const DMARKET_RELINK_TTL = "2 hours";

type Queryable = pg.Pool | pg.PoolClient;

export async function ensureDMarketRelinkMap(db: Queryable): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS dmarket_listing_relinks (
      old_id TEXT PRIMARY KEY,
      new_id TEXT NOT NULL,
      relinked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_dmarket_listing_relinks_at
    ON dmarket_listing_relinks (relinked_at)
  `);
}

export async function recordDMarketRelink(db: Queryable, oldId: string, newId: string): Promise<void> {
  await ensureDMarketRelinkMap(db);
  await db.query(
    `INSERT INTO dmarket_listing_relinks (old_id, new_id, relinked_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (old_id) DO UPDATE SET new_id = EXCLUDED.new_id, relinked_at = NOW()`,
    [oldId, newId],
  );
}

export async function pruneDMarketRelinkMap(db: Queryable): Promise<void> {
  await ensureDMarketRelinkMap(db);
  await db.query(
    `DELETE FROM dmarket_listing_relinks WHERE relinked_at < NOW() - INTERVAL '${DMARKET_RELINK_TTL}'`,
  );
}

interface ChainRow {
  old_id: string;
  new_id: string;
}

/** Latest live target for each old id, following up to four hops inside the TTL. */
export async function lookupDMarketRelinks(db: Queryable, oldIds: readonly string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (oldIds.length === 0) return map;
  await ensureDMarketRelinkMap(db);
  const { rows } = await db.query<ChainRow>(
    `WITH RECURSIVE chain AS (
       SELECT old_id, new_id, 1 AS depth, ARRAY[old_id] AS path
       FROM dmarket_listing_relinks
       WHERE old_id = ANY($1::text[])
         AND relinked_at > NOW() - INTERVAL '${DMARKET_RELINK_TTL}'
       UNION ALL
       SELECT c.old_id, r.new_id, c.depth + 1, c.path || r.old_id
       FROM chain c
       JOIN dmarket_listing_relinks r ON r.old_id = c.new_id
       WHERE c.depth < 4
         AND NOT r.old_id = ANY(c.path)
         AND r.relinked_at > NOW() - INTERVAL '${DMARKET_RELINK_TTL}'
     )
     SELECT DISTINCT ON (old_id) old_id, new_id
     FROM chain
     ORDER BY old_id, depth DESC`,
    [oldIds],
  );
  for (const row of rows) map.set(row.old_id, row.new_id);
  return map;
}

function isDMarketInput(input: TradeUpInput): boolean {
  return input.source === "dmarket" || input.listing_id.startsWith("dmarket:");
}

/**
 * Rewrite DMarket inputs to the live offer id. A trade-up is dropped when a
 * DMarket input is gone and has no fresh relink, or when two of its inputs
 * would land on the same listing. Prices and scores are left as discovered.
 * The same listing may still appear on different trade-ups.
 */
export async function retargetDMarketTradeUps(db: Queryable, tradeUps: readonly TradeUp[]): Promise<TradeUp[]> {
  const oldIds = new Set<string>();
  for (const tu of tradeUps) {
    for (const input of tu.inputs) {
      if (isDMarketInput(input)) oldIds.add(input.listing_id);
    }
  }
  if (oldIds.size === 0) return [...tradeUps];

  const relinks = await lookupDMarketRelinks(db, [...oldIds]);
  const candidates = new Set<string>(oldIds);
  for (const next of relinks.values()) candidates.add(next);
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM listings WHERE id = ANY($1::text[])`,
    [[...candidates]],
  );
  const live = new Set(rows.map(row => row.id));

  const kept: TradeUp[] = [];
  for (const tu of tradeUps) {
    let missing = false;
    let remapped = false;
    const inputs = tu.inputs.map(input => {
      if (!isDMarketInput(input)) return input;
      const next = relinks.get(input.listing_id) ?? input.listing_id;
      if (!live.has(next)) {
        missing = true;
        return input;
      }
      if (next === input.listing_id) return input;
      remapped = true;
      return { ...input, listing_id: next };
    });
    if (missing) continue;
    if (remapped) {
      const ids = inputs.map(input => input.listing_id);
      if (new Set(ids).size !== ids.length) continue;
    }
    kept.push(remapped ? { ...tu, inputs } : tu);
  }
  return kept;
}
