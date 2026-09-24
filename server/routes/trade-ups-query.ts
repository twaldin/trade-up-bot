/**
 * Query-string contract for GET /api/trade-ups.
 *
 * - `sort` takes the short keys below; column names are accepted as aliases.
 * - `min_chance` / `max_chance` are percents (0–100); the column is a 0–1 fraction.
 */

export const TRADE_UP_SORT_COLUMNS: Readonly<Record<string, string>> = Object.freeze({
  trade_up_score: "t.trade_up_score",
  score: "t.trade_up_score",
  profit: "t.profit_cents",
  profit_cents: "t.profit_cents",
  roi: "t.roi_percentage",
  roi_percentage: "t.roi_percentage",
  chance: "t.chance_to_profit",
  chance_to_profit: "t.chance_to_profit",
  cost: "t.total_cost_cents",
  total_cost_cents: "t.total_cost_cents",
  ev: "t.expected_value_cents",
  expected_value_cents: "t.expected_value_cents",
  created: "t.created_at",
  created_at: "t.created_at",
  best: "t.best_case_cents",
  best_case_cents: "t.best_case_cents",
  worst: "t.worst_case_cents",
  worst_case_cents: "t.worst_case_cents",
});

const DEFAULT_SORT_COLUMN = "t.trade_up_score";

export function tradeUpSortColumn(sort: string | undefined): string {
  if (!sort || !Object.hasOwn(TRADE_UP_SORT_COLUMNS, sort)) return DEFAULT_SORT_COLUMN;
  return TRADE_UP_SORT_COLUMNS[sort];
}

// chance_to_profit is a sum of float probabilities, so a certain trade-up can
// be stored as 0.9999999999999999. Far below any displayable percent.
const CHANCE_TOLERANCE = 1e-9;

/** Percent query value → SQL threshold on the 0–1 column, or null to skip the filter. */
export function chanceThreshold(percent: string | undefined, bound: "min" | "max"): number | null {
  if (!percent) return null;
  const value = Number(percent);
  if (!Number.isFinite(value)) return null;
  const fraction = Math.min(100, Math.max(0, value)) / 100;
  return bound === "min" ? fraction - CHANCE_TOLERANCE : fraction + CHANCE_TOLERANCE;
}
