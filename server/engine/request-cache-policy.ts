import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Stale-while-revalidate is opt-in per request. The calculator route enters
 * this scope. Daemon, repricer, and discovery callers never do, so their
 * cache reads keep blocking until a rebuild finishes.
 */
const requestCachePolicy = new AsyncLocalStorage<{ serveStale: true }>();

export function runWithRequestCachePolicy<T>(fn: () => Promise<T>): Promise<T> {
  return requestCachePolicy.run({ serveStale: true }, fn);
}

export function requestCacheServesStale(): boolean {
  return requestCachePolicy.getStore()?.serveStale === true;
}

export type StaleDecision = "fresh" | "serve-stale" | "block";

/** Fresh cache, serve-stale, or block (cold start or past the staleness cap). */
export function staleDecision(args: {
  size: number;
  ageMs: number;
  ttlMs: number;
  maxStaleMs: number;
  allowStale: boolean;
}): StaleDecision {
  if (args.size > 0 && args.ageMs < args.ttlMs) return "fresh";
  if (args.allowStale && args.size > 0 && args.ageMs < args.maxStaleMs) return "serve-stale";
  return "block";
}
