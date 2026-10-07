// Aggregate the free-tier delay gap. Counts and cents come from GET /api/board-delay.
// A missing or malformed payload stays null so callers never invent a figure.
import { formatDollars } from "../src/utils/format.js";

export const BOARD_DELAY_SECONDS = 3 * 60 * 60;

export interface BoardDelayGap {
  hidden_profitable: number;
  best_hidden_profit_cents: number | null;
}

function integer(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
  return null;
}

/** Server row → gap. Unusable counts become a zero gap so the route can still answer. */
export function parseBoardDelayRow(row: unknown): BoardDelayGap {
  const record = row && typeof row === "object" ? row : {};
  const hidden = integer(Reflect.get(record, "hidden_profitable"));
  const best = Reflect.get(record, "best_hidden_profit_cents");
  return {
    hidden_profitable: hidden !== null && hidden >= 0 ? hidden : 0,
    best_hidden_profit_cents: best == null ? null : integer(best),
  };
}

/** Client JSON. Null when the count is missing, so the banner keeps the generic line. */
export function parseBoardDelayPayload(body: unknown): BoardDelayGap | null {
  if (!body || typeof body !== "object") return null;
  const hidden = integer(Reflect.get(body, "hidden_profitable"));
  if (hidden === null || hidden < 0) return null;
  const bestRaw = Reflect.get(body, "best_hidden_profit_cents");
  if (bestRaw != null && integer(bestRaw) === null) return null;
  return {
    hidden_profitable: hidden,
    best_hidden_profit_cents: bestRaw == null ? null : integer(bestRaw),
  };
}

/**
 * Sizing stand-in for the free-tier banner. The live sentence replaces shorter
 * copy inside this box; it is not a count to show on its own.
 */
export function boardDelayReserveSentence(): string {
  return boardDelaySentence({
    hidden_profitable: 999_999,
    best_hidden_profit_cents: 99_999_999,
  }) ?? "";
}

/**
 * One sentence for the free-tier gate. Null while the count is unknown.
 * `hidden_profitable` is active, non-theoretical trade-ups with profit_cents > 0
 * created inside the delay window — the rows the free list query drops.
 */
export function boardDelaySentence(gap: BoardDelayGap | null | undefined): string | null {
  if (!gap) return null;
  if (gap.hidden_profitable === 0) {
    return "No profitable trade-ups are inside the 3-hour window right now.";
  }
  const n = gap.hidden_profitable.toLocaleString("en-US");
  const noun = gap.hidden_profitable === 1 ? "profitable trade-up" : "profitable trade-ups";
  const verb = gap.hidden_profitable === 1 ? "is" : "are";
  const lead = `${n} ${noun} found in the last 3 hours ${verb} hidden on the free board.`;
  const best = gap.best_hidden_profit_cents;
  if (best === null || best <= 0) return lead;
  const money = `+${formatDollars(best)} expected P/L`;
  if (gap.hidden_profitable === 1) return `${lead} It is ${money}.`;
  return `${lead} The best is ${money}.`;
}
