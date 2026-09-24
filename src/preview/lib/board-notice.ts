/**
 * Which message the board shows when it has nothing (or can't get anything)
 * to paint. A failed or throttled request is never reported as "no matches".
 */

export const FILTERED_EMPTY_COPY = "No trade-ups match these filters.";
export const UNFILTERED_EMPTY_COPY = "No live trade-ups right now. Check back after the next scan.";
export const LOAD_ERROR_COPY = "Couldn't load trade-ups.";

export type BoardNoticeKind = "throttled" | "error" | "filtered-empty" | "empty";

export function boardNotice(state: {
  loading: boolean;
  rows: number;
  throttled: boolean;
  failed: boolean;
  filtered: boolean;
}): BoardNoticeKind | null {
  if (state.throttled) return "throttled";
  if (state.failed) return "error";
  if (state.loading || state.rows > 0) return null;
  return state.filtered ? "filtered-empty" : "empty";
}
