/**
 * Browser URL for the /trade-ups board.
 *
 * Param names match GET /api/trade-ups (PR 159): min_chance is a percent,
 * min_profit and max_cost are integer cents, sort is a short key.
 * Default filters produce a bare /trade-ups path. Unknown params are left
 * in place (attribution) and are not copied into board state.
 */
import {
  BOARD_SORTS,
  BOARD_TYPES,
  DEFAULT_QUERY,
  type BoardQuery,
} from "../components/PreviewFilters.js";

export const BOARD_PATH = "/trade-ups";

const OWNED = ["type", "min_chance", "max_cost", "min_profit", "skin", "sort", "order", "q"] as const;

const SORT_KEYS = new Set(BOARD_SORTS.map(([value]) => value));
const SORT_ALIASES: Record<string, string> = {
  score: "trade_up_score",
  profit_cents: "profit",
  roi_percentage: "roi",
  chance_to_profit: "chance",
  total_cost_cents: "cost",
  created_at: "created",
  newest: "created",
};
const TYPE_KEYS = new Set<string>(BOARD_TYPES);

/** Dollars the cost / profit fields will accept. Above this the value is dropped. */
const MAX_DOLLARS = 100_000;

export interface BoardUrlState {
  query: BoardQuery;
  text: string;
}

export function emptyBoardUrlState(): BoardUrlState {
  return { query: { ...DEFAULT_QUERY }, text: "" };
}

function clampChance(raw: string): string {
  const value = Number(raw);
  if (!Number.isFinite(value)) return "";
  const clamped = Math.min(100, Math.max(0, Math.round(value)));
  return clamped === 0 ? "" : String(clamped);
}

function dollarsFromCents(raw: string): string {
  const cents = Number(raw);
  if (!Number.isFinite(cents)) return "";
  const dollars = Math.round(cents) / 100;
  if (dollars <= 0 || dollars > MAX_DOLLARS) return "";
  return String(dollars);
}

function centsFromDollars(raw: string): string {
  const dollars = Number(raw);
  if (!Number.isFinite(dollars) || dollars <= 0 || dollars > MAX_DOLLARS) return "";
  return String(Math.round(dollars * 100));
}

function sortKey(raw: string): string {
  if (SORT_KEYS.has(raw)) return raw;
  return SORT_ALIASES[raw] ?? DEFAULT_QUERY.sort;
}

/** Query string → board controls. Invalid values are dropped; out-of-range chance is clamped. */
export function stateFromBoardSearch(search: string): BoardUrlState {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const query: BoardQuery = { ...DEFAULT_QUERY };
  const type = params.get("type");
  if (type && TYPE_KEYS.has(type)) query.type = type;
  const skin = params.get("skin");
  if (skin && skin.trim()) query.skin = skin.trim().slice(0, 200);
  const minChance = params.get("min_chance");
  if (minChance) query.minChance = clampChance(minChance);
  const maxCost = params.get("max_cost");
  if (maxCost) query.maxCost = dollarsFromCents(maxCost);
  const minProfit = params.get("min_profit");
  if (minProfit) query.minProfit = dollarsFromCents(minProfit);
  const sort = params.get("sort");
  if (sort) query.sort = sortKey(sort);
  const order = params.get("order");
  if (order === "asc" || order === "desc") query.order = order;
  const text = (params.get("q") ?? "").trim().slice(0, 200);
  return { query, text };
}

