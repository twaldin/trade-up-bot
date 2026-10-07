import { LIST_TOTAL_CAP } from "./page-fetch.js";

/**
 * Homepage hero counts. Only real fetched numbers — never a baked 0.
 * Board totals come from `/api/trade-ups` (same payload the console board
 * reads). That list stops at 10,001, so a total at the cap is not a count.
 * Data-point and cycle counts come from `/api/global-stats` when those
 * values are already known. A missing or zero count is omitted.
 */

export interface LandingStatCounts {
  total_trade_ups?: number;
  profitable_trade_ups?: number;
  /** Active, non-theoretical rows. The hero tiles use these, matching /trade-ups meta. */
  active_trade_ups?: number;
  active_profitable_trade_ups?: number;
  total_data_points?: number;
  total_cycles?: number;
}

export interface BoardCountSource {
  total?: number;
  total_profitable?: number;
  trade_ups?: readonly unknown[];
  /**
   * True when `total` is the deduped rows this board can show, not the number
   * of trade-ups tracked. That count must not fill in for global stats.
   */
  deduped?: boolean;
  /** True when `total_profitable` stopped at 10001. Absent means false. */
  total_profitable_capped?: boolean;
}

export const LANDING_STAT_LABELS = {
  total_trade_ups: "trade-ups",
  profitable_trade_ups: "positive EV",
  total_data_points: "data points",
  total_cycles: "cycles analyzed",
} as const;

export type LandingStatKey = keyof typeof LANDING_STAT_LABELS;

export interface LandingStatTile {
  key: LandingStatKey;
  label: (typeof LANDING_STAT_LABELS)[LandingStatKey];
  value: number;
}

const STAT_KEYS = Object.keys(LANDING_STAT_LABELS) as LandingStatKey[];

export function positiveCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.trunc(value);
}

/** A present number, including 0. Missing, null, and non-numeric stay absent. */
function finiteCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.trunc(value);
}

/** Trade-up totals the hero tiles and the /trade-ups meta description both publish. */
export function publishedTradeUpCounts(stats: LandingStatCounts | null | undefined): {
  total: number;
  profitable: number;
} {
  return {
    total: finiteCount(stats?.active_trade_ups) ?? positiveCount(stats?.total_trade_ups) ?? 0,
    profitable: finiteCount(stats?.active_profitable_trade_ups) ?? positiveCount(stats?.profitable_trade_ups) ?? 0,
  };
}

function cappedListTotal(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && Math.trunc(value) >= LIST_TOTAL_CAP;
}

/** A capped list total is the sentinel 10,001, not the number of trade-ups. */
function heroBoardCounts(board: BoardCountSource | null | undefined): {
  total: number | undefined;
  profitable: number | undefined;
} {
  // A deduped total is how many rows this list kept, not how many trade-ups are tracked.
  if (!board || board.deduped === true || cappedListTotal(board.total)) {
    return { total: undefined, profitable: undefined };
  }
  const rows = board.trade_ups;
  return {
    total: positiveCount(board.total)
      ?? (Array.isArray(rows) && rows.length > 0 ? rows.length : undefined),
    profitable: positiveCount(board.total_profitable),
  };
}

export function landingStatsFromSources(sources: {
  board?: BoardCountSource | null;
  global?: LandingStatCounts | null;
}): LandingStatCounts {
  const board = heroBoardCounts(sources.board);
  const activeTotal = finiteCount(sources.global?.active_trade_ups);
  const activeProfitable = finiteCount(sources.global?.active_profitable_trade_ups);
  return {
    total_trade_ups: activeTotal
      ?? positiveCount(sources.global?.total_trade_ups)
      ?? board.total,
    profitable_trade_ups: activeProfitable
      ?? positiveCount(sources.global?.profitable_trade_ups)
      ?? board.profitable,
    total_data_points: positiveCount(sources.global?.total_data_points),
    total_cycles: positiveCount(sources.global?.total_cycles),
  };
}

/** Keep a server-rendered count when a later global-stats response has nothing to show. */
export function nextHeroGlobal(
  current: LandingStatCounts | null,
  fetched: LandingStatCounts | null,
): LandingStatCounts | null {
  if (fetched && visibleLandingStatTiles(landingStatsFromSources({ global: fetched })).length > 0) {
    return fetched;
  }
  return current;
}

export function visibleLandingStatTiles(
  stats: LandingStatCounts | null | undefined,
): LandingStatTile[] {
  if (!stats) return [];
  const tiles: LandingStatTile[] = [];
  for (const key of STAT_KEYS) {
    const value = positiveCount(stats[key]);
    if (value === undefined) continue;
    tiles.push({ key, label: LANDING_STAT_LABELS[key], value });
  }
  return tiles;
}

export function formatLandingStat(value: number): string {
  return value.toLocaleString("en-US");
}

