/**
 * One-click ways out of an empty filtered board.
 *
 * The tightest control is loosened in a few steps (2× / 5× / 10× cost, or the
 * next chance buckets down). A probe of the existing list API picks the first
 * step that actually returns a row. No new query parameters.
 */
import { DEFAULT_QUERY, boardQueryString, type BoardQuery } from "../components/PreviewFilters.js";
import { chipsToBoardParams, parseQuery } from "./query-parse.js";

export interface LoosenSuggestion {
  label: string;
  query: BoardQuery;
  text: string;
}

export const LOOSEN_PROBE_CAP = 3;
export const LOOSEN_PROBE_DEBOUNCE_MS = 400;

const COST_FACTORS = [2, 5, 10];
const PROFIT_DIVISORS = [2, 5, 10];
const CHANCE_BUCKET = 20;

function tightnessChance(raw: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(100, value) / 100;
}

function tightnessMaxCost(raw: string): number {
  const dollars = Number(raw);
  if (!Number.isFinite(dollars) || dollars <= 0) return 0;
  return 1 - Math.min(dollars, 500) / 500;
}

function tightnessMinProfit(raw: string): number {
  const dollars = Number(raw);
  if (!Number.isFinite(dollars) || dollars <= 0) return 0;
  return Math.min(dollars, 100) / 100;
}

function money(dollars: number): string {
  const rounded = Math.round(dollars * 100) / 100;
  return String(rounded);
}

type Kind = "chance" | "cost" | "profit" | "skin" | "search" | "type";

function tightest(query: BoardQuery, text: string): Kind | null {
  const scored: { kind: Kind; score: number; rank: number }[] = [];
  const chance = tightnessChance(query.minChance);
  if (chance > 0) scored.push({ kind: "chance", score: chance, rank: 3 });
  const cost = tightnessMaxCost(query.maxCost);
  if (cost > 0) scored.push({ kind: "cost", score: cost, rank: 2 });
  const profit = tightnessMinProfit(query.minProfit);
  if (profit > 0) scored.push({ kind: "profit", score: profit, rank: 1 });
  if (query.skin.trim()) scored.push({ kind: "skin", score: 0.5, rank: 0 });
  if (text.trim()) scored.push({ kind: "search", score: 0.45, rank: 0 });
  if (query.type) scored.push({ kind: "type", score: 0.4, rank: 0 });
  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score || b.rank - a.rank);
  return scored[0].kind;
}

function costSteps(query: BoardQuery, text: string): LoosenSuggestion[] {
  const base = Number(query.maxCost);
  return COST_FACTORS.map((factor) => {
    const raised = money(base * factor);
    return {
      label: `Raise max cost to $${raised}`,
      query: { ...query, maxCost: raised },
      text,
    };
  });
}

function chanceSteps(query: BoardQuery, text: string): LoosenSuggestion[] {
  const start = Math.round(Number(query.minChance));
  const steps: LoosenSuggestion[] = [];
  for (let drop = CHANCE_BUCKET; drop <= start && steps.length < LOOSEN_PROBE_CAP; drop += CHANCE_BUCKET) {
    const next = start - drop;
    steps.push({
      label: `Lower min chance to ${next}%`,
      query: { ...query, minChance: next === 0 ? "" : String(next) },
      text,
    });
  }
  return steps;
}

function profitSteps(query: BoardQuery, text: string): LoosenSuggestion[] {
  const base = Number(query.minProfit);
  return PROFIT_DIVISORS.map((divisor) => {
    const lowered = Math.round((base / divisor) * 100) / 100;
    return {
      label: `Lower min profit to $${money(lowered)}`,
      query: { ...query, minProfit: lowered <= 0 ? "" : money(lowered) },
      text,
    };
  });
}

/** Up to three steps for the tightest filter, smallest change first. */
export function loosenCandidates(query: BoardQuery, text: string): LoosenSuggestion[] {
  const kind = tightest(query, text);
  if (!kind) return [];
  if (kind === "cost") return costSteps(query, text).slice(0, LOOSEN_PROBE_CAP);
  if (kind === "chance") return chanceSteps(query, text).slice(0, LOOSEN_PROBE_CAP);
  if (kind === "profit") return profitSteps(query, text).slice(0, LOOSEN_PROBE_CAP);
  if (kind === "skin") return [{ label: "Clear skin", query: { ...query, skin: "" }, text }];
  if (kind === "search") return [{ label: "Clear search", query, text: "" }];
  return [{ label: "Clear tier", query: { ...query, type: "" }, text }];
}

/** List URL for one candidate. `per_page=1` is the existing page size, not a new parameter. */
export function loosenProbePath(
  step: LoosenSuggestion,
  extra: { collection?: string; skin?: string } = {},
): string {
  const params = new URLSearchParams(boardQueryString(step.query, 1));
  const parsed = parseQuery(step.text);
  const semantic = chipsToBoardParams(parsed.chips, parsed.rest);
  for (const [key, value] of Object.entries(semantic)) {
    if (value) params.set(key, value);
  }
  if (extra.collection) params.set("collection", extra.collection);
  if (extra.skin) params.set("skin", extra.skin);
  params.set("page", "1");
  params.set("per_page", "1");
  return `/api/trade-ups?${params}`;
}

export function probeFoundRows(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const record = body as { total?: unknown; trade_ups?: unknown };
  if (typeof record.total === "number" && record.total > 0) return true;
  return Array.isArray(record.trade_ups) && record.trade_ups.length > 0;
}

/**
 * Ask the list, cheapest step first, and stop at the first step with rows.
 * At most `cap` requests. A 429 stops the sequence.
 */
export async function firstReturningStep(
  candidates: readonly LoosenSuggestion[],
  probe: (step: LoosenSuggestion) => Promise<"hit" | "miss" | "stop">,
  cap = LOOSEN_PROBE_CAP,
): Promise<LoosenSuggestion | null> {
  const limited = candidates.slice(0, cap);
  for (const step of limited) {
    const result = await probe(step);
    if (result === "hit") return step;
    if (result === "stop") return null;
  }
  return null;
}

/** Probes wait until the user has stopped changing filters. */
export function probesAllowed(typing: boolean): boolean {
  return !typing;
}
