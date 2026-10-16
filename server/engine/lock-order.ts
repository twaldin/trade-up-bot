/**
 * Every transaction that locks more than one row of trade_ups, trade_up_inputs,
 * or listings takes those locks one row at a time in ascending id order;
 * trade_up_inputs has no id column, so those rows lock in ascending
 * (trade_up_id, listing_id) order.
 *
 * A single `ORDER BY id ... FOR UPDATE` does not acquire row locks in that
 * order: the executor can lock during the scan and sort afterwards.
 */

import type pg from "pg";

export const TRADE_UP_LOCK_ORDER_RULE =
  "Every transaction that locks more than one row of trade_ups, trade_up_inputs, or listings takes those locks one row at a time in ascending id order; trade_up_inputs has no id column, so those rows lock in ascending (trade_up_id, listing_id) order.";

type Queryable = pg.Pool | pg.PoolClient;

export function ascendingNumberIds(ids: readonly number[]): number[] {
  return [...new Set(ids)].sort((a, b) => a - b);
}

export function ascendingTextIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export interface TradeUpInputKey {
  tradeUpId: number;
  listingId: string;
}

export function ascendingInputKeys(keys: readonly TradeUpInputKey[]): TradeUpInputKey[] {
  const seen = new Set<string>();
  const unique: TradeUpInputKey[] = [];
  for (const key of keys) {
    const sig = `${key.tradeUpId}\0${key.listingId}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    unique.push(key);
  }
  unique.sort((a, b) => a.tradeUpId - b.tradeUpId || (a.listingId < b.listingId ? -1 : a.listingId > b.listingId ? 1 : 0));
  return unique;
}

export async function lockTradeUpsInIdOrder(
  db: Queryable,
  ids: readonly number[],
  afterEach?: (id: number) => Promise<void>,
): Promise<void> {
  for (const id of ascendingNumberIds(ids)) {
    const { rows } = await db.query<{ id: number }>(
      `SELECT id FROM trade_ups WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (rows.length > 0 && afterEach) await afterEach(id);
  }
}

export async function lockListingsInIdOrder(
  db: Queryable,
  ids: readonly string[],
  mode: "UPDATE" | "KEY SHARE" = "UPDATE",
): Promise<string[]> {
  const clause = mode === "KEY SHARE" ? "FOR KEY SHARE" : "FOR UPDATE";
  const held: string[] = [];
  for (const id of ascendingTextIds(ids)) {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM listings WHERE id = $1 ${clause}`,
      [id],
    );
    if (rows[0]) held.push(rows[0].id);
  }
  return held;
}

export async function lockTradeUpInputsInIdOrder(
  db: Queryable,
  keys: readonly TradeUpInputKey[],
): Promise<void> {
  for (const key of ascendingInputKeys(keys)) {
    await db.query(
      `SELECT trade_up_id FROM trade_up_inputs WHERE trade_up_id = $1 AND listing_id = $2 FOR UPDATE`,
      [key.tradeUpId, key.listingId],
    );
  }
}

export async function lockTradeUpInputsForTradeUps(
  db: Queryable,
  tradeUpIds: readonly number[],
): Promise<void> {
  const ids = ascendingNumberIds(tradeUpIds);
  if (ids.length === 0) return;
  const { rows } = await db.query<{ trade_up_id: number; listing_id: string }>(
    `SELECT trade_up_id, listing_id FROM trade_up_inputs WHERE trade_up_id = ANY($1::int[])`,
    [ids],
  );
  await lockTradeUpInputsInIdOrder(
    db,
    rows.map(row => ({ tradeUpId: Number(row.trade_up_id), listingId: row.listing_id })),
  );
}