/** Board controls → query string. Defaults and unknown keys we do not own are omitted from the owned set. */
export function boardSearchFromState(state: BoardUrlState, currentSearch = ""): string {
  const params = new URLSearchParams(currentSearch.startsWith("?") ? currentSearch.slice(1) : currentSearch);
  for (const key of OWNED) params.delete(key);
  const { query, text } = state;
  if (query.type && TYPE_KEYS.has(query.type)) params.set("type", query.type);
  if (query.skin.trim()) params.set("skin", query.skin.trim());
  const chance = clampChance(query.minChance);
  if (chance) params.set("min_chance", chance);
  const maxCost = centsFromDollars(query.maxCost);
  if (maxCost) params.set("max_cost", maxCost);
  const minProfit = centsFromDollars(query.minProfit);
  if (minProfit) params.set("min_profit", minProfit);
  const sort = sortKey(query.sort);
  if (sort !== DEFAULT_QUERY.sort) params.set("sort", sort);
  if (query.order === "asc") params.set("order", "asc");
  if (text.trim()) params.set("q", text.trim());
  return params.toString();
}

/** Search string after clamp, alias, and param-order normalization. Unknown keys stay. */
export function canonicalBoardSearch(current: string): string {
  return boardSearchFromState(stateFromBoardSearch(current), current);
}

export interface HistoryLike {
  state: unknown;
  replaceState: (data: unknown, unused: string, url?: string | URL | null) => void;
  pushState?: (data: unknown, unused: string, url?: string | URL | null) => void;
}

export interface LocationLike {
  pathname: string;
  search: string;
}

/** Board, a collection, or a skin page — the surfaces whose filters live in the query string. */
export function isBoardFilterPath(pathname: string): boolean {
  if (pathname === BOARD_PATH) return true;
  if (/^\/collections\/[^/]+$/.test(pathname)) return true;
  if (/^\/skins\/[^/]+$/.test(pathname)) return true;
  return false;
}

/** Fields a person types into. Keystrokes in one of these share a single history entry. */
const TYPING_PARAMS = new Set(["min_chance", "max_cost", "min_profit", "skin", "q"]);

export function searchString(search: string): string {
  return search.startsWith("?") ? search.slice(1) : search;
}

/** The one owned param that differs, or null when several (or none) changed. */
export function soleChangedParam(current: string, next: string): string | null {
  const before = new URLSearchParams(searchString(current));
  const after = new URLSearchParams(searchString(next));
  const keys = new Set([...before.keys(), ...after.keys()]);
  let changed: string | null = null;
  for (const key of keys) {
    if (before.get(key) === after.get(key)) continue;
    if (changed) return null;
    changed = key;
  }
  return changed;
}

export function historyAction(
  openField: string | null,
  current: string,
  next: string,
): { action: "push" | "replace"; field: string | null } {
  const changed = soleChangedParam(current, next);
  if (changed && TYPING_PARAMS.has(changed) && changed === openField) {
    return { action: "replace", field: changed };
  }
  if (changed && TYPING_PARAMS.has(changed)) {
    return { action: "push", field: changed };
  }
  return { action: "push", field: null };
}

function writeBoardUrl(
  state: BoardUrlState,
  location: LocationLike,
  history: HistoryLike,
  action: "push" | "replace",
): void {
  if (!isBoardFilterPath(location.pathname)) return;
  const next = boardSearchFromState(state, location.search);
  const current = searchString(location.search);
  if (next === current) return;
  const url = next ? `${location.pathname}?${next}` : location.pathname;
  if (action === "push" && history.pushState) history.pushState(history.state, "", url);
  else history.replaceState(history.state, "", url);
}

/** Replace the current history entry. No-op off a filter path and when the query is already current. */
export function replaceBoardUrl(
  state: BoardUrlState,
  location: LocationLike,
  history: HistoryLike,
): void {
  writeBoardUrl(state, location, history, "replace");
}

/** Push a history entry for a committed filter change. */
export function pushBoardUrl(
  state: BoardUrlState,
  location: LocationLike,
  history: HistoryLike,
): void {
  writeBoardUrl(state, location, history, "push");
}

export function readBoardLocation(location: LocationLike | null | undefined): BoardUrlState {
  if (!location || !isBoardFilterPath(location.pathname)) return emptyBoardUrlState();
  return stateFromBoardSearch(location.search);
}
