import { formatLandingStat } from "./landing-stats.js";
import { LIST_TOTAL_CAP, listExtent } from "./page-fetch.js";

/**
 * Which message the board shows when it has nothing (or can't get anything)
 * to paint. A failed or throttled request is never reported as "no matches".
 */

export const FILTERED_EMPTY_COPY = "No trade-ups match these filters.";
export const UNFILTERED_EMPTY_COPY = "No live trade-ups right now. Check back after the next scan.";
export const LOAD_ERROR_COPY = "Couldn't load trade-ups.";
/** Shown once a short page says the server has no further row. */
export const END_OF_LIST_COPY = "That's the end of this list.";
/** Shown when the list hits the 10,001 count cap with full pages still coming. */
export const LIST_CAP_COPY = `This list stops at ${formatLandingStat(LIST_TOTAL_CAP)} matches. Narrow the filters to see the rest.`;
/**
 * Deduped boards keep at most this many rows. Named in the cap line only when
 * the loaded list actually stopped on that many.
 */
export const DISPLAY_LIST_CAP = 1_000;
/** Shown when `has_more` cut the list at the 1,000-row snapshot. */
export const DISPLAY_CAP_COPY = `Showing the top ${formatLandingStat(DISPLAY_LIST_CAP)}. Narrow your filters to see more.`;
/** Shown after several pages of a very large board. Suggests narrowing; does not block paging. */
export const NARROW_FILTERS_HINT = "This list is long. Narrow it with Max cost or Min above cost %.";
export const NARROW_HINT_MIN_PAGES = 5;
export const NARROW_HINT_MIN_TOTAL = 1000;

/** Cap line for a list `has_more` cut off. Names 1,000 only when that many rows were kept. */
export function displayCapCopy(shown: number): string {
  if (shown === DISPLAY_LIST_CAP) return DISPLAY_CAP_COPY;
  if (Number.isFinite(shown) && shown > 0) {
    return `Showing ${formatLandingStat(shown)} trade-ups. Narrow your filters to see more.`;
  }
  return "This list was cut short. Narrow your filters to see more.";
}

/** Long-list hint. Size is `rawTotal`, then `total` when the response omitted it. */
export function showNarrowFiltersHint(state: {
  landedPage: number;
  rawTotal?: number | null;
  total?: number | null;
  exhausted: boolean;
  paging?: boolean;
  failed?: boolean;
  notice?: boolean;
}): boolean {
  if (state.exhausted || state.paging || state.failed || state.notice) return false;
  if (state.landedPage < NARROW_HINT_MIN_PAGES) return false;
  const extent = listExtent(state);
  return extent != null && extent > NARROW_HINT_MIN_TOTAL;
}

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
