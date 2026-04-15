import type { TradeUp } from "../../shared/types.js";

export type WorkerTask =
  | "knife"
  | "classified"
  | "restricted"
  | "milspec"
  | "industrial"
  | "consumer";

/**
 * Hard cap on in-memory results per worker task.
 * Prevents low-tier workers from building very large arrays that can OOM.
 */
export const WORKER_MAX_RESULTS_BY_TASK: Record<WorkerTask, number> = {
  knife: 25_000,
  classified: 30_000,
  restricted: 30_000,
  milspec: 25_000,
  industrial: 20_000,
  consumer: 15_000,
};

/**
 * Cap DB signature preload for dedup.
 * We only need enough recent signatures to avoid rediscovering most known combos.
 */
export const WORKER_MAX_EXISTING_SIGS_BY_TASK: Record<WorkerTask, number> = {
  knife: 120_000,
  classified: 120_000,
  restricted: 100_000,
  milspec: 80_000,
  industrial: 60_000,
  consumer: 50_000,
};

/**
 * Keep the most useful trade-ups when we must trim a large result set.
 * Priority: profitable > high chance-to-profit > everything else.
 */
export function capWorkerTradeUps(tradeUps: TradeUp[], maxResults: number): TradeUp[] {
  if (tradeUps.length <= maxResults) return tradeUps;

  const profitable: TradeUp[] = [];
  const highChance: TradeUp[] = [];
  const rest: TradeUp[] = [];

  for (const tu of tradeUps) {
    const chance = tu.chance_to_profit ?? 0;
    if (tu.profit_cents > 0) {
      profitable.push(tu);
    } else if (chance >= 0.25) {
      highChance.push(tu);
    } else {
      rest.push(tu);
    }
  }

  profitable.sort((a, b) => b.profit_cents - a.profit_cents || b.roi_percentage - a.roi_percentage);
  highChance.sort((a, b) => (b.chance_to_profit ?? 0) - (a.chance_to_profit ?? 0) || b.profit_cents - a.profit_cents);
  rest.sort((a, b) => b.profit_cents - a.profit_cents);

  return [...profitable, ...highChance, ...rest].slice(0, maxResults);
}
