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

/** Daemon and API processes publish this after a `tu:` delete. The API is the only subscriber. */
export const BOARD_FLUSH_CHANNEL = "tu:flushed";

/** Collapse a burst of flushes into one warm. The pump still backs off if that warm throws. */
const FLUSH_DEBOUNCE_MS = 250;

type FlushPublisher = {
  publish(channel: string, message: string): Promise<number>;
};

type FlushSubscriber = {
  subscribe(channel: string): Promise<unknown>;
  on(event: "message", cb: (channel: string, message: string) => void): void;
  on(event: "ready", cb: () => void): void;
};

let flushDebounceMs = FLUSH_DEBOUNCE_MS;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

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

export function setBoardFlushDebounceForTests(ms: number): void {
  flushDebounceMs = ms;
}

export function resetBoardWarmerForTests(): void {
  warmer = null;
  warming = false;
  generation = 0;
  warmedThrough = 0;
  failures = 0;
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  flushDebounceMs = FLUSH_DEBOUNCE_MS;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
}

/** First-page warm when the API process starts listening, before any daemon flush. */
export function warmPublicBoardOnStartup(): void {
  requestBoardWarm();
}

function scheduleBoardWarmFromFlush(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    requestBoardWarm();
  }, flushDebounceMs);
}

/** API side of a daemon (or local) `tu:` flush. Other channels are ignored. */
export function handleBoardFlushMessage(channel: string): void {
  if (channel !== BOARD_FLUSH_CHANNEL) return;
  scheduleBoardWarmFromFlush();
}

/** Publish after the `tu:*` keys are gone so the warm cannot refill a key the delete then removes. */
export async function notifyBoardListFlushed(redis: FlushPublisher | null): Promise<void> {
  if (!redis) return;
  await redis.publish(BOARD_FLUSH_CHANNEL, "1").catch(() => undefined);
}

/**
 * Separate subscriber connection. `ready` fires on the first connect and on
 * every reconnect, so the channel is subscribed again after Redis comes back.
 */
export function bindBoardFlushSubscriber(sub: FlushSubscriber): void {
  const subscribe = () => {
    void sub.subscribe(BOARD_FLUSH_CHANNEL).catch(() => undefined);
  };
  sub.on("message", (channel) => {
    handleBoardFlushMessage(channel);
  });
  sub.on("ready", subscribe);
  subscribe();
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
