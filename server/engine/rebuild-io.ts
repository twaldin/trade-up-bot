import pg from "pg";
import { REBUILD_FETCH_SIZE, visitRows, yieldEventLoop } from "./event-loop.js";

const CURSOR_NAME = /^[a-z_][a-z0-9_]*$/;

let cursorSqlForTests: ((sql: string) => void) | null = null;

/** test seam — observes SQL sent on the cursor connection. */
export function setReadOnlyCursorSqlForTests(listener: ((sql: string) => void) | null): void {
  cursorSqlForTests = listener;
}

function send(client: pg.PoolClient, sql: string): Promise<pg.QueryResult> {
  cursorSqlForTests?.(sql);
  return client.query(sql);
}

function asError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * Stream one SELECT from a single REPEATABLE READ snapshot.
 * FETCH `batchSize` rows at a time and yield between batches.
 * A throw or a statement timeout still CLOSE, ROLLBACK, and release.
 * If ROLLBACK fails, the client is released with that error so the pool drops it.
 */
export async function forEachReadOnlyCursor<T extends pg.QueryResultRow>(
  pool: pg.Pool,
  cursorName: string,
  querySql: string,
  batchSize: number,
  onRow: (row: T) => void,
): Promise<void> {
  if (!CURSOR_NAME.test(cursorName)) throw new Error("invalid cursor name");
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error("invalid cursor batch size");

  const client = await pool.connect();
  let released = false;
  const release = (err?: Error) => {
    if (released) return;
    released = true;
    client.release(err);
  };

  let committed = false;
  try {
    await send(client, "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await send(client, `DECLARE ${cursorName} NO SCROLL CURSOR FOR ${querySql}`);
    for (;;) {
      const fetched = await send(client, `FETCH ${batchSize} FROM ${cursorName}`);
      const rows = fetched.rows as T[];
      if (rows.length === 0) break;
      await visitRows(rows, onRow);
      await yieldEventLoop();
    }
    await send(client, `CLOSE ${cursorName}`);
    await send(client, "COMMIT");
    committed = true;
  } finally {
    if (!committed) {
      try {
        await send(client, `CLOSE ${cursorName}`);
      } catch {
        // Not declared yet, or CLOSE already succeeded before COMMIT failed.
      }
      try {
        await send(client, "ROLLBACK");
        release();
      } catch (rollbackErr) {
        release(asError(rollbackErr));
      }
    } else {
      release();
    }
  }
}

/**
 * Read a keyset page, visit its rows in small turns, then ask for the next page.
 * A full page that does not advance the key fails the rebuild instead of looping
 * or publishing a partial snapshot.
 */
export async function forEachKeysetPage<T>(
  loadPage: (after: string | number | null) => Promise<readonly T[]>,
  idOf: (row: T) => string | number | null,
  onRow: (row: T) => void,
): Promise<void> {
  let after: string | number | null = null;
  for (;;) {
    const rows = await loadPage(after);
    await visitRows(rows, onRow);
    if (rows.length < REBUILD_FETCH_SIZE) return;
    const next = idOf(rows[rows.length - 1]);
    if (next === null || next === after) {
      throw new Error("cache page did not advance");
    }
    after = next;
  }
}
