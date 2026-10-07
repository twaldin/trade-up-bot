/**
 * One worker merge inside the daemon super-batch loop.
 * A failure is logged and reported as false so the cycle continues with the
 * next type. The process stays up; mergeTradeUps puts that type's re-queue back.
 */

import type pg from "pg";
import type { TradeUp } from "../../shared/types.js";
import { mergeTradeUps } from "../engine.js";

export async function mergeTaskTradeUps(
  pool: pg.Pool,
  taskName: string,
  tradeUps: TradeUp[],
  tradeUpType: string,
): Promise<boolean> {
  try {
    await mergeTradeUps(pool, tradeUps, tradeUpType);
    return true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`    ${taskName} merge failed (${tradeUpType}): ${message}`);
    return false;
  }
}
