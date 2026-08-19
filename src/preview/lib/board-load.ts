/**
 * Board load order.
 *
 * Skin art is decoration; outcomes are the product. The first cut of this
 * awaited `loadFaces` between hydrating and applying, so a faces route that
 * hung left the board sitting on "Outcomes loading…" with the outcomes already
 * in hand. Rows are applied and loading is cleared before faces are touched,
 * and faces are warmed afterwards without anything waiting on them.
 */

export interface BoardLoadPorts<T> {
  fetchRows: () => Promise<{ rows: T[]; isFree: boolean }>;
  hydrate: (row: T) => Promise<T>;
  namesOf: (rows: T[]) => string[];
  warmFaces: (names: string[]) => Promise<unknown>;
  /** True while paging in: rows are appended instead of replacing the board. */
  append?: boolean;
  emit: {
    rows: (rows: T[] | ((previous: T[]) => T[])) => void;
    isFree: (isFree: boolean) => void;
    loading: (loading: boolean) => void;
    facesReady: () => void;
    /** Number of rows this page returned, so the caller can stop paging. */
    pageSize?: (count: number) => void;
  };
}

export async function loadBoardRows<T>(ports: BoardLoadPorts<T>): Promise<void> {
  const { emit, append = false } = ports;
  emit.loading(true);

  const put = (next: T[]) => {
    if (append) emit.rows((previous) => [...previous, ...next]);
    else emit.rows(next);
  };
  const replaceTail = (next: T[], count: number) => {
    if (append) emit.rows((previous) => [...previous.slice(0, previous.length - count), ...next]);
    else emit.rows(next);
  };

  let painted: T[] | null = null;
  try {
    const { rows, isFree } = await ports.fetchRows();
    emit.isFree(isFree);
    emit.pageSize?.(rows.length);
    put(rows);
    painted = rows;

    const hydrated = await Promise.all(
      rows.map(async (row) => {
        try {
          return await ports.hydrate(row);
        } catch {
          return row;
        }
      }),
    );
    replaceTail(hydrated, rows.length);
    painted = hydrated;
  } catch {
    if (!append) emit.rows([]);
    painted = null;
  } finally {
    emit.loading(false);
  }

  if (!painted || painted.length === 0) return;
  const names = ports.namesOf(painted);
  if (names.length === 0) return;
  void ports.warmFaces(names).then(() => emit.facesReady(), () => {});
}
