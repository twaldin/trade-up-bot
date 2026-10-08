/**
 * Durable cost recompute for a DMarket relink.
 *
 * The listing transaction records the affected trade-up ids in sync_meta and
 * commits. Recompute runs afterwards in short transactions. A crash between
 * those steps leaves the marker; the next fetcher cycle or daemon boot drains it.
 * Recompute reads the live input sum, so a later relink of the same listing
 * wins even if an earlier batch already wrote a cost.
 */

import type pg from "pg";
import { ascendingNumberIds, lockTradeUpsInIdOrder } from "./lock-order.js";
import { recomputeTradeUpCost } from "./db-stats.js";
import { markTradeUpsOutlierStale } from "./input-outlier.js";

export const DMARKET_RELINK_RECOMPUTE_PREFIX = "dm_relink_recompute:";
export const DMARKET_RELINK_RECOMPUTE_BATCH = 50;
const RECOMPUTE_ATTEMPTS = 3;

export interface DMarketRelinkRecomputeOptions {
  batchSize?: number;
  backoffMs?: number;
  /** Called once per attempt, before the batch transaction. */
  beforeBatch?: (ids: readonly number[]) => Promise<void>;
}

export interface DMarketRelinkRecomputeDrain {
  recomputed: number;
  flagged: number;
  requeued: number;
}

interface Marker {
  key: string;
  recomputeIds: number[];
  flaggedIds: number[];
}

type Queryable = pg.Pool | pg.PoolClient;

function pgErrorCode(err: unknown): string {
  if (typeof err !== "object" || err === null || !("code" in err)) return "";
  return typeof err.code === "string" ? err.code : "";
}

function markerKey(oldId: string): string {
  return `${DMARKET_RELINK_RECOMPUTE_PREFIX}${oldId}`;
}

export async function recordDMarketRelinkRecompute(
  db: Queryable,
  oldId: string,
  recomputeIds: readonly number[],
  flaggedIds: readonly number[],
): Promise<void> {
  const recompute = ascendingNumberIds(recomputeIds);
  const flagged = ascendingNumberIds(flaggedIds);
  if (recompute.length === 0 && flagged.length === 0) return;
  await db.query(
    `INSERT INTO sync_meta (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [markerKey(oldId), JSON.stringify({ recomputeIds: recompute, flaggedIds: flagged })],
  );
}

async function loadMarkers(pool: pg.Pool): Promise<Marker[]> {
  const { rows } = await pool.query<{ key: string; value: string }>(
    `SELECT key, value FROM sync_meta WHERE key LIKE $1 ORDER BY key`,
    [`${DMARKET_RELINK_RECOMPUTE_PREFIX}%`],
  );
  const markers: Marker[] = [];
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.value) as { recomputeIds?: unknown; flaggedIds?: unknown };
      const recomputeIds = Array.isArray(parsed.recomputeIds)
        ? parsed.recomputeIds.filter((id): id is number => typeof id === "number")
        : [];
      const flaggedIds = Array.isArray(parsed.flaggedIds)
        ? parsed.flaggedIds.filter((id): id is number => typeof id === "number")
        : [];
      markers.push({ key: row.key, recomputeIds, flaggedIds });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`DMarket relink recompute requeued 0 trade-ups: marker ${row.key} is not json (${reason})`);
    }
  }
  return markers;
}

async function recomputeBatch(pool: pg.Pool, ids: readonly number[]): Promise<void> {
  const ordered = ascendingNumberIds(ids);
  if (ordered.length === 0) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    await lockTradeUpsInIdOrder(client, ordered);
    for (const id of ordered) await recomputeTradeUpCost(client, id);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function flagBatch(pool: pg.Pool, ids: readonly number[]): Promise<void> {
  const ordered = ascendingNumberIds(ids);
  if (ordered.length === 0) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    await lockTradeUpsInIdOrder(client, ordered);
    await markTradeUpsOutlierStale(client, ordered);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function withRecomputeAttempts(
  label: string,
  count: number,
  opts: DMarketRelinkRecomputeOptions | undefined,
  beforeAttempt: (() => Promise<void>) | undefined,
  fn: () => Promise<void>,
): Promise<boolean> {
  const backoffMs = opts?.backoffMs ?? 50;
  for (let attempt = 0; attempt < RECOMPUTE_ATTEMPTS; attempt++) {
    try {
      if (beforeAttempt) await beforeAttempt();
      await fn();
      return true;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const code = pgErrorCode(err);
      if (attempt + 1 >= RECOMPUTE_ATTEMPTS) {
        console.error(`DMarket relink recompute requeued ${count} trade-ups: ${code ? `${code} ` : ""}${reason}`);
        return false;
      }
      console.warn(
        `DMarket relink recompute retry ${attempt + 1} for ${count} trade-ups (${code || label}): ${reason}`,
      );
      const wait = backoffMs * 2 ** attempt;
      if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    }
  }
  return false;
}

async function runIdBatches(
  pool: pg.Pool,
  ids: readonly number[],
  opts: DMarketRelinkRecomputeOptions | undefined,
  run: (batch: number[]) => Promise<void>,
): Promise<boolean> {
  const ordered = ascendingNumberIds(ids);
  if (ordered.length === 0) return true;
  const batchSize = opts?.batchSize ?? DMARKET_RELINK_RECOMPUTE_BATCH;
  for (let i = 0; i < ordered.length; i += batchSize) {
    const batch = ordered.slice(i, i + batchSize);
    const remaining = ordered.length - i;
    const beforeBatch = opts?.beforeBatch;
    const ok = await withRecomputeAttempts(
      "batch",
      remaining,
      opts,
      beforeBatch ? () => beforeBatch(batch) : undefined,
      () => run(batch),
    );
    if (!ok) return false;
  }
  return true;
}

async function drainMarker(
  pool: pg.Pool,
  marker: Marker,
  opts: DMarketRelinkRecomputeOptions | undefined,
): Promise<boolean> {
  const recomputed = await runIdBatches(pool, marker.recomputeIds, opts, batch => recomputeBatch(pool, batch));
  if (!recomputed) return false;
  const flagged = await runIdBatches(
    pool,
    marker.flaggedIds,
    { batchSize: opts?.batchSize, backoffMs: opts?.backoffMs },
    batch => flagBatch(pool, batch),
  );
  if (!flagged) return false;
  await pool.query(`DELETE FROM sync_meta WHERE key = $1`, [marker.key]);
  return true;
}

export async function drainDMarketRelinkRecomputes(
  pool: pg.Pool,
  opts?: DMarketRelinkRecomputeOptions,
): Promise<DMarketRelinkRecomputeDrain> {
  let recomputed = 0;
  let flagged = 0;
  let requeued = 0;
  for (;;) {
    const markers = await loadMarkers(pool);
    if (markers.length === 0) break;
    let progressed = false;
    requeued = 0;
    for (const marker of markers) {
      const done = await drainMarker(pool, marker, opts);
      if (done) {
        progressed = true;
        recomputed += marker.recomputeIds.length;
        flagged += marker.flaggedIds.length;
      } else {
        requeued += marker.recomputeIds.length + marker.flaggedIds.length;
      }
    }
    if (!progressed) break;
  }
  return { recomputed, flagged, requeued };
}
