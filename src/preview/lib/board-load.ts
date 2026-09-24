/**
 * Board load order.
 *
 * Skin art is decoration; outcomes are the product. The first cut of this
 * awaited `loadFaces` between hydrating and applying, so a faces route that
 * hung left the board sitting on "Outcomes loading…" with the outcomes already
 * in hand. Rows are applied and loading is cleared before faces are touched,
 * and faces are warmed afterwards without anything waiting on them.
 */

import { isRateLimitError } from "./page-fetch.js";

/**
 * The list embeds what each card needs. Without it every row cost two more
 * requests (outcomes + inputs): 26 per 12-card page against a 120/min limiter.
 * Hosts that ignore `include` still work — `hydrate` fetches whatever is missing.
 */
export const BOARD_LIST_INCLUDE = "outcomes,inputs";

export function boardListUrl(key: string, page: number): string {
  return `/api/trade-ups?${key}&page=${page}&include=${BOARD_LIST_INCLUDE}`;
}

export interface BoardLoadPorts<T> {
  fetchRows: () => Promise<{ rows: T[]; isFree: boolean; total?: number }>;
  hydrate: (row: T) => Promise<T>;
  namesOf: (rows: T[]) => string[];
  warmFaces: (names: string[]) => Promise<unknown>;
  /** True while paging in: rows are appended instead of replacing the board. */
  append?: boolean;
  /**
   * False once a newer load owns the board (a filter change, the next page, or
   * StrictMode's discarded first effect). A stale run that still cleared
   * `loading` would unlock paging mid-hydration and strand page one bare.
   */
  isLive?: () => boolean;
  emit: {
    rows: (rows: T[] | ((previous: T[]) => T[])) => void;
    isFree: (isFree: boolean) => void;
    loading: (loading: boolean) => void;
    facesReady: () => void;
    /** Rows this page returned and the API total, so the caller can stop paging. */
    pageSize?: (count: number, total?: number) => void;
    /** 429 / "Too many requests" — do not treat as an empty page. */
    rateLimited?: () => void;
    /** Any other failed list request — not an empty result either. */
    failed?: () => void;
  };
}

export async function loadBoardRows<T>(ports: BoardLoadPorts<T>): Promise<void> {
  const { emit, append = false } = ports;
  const live = () => ports.isLive?.() ?? true;
  emit.loading(true);

  const put = (next: T[]) => {
    if (!live()) return;
    if (append) emit.rows((previous) => [...previous, ...next]);
    else emit.rows(next);
  };
  const replaceTail = (next: T[], count: number) => {
    if (!live()) return;
    if (append) emit.rows((previous) => [...previous.slice(0, previous.length - count), ...next]);
    else emit.rows(next);
  };

  let painted: T[] | null = null;
  try {
    const { rows, isFree, total } = await ports.fetchRows();
    if (!live()) return;
    emit.isFree(isFree);
    emit.pageSize?.(rows.length, total);
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
  } catch (err) {
    if (!live()) return;
    // A first page belongs to a new filter, so the old filter's rows must go either way.
    if (!append) emit.rows([]);
    if (isRateLimitError(err)) emit.rateLimited?.();
    else emit.failed?.();
    painted = null;
  } finally {
    if (live()) emit.loading(false);
  }

  if (!live() || !painted || painted.length === 0) return;
  const names = ports.namesOf(painted);
  if (names.length === 0) return;
  void ports.warmFaces(names).then(() => { if (live()) emit.facesReady(); }, () => {});
}
