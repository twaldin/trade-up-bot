/**
 * Query-string contract for GET /api/trade-ups.
 *
 * - `sort` takes the short keys below; column names are accepted as aliases.
 * - `min_chance` / `max_chance` are percents (0–100); the column is a 0–1 fraction.
 */

const SORT_COLUMNS: Readonly<Record<string, string>> = Object.freeze({
  trade_up_score: "t.trade_up_score",
  profit: "t.profit_cents",
  roi: "t.roi_percentage",
  chance: "t.chance_to_profit",
  cost: "t.total_cost_cents",
  ev: "t.expected_value_cents",
  created: "t.created_at",
  best: "t.best_case_cents",
  worst: "t.worst_case_cents",
});

const SORT_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  score: "trade_up_score",
  profit_cents: "profit",
  roi_percentage: "roi",
  chance_to_profit: "chance",
  total_cost_cents: "cost",
  expected_value_cents: "ev",
  created_at: "created",
  newest: "created",
  best_case_cents: "best",
  worst_case_cents: "worst",
});

const DEFAULT_SORT = "trade_up_score";

export function isKnownSortKey(sort: string): boolean {
  return Object.hasOwn(SORT_COLUMNS, sort) || Object.hasOwn(SORT_ALIASES, sort);
}

export function canonicalSortKey(sort: string | undefined): string {
  if (!sort) return DEFAULT_SORT;
  if (Object.hasOwn(SORT_COLUMNS, sort)) return sort;
  if (Object.hasOwn(SORT_ALIASES, sort)) return SORT_ALIASES[sort];
  return DEFAULT_SORT;
}

export function tradeUpSortColumn(sort: string | undefined): string {
  return SORT_COLUMNS[canonicalSortKey(sort)];
}

// chance_to_profit is a sum of float probabilities, so a certain trade-up can
// be stored as 0.9999999999999999. Far below any displayable percent.
const CHANCE_TOLERANCE = 1e-9;

/**
 * An invalid chance matches nothing. Dropping or clamping it would widen the
 * list, and a 400 would break older callers (Discord bot, legacy FilterBar).
 */
export const NO_CHANCE_MATCH = "no_match";

/**
 * Percent query value → SQL threshold on the 0–1 column; null (blank) skips
 * the filter; NO_CHANCE_MATCH for non-numeric or outside 0–100.
 */
export function chanceThreshold(
  percent: string | undefined,
  bound: "min" | "max",
): number | null | typeof NO_CHANCE_MATCH {
  if (percent === undefined || percent.trim() === "") return null;
  const value = Number(percent);
  if (!Number.isFinite(value) || value < 0 || value > 100) return NO_CHANCE_MATCH;
  const fraction = value / 100;
  return bound === "min" ? fraction - CHANCE_TOLERANCE : fraction + CHANCE_TOLERANCE;
}

const asString = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/**
 * Cache key built from what the handler will actually run, so equivalent
 * queries share an entry and an alias can never be served a result that was
 * cached under a different interpretation. Stays under the `tu:` prefix that
 * the daemon and claims invalidate.
 */
export function tradeUpsCacheKey(query: Record<string, unknown>, viewer: string, tier: string): string {
  const normalized: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(query)) {
    if (value === undefined || value === "") continue;
    normalized[name] = value;
  }
  normalized.sort = canonicalSortKey(asString(query.sort));
  normalized.order = query.order === "asc" ? "asc" : "desc";
  for (const [name, bound] of [["min_chance", "min"], ["max_chance", "max"]] as const) {
    const threshold = chanceThreshold(asString(query[name]), bound);
    if (threshold === null) delete normalized[name];
    else normalized[name] = threshold;
  }
  const ordered = Object.fromEntries(Object.entries(normalized).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return `tu:v2:${JSON.stringify(ordered)}${viewer}${tier}`;
}
