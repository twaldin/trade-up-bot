/**
 * Homepage hero counts. Only real fetched numbers — never a baked 0.
 * Board totals come from `/api/trade-ups` (same payload the console board
 * reads). Data-point and cycle counts come from `/api/global-stats` when
 * those values are already known. A missing or zero count is omitted.
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

/** Trade-up totals the hero tiles and the /trade-ups meta description both publish. */
export function publishedTradeUpCounts(stats: LandingStatCounts | null | undefined): {
  total: number;
  profitable: number;
} {
  return {
    total: positiveCount(stats?.active_trade_ups) ?? positiveCount(stats?.total_trade_ups) ?? 0,
    profitable: positiveCount(stats?.active_profitable_trade_ups) ?? positiveCount(stats?.profitable_trade_ups) ?? 0,
  };
}

export function landingStatsFromSources(sources: {
  board?: BoardCountSource | null;
  global?: LandingStatCounts | null;
}): LandingStatCounts {
  const boardRows = sources.board?.trade_ups;
  const boardTotal = positiveCount(sources.board?.total)
    ?? (Array.isArray(boardRows) && boardRows.length > 0 ? boardRows.length : undefined);
  const boardProfitable = positiveCount(sources.board?.total_profitable);

  const published = publishedTradeUpCounts(sources.global);
  return {
    total_trade_ups: (sources.global?.active_trade_ups != null ? published.total : undefined)
      ?? positiveCount(sources.global?.total_trade_ups)
      ?? boardTotal,
    profitable_trade_ups: (sources.global?.active_profitable_trade_ups != null ? published.profitable : undefined)
      ?? positiveCount(sources.global?.profitable_trade_ups)
      ?? boardProfitable,
    total_data_points: positiveCount(sources.global?.total_data_points),
    total_cycles: positiveCount(sources.global?.total_cycles),
  };
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

export function renderLandingStatsHtml(
  stats: LandingStatCounts | null | undefined,
  className = "preview-stats",
): string {
  const tiles = visibleLandingStatTiles(stats);
  if (tiles.length === 0) return "";
  const inner = tiles
    .map((tile) => `<div><b>${formatLandingStat(tile.value)}</b><span>${tile.label}</span></div>`)
    .join("");
  return `<div class="${className}">${inner}</div>`;
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
