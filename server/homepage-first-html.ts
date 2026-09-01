/**
 * First HTML for `/` is the prerendered dist/index.html that nginx serves.
 * Node's app.get("/") does not run on tradeupbot.app — rewrite the file
 * nginx actually sends, using real getGlobalStats / public API counts.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import {
  injectLandingStats,
  landingStatsFromSources,
  type BoardCountSource,
  type LandingStatCounts,
} from "../src/preview/lib/landing-stats.js";

const DEFAULT_GLOBAL_URL = "https://tradeupbot.app/api/global-stats";
const DEFAULT_BOARD_URL =
  "https://tradeupbot.app/api/trade-ups?per_page=1&sort=trade_up_score&order=desc&page=1";

export function materializeHomepageFirstHtml(
  html: string,
  stats: LandingStatCounts | null | undefined,
): string {
  return injectLandingStats(html, stats);
}

export function writeHomepageFirstHtmlFile(
  indexPath: string,
  stats: LandingStatCounts | null | undefined,
): boolean {
  if (!existsSync(indexPath)) return false;
  const current = readFileSync(indexPath, "utf-8");
  const next = materializeHomepageFirstHtml(current, stats);
  if (next === current) return false;
  const tmp = `${indexPath}.${process.pid}.tmp`;
  writeFileSync(tmp, next);
  renameSync(tmp, indexPath);
  return true;
}

function readNumber(row: object, key: string): number | undefined {
  const value: unknown = Reflect.get(row, key);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asGlobal(value: unknown): LandingStatCounts | null {
  if (!value || typeof value !== "object") return null;
  return {
    total_trade_ups: readNumber(value, "total_trade_ups"),
    profitable_trade_ups: readNumber(value, "profitable_trade_ups"),
    total_data_points: readNumber(value, "total_data_points"),
    total_cycles: readNumber(value, "total_cycles"),
  };
}

function asBoard(value: unknown): BoardCountSource | null {
  if (!value || typeof value !== "object") return null;
  const tradeUps: unknown = Reflect.get(value, "trade_ups");
  return {
    total: readNumber(value, "total"),
    total_profitable: readNumber(value, "total_profitable"),
    trade_ups: Array.isArray(tradeUps) ? tradeUps : undefined,
  };
}

async function readJson(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<unknown> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) return null;
  return res.json();
}

export async function fetchLiveHomepageStats(opts: {
  globalUrl?: string;
  boardUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
} = {}): Promise<LandingStatCounts> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 5000;
  const globalUrl = opts.globalUrl ?? process.env.HOMEPAGE_STATS_URL ?? DEFAULT_GLOBAL_URL;
  const boardUrl = opts.boardUrl ?? process.env.HOMEPAGE_BOARD_URL ?? DEFAULT_BOARD_URL;

  let global: LandingStatCounts | null = null;
  let board: BoardCountSource | null = null;
  const [globalResult, boardResult] = await Promise.allSettled([
    readJson(globalUrl, fetchImpl, timeoutMs),
    readJson(boardUrl, fetchImpl, timeoutMs),
  ]);
  if (globalResult.status === "fulfilled") global = asGlobal(globalResult.value);
  if (boardResult.status === "fulfilled") board = asBoard(boardResult.value);
  return landingStatsFromSources({ global, board });
}
