/**
 * After `tu:` is flushed, the next anon visitor otherwise pays the full
 * diversified ranking (several seconds). Rebuild the public first pages in
 * one flight so that visitor hits cache, and rebuild again if another flush
 * lands mid-warm so a ranking is never older than the latest clear.
 */

export const PUBLIC_BOARD_SORTS = ["trade_up_score", "profit", "roi", "cost", "chance", "created"] as const;

/** 1s, 2s, 4s, … capped at 60s. */
export function boardWarmBackoffMs(failure: number): number {
  const shift = Math.max(0, Math.min(failure - 1, 6));
  return Math.min(60_000, 1000 * 2 ** shift);
}

const BOARD_INCLUDE = "outcomes,inputs";

/** First page of each public sort, plus the homepage teaser (per_page=3). */
export function publicBoardWarmPaths(): string[] {
  const paths = PUBLIC_BOARD_SORTS.map(
    (sort) => `/api/trade-ups?per_page=12&sort=${sort}&order=desc&page=1&include=${BOARD_INCLUDE}`,
  );
  paths.push(`/api/trade-ups?per_page=3&sort=trade_up_score&order=desc&page=1&include=${BOARD_INCLUDE}`);
  return paths;
}

export function clearsTradeUpLists(prefix: string): boolean {
  return prefix.startsWith("tu:");
}

type Warmer = () => Promise<void>;

let warmer: Warmer | null = null;
let warming = false;
let generation = 0;
let warmedThrough = 0;
let failures = 0;
let delay: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function registerBoardWarmer(fn: Warmer): void {
  warmer = fn;
}

export function setBoardWarmDelayForTests(fn: (ms: number) => Promise<void>): void {
  delay = fn;
}

export function resetBoardWarmerForTests(): void {
  warmer = null;
  warming = false;
  generation = 0;
  warmedThrough = 0;
  failures = 0;
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
}

export function requestBoardWarm(): void {
  generation += 1;
  void pump();
}

async function pump(): Promise<void> {
  if (warming || !warmer) return;
  warming = true;
  try {
    while (warmedThrough < generation) {
      const target = generation;
      try {
        await warmer();
        warmedThrough = target;
        failures = 0;
      } catch {
        failures += 1;
        await delay(boardWarmBackoffMs(failures));
      }
    }
  } finally {
    warming = false;
    if (warmedThrough < generation) void pump();
  }
}
