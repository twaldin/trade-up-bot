/**
 * Which message the board shows when it has nothing (or can't get anything)
 * to paint. A failed or throttled request is never reported as "no matches".
 */

export const FILTERED_EMPTY_COPY = "No trade-ups match these filters.";
export const UNFILTERED_EMPTY_COPY = "No live trade-ups right now. Check back after the next scan.";
export const LOAD_ERROR_COPY = "Couldn't load trade-ups.";
/** Shown once a short page says the server has no further row. Copy pending sign-off. */
export const END_OF_LIST_COPY = "That's the end of this list.";
/** Shown when the list hits the 10,001 count cap with full pages still coming. Copy pending sign-off. */
export const LIST_CAP_COPY = "This list stops at 10,000 matches. Narrow the filters to see the rest.";

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
