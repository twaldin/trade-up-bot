/** Rows processed on the calculator rebuild path before yielding the event loop. */
export const REBUILD_YIELD_EVERY = 200;

/** Rows fetched per page so node-pg does not parse a full listing scan in one turn. */
export const REBUILD_FETCH_SIZE = 400;

export function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

export async function visitRows<T>(rows: readonly T[], visit: (row: T) => void): Promise<void> {
  for (let i = 0; i < rows.length; i++) {
    visit(rows[i]);
    if ((i + 1) % REBUILD_YIELD_EVERY === 0) await yieldEventLoop();
  }
}
