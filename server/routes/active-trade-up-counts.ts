import type pg from "pg";

/** Rows a visitor can still open: not sold, stale, or partial. */
export const ACTIVE_TRADE_UP_COUNT_SQL =
  "SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE profit_cents > 0)::int AS profitable FROM trade_ups WHERE listing_status = 'active' AND is_theoretical = false";

export async function loadActiveTradeUpCounts(pool: pg.Pool): Promise<{ total: number; profitable: number }> {
  const { rows: [row] } = await pool.query<{ total: number; profitable: number }>(ACTIVE_TRADE_UP_COUNT_SQL);
  return {
    total: Number(row?.total) || 0,
    profitable: Number(row?.profitable) || 0,
  };
}

/** Meta description for /trade-ups. `counts` must be the active-only query. */
export function tradeUpsHubDescription(counts: { total: number; profitable: number }): string {
  const profitable = counts.profitable.toLocaleString("en-US");
  const total = counts.total.toLocaleString("en-US");
  return `${profitable} CS2 trade-ups with positive expected profit after fees, of ${total} live contracts.`;
}
