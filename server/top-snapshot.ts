/**
 * Daily copy of the top 1000 active trade-ups by score.
 * One INSERT … SELECT, then bounded deletes of rows older than 14 days.
 * Timeouts are local to the transaction so a slow lock gives up.
 */
import pg from "pg";

export const TOP_SNAPSHOT_LIMIT = 1000;
export const TOP_SNAPSHOT_PURGE_BATCH = 1000;
export const TOP_SNAPSHOT_STATEMENT_TIMEOUT = "10s";
export const TOP_SNAPSHOT_LOCK_TIMEOUT = "2s";
export const TOP_SNAPSHOT_RETENTION = "14 days";

const TIMEOUT_PATTERN = /^[0-9]+(ms|s|min)$/;
const GIVE_UP_CODES = new Set(["57014", "55P03"]);

export interface TopSnapshotOptions {
  statementTimeout?: string;
  lockTimeout?: string;
  batchSize?: number;
}

export interface TopSnapshotWriteResult {
  inserted: number;
  gaveUp: boolean;
}

export interface TopSnapshotPurgeResult {
  purged: number;
  gaveUp: boolean;
}

export interface TopSnapshotJobResult {
  inserted: number;
  purged: number;
  gaveUp: boolean;
}

export function localTimeoutStatements(statementTimeout: string, lockTimeout: string): string {
  if (!TIMEOUT_PATTERN.test(statementTimeout) || !TIMEOUT_PATTERN.test(lockTimeout)) {
    throw new Error("invalid timeout");
  }
  return `SET LOCAL statement_timeout = '${statementTimeout}'; SET LOCAL lock_timeout = '${lockTimeout}'`;
}

export function isTopSnapshotGiveUp(err: unknown): boolean {
  if (typeof err !== "object" || err === null || !("code" in err)) return false;
  const code = err.code;
  return typeof code === "string" && GIVE_UP_CODES.has(code);
}

/** collection stores trade_ups.collection_names. score stores trade_up_score. */
export const TRADE_UP_TOP_SNAPSHOTS_DDL = `
CREATE TABLE IF NOT EXISTS trade_up_top_snapshots (
  snapshot_at TIMESTAMPTZ NOT NULL,
  trade_up_id INTEGER NOT NULL,
  score INTEGER,
  profit INTEGER NOT NULL,
  cost INTEGER NOT NULL,
  ev INTEGER NOT NULL,
  roi DOUBLE PRECISION NOT NULL,
  input_sources TEXT[] NOT NULL DEFAULT '{}',
  collection TEXT[] NOT NULL DEFAULT '{}',
  UNIQUE (snapshot_at, trade_up_id)
);
CREATE INDEX IF NOT EXISTS idx_trade_up_top_snapshots_at
  ON trade_up_top_snapshots (snapshot_at);
`;

/**
 * Plain read of trade_ups. is_theoretical = false matches idx_tu_active_score
 * so the top-N does not sort the whole table. NULL scores sort last.
 */
export const INSERT_TOP_SNAPSHOT_SQL = `
INSERT INTO trade_up_top_snapshots (
  snapshot_at, trade_up_id, score, profit, cost, ev, roi, input_sources, collection
)
SELECT NOW(), t.id, t.trade_up_score, t.profit_cents, t.total_cost_cents,
       t.expected_value_cents, t.roi_percentage, t.input_sources, t.collection_names
FROM trade_ups AS t
WHERE t.listing_status = 'active'
  AND t.is_theoretical = false
ORDER BY t.trade_up_score DESC NULLS LAST, t.id ASC
LIMIT ${TOP_SNAPSHOT_LIMIT}
`;

/** snapshot_at < cutoff can use idx_trade_up_top_snapshots_at. LIMIT bounds each batch. */
export const PURGE_TOP_SNAPSHOT_SQL = `
WITH doomed AS (
  SELECT snapshot_at, trade_up_id
  FROM trade_up_top_snapshots
  WHERE snapshot_at < NOW() - INTERVAL '${TOP_SNAPSHOT_RETENTION}'
  ORDER BY snapshot_at
  LIMIT $1::int
)
DELETE FROM trade_up_top_snapshots AS snap
USING doomed
WHERE snap.snapshot_at = doomed.snapshot_at
  AND snap.trade_up_id = doomed.trade_up_id
`;

function timeouts(opts: TopSnapshotOptions): { statementTimeout: string; lockTimeout: string } {
  return {
    statementTimeout: opts.statementTimeout ?? TOP_SNAPSHOT_STATEMENT_TIMEOUT,
    lockTimeout: opts.lockTimeout ?? TOP_SNAPSHOT_LOCK_TIMEOUT,
  };
}

async function inShortTransaction<T>(
  pool: pg.Pool,
  opts: TopSnapshotOptions,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  const { statementTimeout, lockTimeout } = timeouts(opts);
  let releaseErr: Error | undefined;
  try {
    await client.query("BEGIN");
    await client.query(localTimeoutStatements(statementTimeout, lockTimeout));
    const value = await fn(client);
    await client.query("COMMIT");
    return value;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      releaseErr = rollbackErr instanceof Error ? rollbackErr : new Error("ROLLBACK failed");
    }
    throw err;
  } finally {
    client.release(releaseErr);
  }
}

export async function snapshotTopTradeUps(
  pool: pg.Pool,
  opts: TopSnapshotOptions = {},
): Promise<TopSnapshotWriteResult> {
  try {
    const inserted = await inShortTransaction(pool, opts, async (client) => {
      const result = await client.query(INSERT_TOP_SNAPSHOT_SQL);
      return result.rowCount ?? 0;
    });
    return { inserted, gaveUp: false };
  } catch (err) {
    if (isTopSnapshotGiveUp(err)) return { inserted: 0, gaveUp: true };
    throw err;
  }
}

export async function purgeOldTopSnapshots(
  pool: pg.Pool,
  opts: TopSnapshotOptions = {},
): Promise<TopSnapshotPurgeResult> {
  const batchSize = opts.batchSize ?? TOP_SNAPSHOT_PURGE_BATCH;
  let purged = 0;
  for (;;) {
    let deleted = 0;
    try {
      deleted = await inShortTransaction(pool, opts, async (client) => {
        const result = await client.query(PURGE_TOP_SNAPSHOT_SQL, [batchSize]);
        return result.rowCount ?? 0;
      });
    } catch (err) {
      if (isTopSnapshotGiveUp(err)) return { purged, gaveUp: true };
      throw err;
    }
    purged += deleted;
    if (deleted < batchSize) return { purged, gaveUp: false };
  }
}

export async function runTopSnapshotJob(
  pool: pg.Pool,
  opts: TopSnapshotOptions = {},
): Promise<TopSnapshotJobResult> {
  const snap = await snapshotTopTradeUps(pool, opts);
  if (snap.gaveUp) return { inserted: 0, purged: 0, gaveUp: true };
  const purge = await purgeOldTopSnapshots(pool, opts);
  return { inserted: snap.inserted, purged: purge.purged, gaveUp: purge.gaveUp };
}
