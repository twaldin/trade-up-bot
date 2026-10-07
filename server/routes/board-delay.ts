// Public aggregate for the free-tier delay. No trade-up ids, listings, or skin names.
import { Router } from "express";
import type pg from "pg";
import { cacheGet, cacheSet } from "../redis.js";
import {
  BOARD_DELAY_SECONDS,
  parseBoardDelayRow,
  type BoardDelayGap,
} from "../../shared/board-delay.js";
import { ACTIVE_CLAIM_PREDICATE } from "./active-claim.js";

export const BOARD_DELAY_CACHE_KEY = "board_delay_gap_v2";
export const BOARD_DELAY_TTL_SEC = 60;

/**
 * Same age cut as the free list (`created_at > now - delay` is hidden) and the
 * same active-row filter as the public counts. `idx_tu_active_created` covers
 * the time range. Profit and the board's active-claim predicate are applied
 * in both aggregates, so an active claim drops out of the count and the best.
 */
const HIDDEN_PROFITABLE_ROW = `profit_cents > 0 AND NOT EXISTS (
      SELECT 1 FROM trade_up_claims
      WHERE trade_up_id = trade_ups.id
        AND ${ACTIVE_CLAIM_PREDICATE}
    )`;

export const BOARD_DELAY_SQL = `
  SELECT
    COUNT(*) FILTER (WHERE ${HIDDEN_PROFITABLE_ROW})::int AS hidden_profitable,
    MAX(profit_cents) FILTER (WHERE ${HIDDEN_PROFITABLE_ROW})::int AS best_hidden_profit_cents
  FROM trade_ups
  WHERE is_theoretical = false
    AND listing_status = 'active'
    AND created_at > NOW() - ($1::int * INTERVAL '1 second')
`;

export interface BoardDelayCache {
  cacheGet?: (key: string) => Promise<BoardDelayGap | null>;
  cacheSet?: (key: string, data: BoardDelayGap, ttlSeconds: number) => Promise<void>;
}

export async function loadBoardDelay(pool: pg.Pool, cache: BoardDelayCache = {}): Promise<BoardDelayGap | null> {
  const read = cache.cacheGet ?? ((key: string) => cacheGet<BoardDelayGap>(key));
  const write = cache.cacheSet ?? ((key: string, data: BoardDelayGap, ttl: number) => cacheSet(key, data, ttl));
  try {
    const cached = await read(BOARD_DELAY_CACHE_KEY);
    if (cached && typeof cached.hidden_profitable === "number") return parseBoardDelayRow(cached);
  } catch { /* redis down */ }

  try {
    const { rows } = await pool.query(BOARD_DELAY_SQL, [BOARD_DELAY_SECONDS]);
    const gap = parseBoardDelayRow(rows[0]);
    write(BOARD_DELAY_CACHE_KEY, gap, BOARD_DELAY_TTL_SEC).catch(() => {});
    return gap;
  } catch (err) {
    console.error("board-delay query failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

export function boardDelayRouter(pool: pg.Pool, cache: BoardDelayCache = {}): Router {
  const router = Router();
  router.get("/api/board-delay", async (_req, res) => {
    const gap = await loadBoardDelay(pool, cache);
    if (!gap) {
      res.status(500).json({ error: "Board delay counts are unavailable" });
      return;
    }
    res.setHeader("Cache-Control", `public, max-age=${BOARD_DELAY_TTL_SEC}`);
    res.json({
      delay_seconds: BOARD_DELAY_SECONDS,
      hidden_profitable: gap.hidden_profitable,
      best_hidden_profit_cents: gap.best_hidden_profit_cents,
    });
  });
  return router;
}
