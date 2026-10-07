/** `total_profitable` stops at 10001. The UI says 10,000+ and never prints that sentinel. */
export const PROFITABLE_COUNT_CAP = 10_001;
export const PROFITABLE_CAP_LABEL = "10,000+";

/** Missing or non-true flags are not capped. */
export function isProfitableCountCapped(flag: unknown): boolean {
  return flag === true;
}

/**
 * Label for a board `total_profitable`. A true cap flag, or the 10001 sentinel
 * itself, is "10,000+". Any other count is the number.
 */
export function formatProfitableCount(count: number, capped?: boolean | null): string {
  if (isProfitableCountCapped(capped) || (Number.isFinite(count) && Math.trunc(count) >= PROFITABLE_COUNT_CAP)) {
    return PROFITABLE_CAP_LABEL;
  }
  if (!Number.isFinite(count) || count <= 0) return "0";
  return Math.trunc(count).toLocaleString("en-US");
}

/**
 * "(N profitable)" after a found-count. Omitted for a deduped board: that
 * number is the kept rows after the per-combo cap, not every profitable trade-up.
 */
export function listProfitableSuffix(opts: {
  count: number;
  capped?: boolean | null;
  deduped?: boolean | null;
}): string | null {
  if (opts.deduped === true) return null;
  if (!Number.isFinite(opts.count) || opts.count <= 0) return null;
  return `(${formatProfitableCount(opts.count, opts.capped)} profitable)`;
}
