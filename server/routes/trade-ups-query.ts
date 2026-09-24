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

export function canonicalSortKey(sort: unknown): string {
  if (typeof sort !== "string" || !sort) return DEFAULT_SORT;
  if (Object.hasOwn(SORT_COLUMNS, sort)) return sort;
  if (Object.hasOwn(SORT_ALIASES, sort)) return SORT_ALIASES[sort];
  return DEFAULT_SORT;
}

export function tradeUpSortColumn(sort: unknown): string {
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
  percent: unknown,
  bound: "min" | "max",
): number | null | typeof NO_CHANCE_MATCH {
  if (percent == null) return null;
  if (typeof percent !== "string") return NO_CHANCE_MATCH;
  if (percent.trim() === "") return null;
  const value = Number(percent);
  if (!Number.isFinite(value) || value < 0 || value > 100) return NO_CHANCE_MATCH;
  const fraction = value / 100;
  return bound === "min" ? fraction - CHANCE_TOLERANCE : fraction + CHANCE_TOLERANCE;
}

/**
 * Cache key built from what the handler will actually run, so equivalent
 * queries share an entry and an alias can never be served a result that was
 * cached under a different interpretation. Stays under the `tu:` prefix that
 * the daemon and claims invalidate.
 *
 * `tier` is the effective delay tier: internal-token calls are "pro" (no delay),
 * same as a signed-in pro user. Anonymous stays "free".
 */
export function tradeUpsCacheKey(query: Record<string, unknown>, viewer: string, tier: string): string {
  const normalized: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(query)) {
    if (value === undefined || value === "") continue;
    if (name === "page" && (value === "1" || value === 1)) continue;
    normalized[name] = value;
  }
  normalized.sort = canonicalSortKey(query.sort);
  normalized.order = query.order === "asc" ? "asc" : "desc";
  for (const [name, bound] of [["min_chance", "min"], ["max_chance", "max"]] as const) {
    const threshold = chanceThreshold(query[name], bound);
    if (threshold === null) delete normalized[name];
    else normalized[name] = threshold;
  }
  const ordered = Object.fromEntries(Object.entries(normalized).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return `tu:v2:${JSON.stringify(ordered)}${viewer}${tier}`;
}

/** Delay tier the list handler will actually apply, including the internal bot token. */
export function listCacheTier(opts: { tier?: string; authorization?: string; internalToken?: string }): string {
  const internal = Boolean(opts.internalToken && opts.authorization === `Bearer ${opts.internalToken}`);
  return internal ? "pro" : (opts.tier || "free");
}

/**
 * Same age cut the list uses: `created_at <= now - delay` stays visible.
 * A row strictly younger than `delaySeconds` is hidden. `delaySeconds` comes
 * from `getTierConfig` (0 for Pro / internal). The boundary instant is visible.
 */
export function tradeUpHiddenByDelay(createdAt: string | Date, delaySeconds: number, nowMs = Date.now()): boolean {
  if (!(delaySeconds > 0)) return false;
  const createdMs = new Date(createdAt).getTime();
  if (Number.isNaN(createdMs)) return true;
  return createdMs > nowMs - delaySeconds * 1000;
}
