/**
 * One-click ways out of an empty filtered board. Copy and a new filter
 * state only — the list query is unchanged.
 */
import { DEFAULT_QUERY, type BoardQuery } from "../components/PreviewFilters.js";

export interface LoosenSuggestion {
  label: string;
  query: BoardQuery;
  text: string;
}

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
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

/** The single tightest active control, loosened one step. Null when nothing is set. */
export function loosenSuggestion(query: BoardQuery, text: string): LoosenSuggestion | null {
  const scored: { score: number; rank: number; build: () => LoosenSuggestion }[] = [];

  const chance = tightnessChance(query.minChance);
  if (chance > 0) {
    scored.push({
      score: chance,
      rank: 3,
      build: () => {
        const next = Math.max(0, Math.round(Number(query.minChance)) - 20);
        return {
          label: `Lower min chance to ${next}%`,
          query: { ...query, minChance: next === 0 ? "" : String(next) },
          text,
        };
      },
    });
  }

  const cost = tightnessMaxCost(query.maxCost);
  if (cost > 0) {
    scored.push({
      score: cost,
      rank: 2,
      build: () => {
        const raised = money(Number(query.maxCost) * 2);
        return {
          label: `Raise max cost to $${raised}`,
          query: { ...query, maxCost: raised },
          text,
        };
      },
    });
  }

  const profit = tightnessMinProfit(query.minProfit);
  if (profit > 0) {
    scored.push({
      score: profit,
      rank: 1,
      build: () => {
        const lowered = Math.round(Number(query.minProfit) / 2);
        return {
          label: `Lower min profit to $${money(lowered)}`,
          query: { ...query, minProfit: lowered <= 0 ? "" : money(lowered) },
          text,
        };
      },
    });
  }

  if (query.skin.trim()) {
    scored.push({
      score: 0.5,
      rank: 0,
      build: () => ({
        label: "Clear skin",
        query: { ...query, skin: "" },
        text,
      }),
    });
  }

  if (text.trim()) {
    scored.push({
      score: 0.45,
      rank: 0,
      build: () => ({
        label: "Clear search",
        query,
        text: "",
      }),
    });
  }

  if (query.type) {
    scored.push({
      score: 0.4,
      rank: 0,
      build: () => ({
        label: "Clear tier",
        query: { ...query, type: "" },
        text,
      }),
    });
  }

  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score || b.rank - a.rank);
  return scored[0].build();
}

export function clearedBoard(): { query: BoardQuery; text: string } {
  return { query: { ...DEFAULT_QUERY }, text: "" };
}