/** Neutral mark while the real count is still unknown. Not a number. */
export const LANDING_STAT_PLACEHOLDER = "—";

export function landingStatPlaceholderTiles(): Array<{ key: LandingStatKey; label: string }> {
  return STAT_KEYS.map((key) => ({ key, label: LANDING_STAT_LABELS[key] }));
}

const COUNT_KEYS = [
  "total_trade_ups",
  "profitable_trade_ups",
  "active_trade_ups",
  "active_profitable_trade_ups",
  "total_data_points",
  "total_cycles",
] as const;

type CountKey = (typeof COUNT_KEYS)[number];

function assignCount(stats: LandingStatCounts, key: CountKey, value: number): void {
  switch (key) {
    case "total_trade_ups":
      stats.total_trade_ups = value;
      return;
    case "profitable_trade_ups":
      stats.profitable_trade_ups = value;
      return;
    case "active_trade_ups":
      stats.active_trade_ups = value;
      return;
    case "active_profitable_trade_ups":
      stats.active_profitable_trade_ups = value;
      return;
    case "total_data_points":
      stats.total_data_points = value;
      return;
    case "total_cycles":
      stats.total_cycles = value;
      return;
    default: {
      const neverKey: never = key;
      throw new Error(neverKey);
    }
  }
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function publishedPayload(stats: LandingStatCounts): LandingStatCounts {
  const payload: LandingStatCounts = {};
  for (const tile of visibleLandingStatTiles(stats)) {
    switch (tile.key) {
      case "total_trade_ups":
        payload.total_trade_ups = tile.value;
        break;
      case "profitable_trade_ups":
        payload.profitable_trade_ups = tile.value;
        break;
      case "total_data_points":
        payload.total_data_points = tile.value;
        break;
      case "total_cycles":
        payload.total_cycles = tile.value;
        break;
      default: {
        const neverKey: never = tile.key;
        throw new Error(neverKey);
      }
    }
  }
  return payload;
}

export function landingStatsFromJson(raw: string): LandingStatCounts | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const stats: LandingStatCounts = {};
  for (const key of COUNT_KEYS) {
    const value: unknown = Reflect.get(parsed, key);
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    assignCount(stats, key, Math.trunc(value));
  }
  if (visibleLandingStatTiles(landingStatsFromSources({ global: stats })).length === 0) return null;
  return stats;
}

/** Read the count embedded in server-rendered hero HTML. */
export function landingStatsFromMarkup(html: string): LandingStatCounts | null {
  const match = /data-landing-stats="([^"]*)"/.exec(html);
  if (!match?.[1]) return null;
  const raw = match[1].replace(/&quot;/g, "\"").replace(/&amp;/g, "&");
  return landingStatsFromJson(raw);
}

let capturedServerLandingStats: LandingStatCounts | null = null;

/** Call with `#root` innerHTML before React replaces it. */
export function captureServerLandingStats(html: string): void {
  capturedServerLandingStats = landingStatsFromMarkup(html);
}

export function serverLandingStats(): LandingStatCounts | null {
  return capturedServerLandingStats;
}

export function renderLandingStatsHtml(
  stats: LandingStatCounts | null | undefined,
  className = "preview-stats",
): string {
  const tiles = visibleLandingStatTiles(stats);
  if (tiles.length === 0) return "";
  const inner = tiles
    .map((tile) => `<div><b>${formatLandingStat(tile.value)}</b><span>${tile.label}</span></div>`)
    .join("");
  const payload = escapeAttr(JSON.stringify(publishedPayload(stats ?? {})));
  return `<div class="${className}" data-landing-stats="${payload}">${inner}</div>`;
}

function findClassDiv(html: string, className: string): { start: number; end: number } | null {
  const classAt = html.indexOf(`class="${className}`);
  if (classAt < 0) return null;
  const start = html.lastIndexOf("<div", classAt);
  if (start < 0 || start > classAt) return null;
  let depth = 0;
  for (let i = start; i < html.length; i++) {
    const next = html[i + 4];
    if (html.startsWith("<div", i) && (next === " " || next === ">")) {
      depth += 1;
      continue;
    }
    if (html.startsWith("</div>", i)) {
      depth -= 1;
      if (depth === 0) return { start, end: i + 6 };
    }
  }
  return null;
}

/** Swap or insert hero tiles. Drops a prerendered zero block when nothing live is known. */
export function injectLandingStats(
  html: string,
  stats: LandingStatCounts | null | undefined,
): string {
  const next = renderLandingStatsHtml(stats);
  const existing = findClassDiv(html, "preview-stats");
  if (existing) return html.slice(0, existing.start) + next + html.slice(existing.end);
  if (!next) return html;
  const toolbar = findClassDiv(html, "preview-toolbar");
  if (toolbar) return html.slice(0, toolbar.end) + next + html.slice(toolbar.end);
  return html;
}
