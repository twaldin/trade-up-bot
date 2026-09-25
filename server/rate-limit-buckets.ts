/**
 * The shared 120/min bucket covers /api and /auth. Cacheable reads (face art,
 * stats) used to spend that budget beside every board page. They have their
 * own bucket. /auth 10/min, /api/subscribe 5/min, and claim/verify limits stay
 * on their existing limiters.
 */

export const SHARED_API_MAX = 120;
export const CACHEABLE_READ_MAX = 600;
export const RATE_WINDOW_MS = 60_000;

export function isCacheableRead(path: string): boolean {
  return path === "/api/preview/faces"
    || path.startsWith("/api/preview/faces/")
    || path === "/api/global-stats"
    || path.startsWith("/api/global-stats/")
    || path === "/api/outcome-stats"
    || path.startsWith("/api/outcome-stats/");
}

/** True when the request should consume the shared 120/min API bucket. */
export function usesSharedApiBucket(path: string): boolean {
  if (isCacheableRead(path)) return false;
  return path.startsWith("/api") || path.startsWith("/auth");
}
