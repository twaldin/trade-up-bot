import { REBUILD_FETCH_SIZE, visitRows } from "./event-loop.js";

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
