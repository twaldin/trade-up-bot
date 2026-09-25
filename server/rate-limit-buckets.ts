/**
 * The shared 120/min bucket covers /api and /auth. Cacheable reads (face art,
 * stats) used to spend that budget beside every board page. They have their
 * own bucket. /auth 10/min, /api/subscribe 5/min, and claim/verify limits stay
 * on their existing limiters.
 */

export const SHARED_API_MAX = 120;
export const CACHEABLE_READ_MAX = 600;
export const RATE_WINDOW_MS = 60_000;

/** GET and HEAD on the face and stats paths. Any other method stays on the shared bucket. */
export function isCacheableRead(path: string, method = "GET"): boolean {
  const verb = method.toUpperCase();
  if (verb !== "GET" && verb !== "HEAD") return false;
  return path === "/api/preview/faces"
    || path.startsWith("/api/preview/faces/")
    || path === "/api/global-stats"
    || path.startsWith("/api/global-stats/")
    || path === "/api/outcome-stats"
    || path.startsWith("/api/outcome-stats/");
}

/** True when the request should consume the shared 120/min API bucket. */
export function usesSharedApiBucket(path: string, method = "GET"): boolean {
  if (isCacheableRead(path, method)) return false;
  return path.startsWith("/api") || path.startsWith("/auth");
}
