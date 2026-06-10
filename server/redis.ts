/**
 * Redis cache layer — provides sub-millisecond reads for API routes.
 * Falls back gracefully to in-memory storage if Redis is unavailable.
 */

import Redis from "ioredis";
import type { Request, Response, NextFunction } from "express";

let _redis: Redis | null = null;
let _available = false;

/** Initialize Redis connection. Non-blocking — API works without Redis. */
export function initRedis(): void {
  try {
    _redis = new Redis({
      host: "127.0.0.1",
      port: 6379,
      maxRetriesPerRequest: 1,
      retryStrategy(times) {
        if (times > 3) return null; // stop retrying
        return Math.min(times * 500, 3000);
      },
      lazyConnect: true,
    });

    _redis.on("connect", () => {
      _available = true;
      console.log("Redis connected");
    });
    _redis.on("error", () => {
      _available = false;
    });
    _redis.on("close", () => {
      _available = false;
    });

    _redis.connect().catch(() => {
      console.log("Redis not available — using SQLite-only mode");
      _available = false;
    });
  } catch {
    console.log("Redis init failed — using SQLite-only mode");
  }
}

export function getRedis(): Redis | null {
  return _available ? _redis : null;
}

export function isRedisAvailable(): boolean {
  return _available;
}

/** Get a cached value from Redis. Returns null on miss or if Redis is down. */
export async function cacheGet<T = unknown>(key: string): Promise<T | null> {
  if (!_available || !_redis) return null;
  try {
    const raw = await _redis.get(key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Store a value in Redis with TTL (seconds). Non-blocking, fire-and-forget. */
export async function cacheSet(key: string, data: unknown, ttlSeconds: number): Promise<void> {
  if (!_available || !_redis) return;
  try {
    await _redis.set(key, JSON.stringify(data), "EX", ttlSeconds);
  } catch { /* ignore */ }
}

/** Delete keys matching a prefix pattern. Uses SCAN to avoid blocking. */
export async function cacheInvalidatePrefix(prefix: string): Promise<number> {
  if (!_available || !_redis) return 0;
  try {
    let cursor = "0";
    let total = 0;
    do {
      const [nextCursor, keys] = await _redis.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        total += await _redis.del(...keys);
      }
    } while (cursor !== "0");
    return total;
  } catch (e) {
    console.error("Cache invalidation failed:", e instanceof Error ? e.message : e);
  }
  return 0;
}

/** In-memory rate limit fallback when Redis is unavailable */
const _memRateLimits = new Map<string, { count: number; expiresAt: number }>();

/** Rate limit check: increment counter, reject if over limit. Returns usage info. */
export async function checkRateLimit(
  userId: string, action: string, maxCount: number, windowSeconds: number = 3600
): Promise<{ allowed: boolean; remaining: number; total: number; resetIn: number | null }> {
  // Try Redis first
  if (_available && _redis) {
    try {
      const key = `rate:${action}:${userId}`;
      const count = await _redis.incr(key);
      if (count === 1) await _redis.expire(key, windowSeconds);
      const ttl = await _redis.ttl(key);

      if (count > maxCount) {
        await _redis.decr(key);
        return { allowed: false, remaining: 0, total: maxCount, resetIn: ttl > 0 ? ttl : windowSeconds };
      }
      return { allowed: true, remaining: maxCount - count, total: maxCount, resetIn: ttl > 0 ? ttl : null };
    } catch { /* fall through to in-memory */ }
  }

  // In-memory fallback — prevents bypass when Redis is down
  const memKey = `${action}:${userId}`;
  const now = Date.now();
  const entry = _memRateLimits.get(memKey);
  if (!entry || now >= entry.expiresAt) {
    _memRateLimits.set(memKey, { count: 1, expiresAt: now + windowSeconds * 1000 });
    return { allowed: true, remaining: maxCount - 1, total: maxCount, resetIn: windowSeconds };
  }
  entry.count++;
  if (entry.count > maxCount) {
    entry.count--; // undo
    const resetIn = Math.ceil((entry.expiresAt - now) / 1000);
    return { allowed: false, remaining: 0, total: maxCount, resetIn };
  }
  const resetIn = Math.ceil((entry.expiresAt - now) / 1000);
  return { allowed: true, remaining: maxCount - entry.count, total: maxCount, resetIn };
}

/** Get current rate limit usage without incrementing. */
export async function getRateLimit(
  userId: string, action: string, maxCount: number
): Promise<{ remaining: number; total: number; resetIn: number | null }> {
  if (!_available || !_redis) return { remaining: maxCount, total: maxCount, resetIn: null };
  try {
    const key = `rate:${action}:${userId}`;
    const count = parseInt(await _redis.get(key) || "0");
    const ttl = await _redis.ttl(key);
    return { remaining: Math.max(0, maxCount - count), total: maxCount, resetIn: ttl > 0 ? ttl : null };
  } catch {
    return { remaining: maxCount, total: maxCount, resetIn: null };
  }
}

/** Get the daemon cycle version (timestamp of last_calculation). */
export async function getCycleVersion(): Promise<string> {
  if (!_available || !_redis) return "";
  try {
    return (await _redis.get("cycle_version")) ?? "";
  } catch {
    return "";
  }
}

/** Set the daemon cycle version. Called by daemon after each cycle. */
export async function setCycleVersion(version: string): Promise<void> {
  if (!_available || !_redis) return;
  try {
    await _redis.set("cycle_version", version);
  } catch { /* ignore */ }
}

/**
 * Module-level map of in-flight handler executions keyed by cache key.
 * Followers await the leader's promise; on failure the leader resolves with null
 * so followers fall through and run the handler independently.
 */
const _pending = new Map<string, Promise<string | null>>();

/** Create a manually-resolved promise pair. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * Express middleware that caches route responses in Redis.
 *
 * Usage:
 *   router.get("/api/foo", cachedRoute("foo", 60, (req, res) => { ... res.json(data) }))
 *
 * The keyFn receives the request and returns the cache key (or null to skip caching).
 * The handler should call res.json() as normal — the middleware intercepts the response.
 *
 * Single-flight coalescing: concurrent requests for the same key that all miss
 * the cache will share one handler execution. Followers receive the same JSON
 * string the leader produced (X-Cache: COALESCED). A leader that fails (throws
 * or returns without calling res.json) resolves its deferred with null — followers
 * then fall through and run the handler independently. The pending entry is always
 * deleted in the leader's finally block.
 */
export function cachedRoute(
  keyFn: string | ((req: Request) => string | null),
  ttlSeconds: number,
  handler: (req: Request, res: Response, next: NextFunction) => void | Promise<void>,
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = typeof keyFn === "string" ? keyFn : keyFn(req);

    // No key → no caching and no coalescing (e.g. keyFn returned null)
    if (!key) {
      return handler(req, res, next);
    }

    // Check Redis cache (only when Redis is up)
    if (_available && _redis) {
      try {
        const cached = await _redis.get(key);
        if (cached !== null) {
          res.setHeader("X-Cache", "HIT");
          res.setHeader("Content-Type", "application/json");
          res.send(cached); // send raw string, skip re-serialization
          return;
        }
      } catch { /* Redis error — fall through to single-flight path */ }
    }

    // Single-flight: check if another request is already executing the handler
    const inflight = _pending.get(key);
    if (inflight !== undefined) {
      // Follower — wait for the leader to finish
      const raw = await inflight;
      if (raw !== null) {
        // Leader succeeded — serve its result
        res.setHeader("X-Cache", "COALESCED");
        res.setHeader("Content-Type", "application/json");
        res.send(raw);
        return;
      }
      // Leader failed — fall through and run the handler independently
      try {
        return await handler(req, res, next);
      } catch (err) {
        next(err);
      }
      return;
    }

    // Leader — become the in-flight entry for this key
    const { promise, resolve } = deferred<string | null>();
    _pending.set(key, promise);
    let resolved = false;

    // Intercept res.json to capture the response and resolve the deferred
    const originalJson = res.json.bind(res);
    res.json = function (data: unknown) {
      const statusCode = res.statusCode;
      res.setHeader("X-Cache", "MISS");
      if (statusCode < 300) {
        // 2xx: store in Redis and resolve waiters with the raw JSON string
        const raw = JSON.stringify(data);
        if (_available && _redis) {
          _redis.set(key, raw, "EX", ttlSeconds).catch(() => {});
        }
        resolved = true;
        resolve(raw);
      } else {
        // Non-2xx: skip Redis and resolve with null so followers run independently
        resolved = true;
        resolve(null);
      }
      return originalJson(data);
    } as typeof res.json;

    try {
      return await handler(req, res, next);
    } catch (err) {
      next(err);
    } finally {
      // Always clean up the pending entry; resolve with null if handler never
      // called res.json (error path) so followers don't hang.
      if (!resolved) {
        resolve(null);
      }
      _pending.delete(key);
    }
  };
}
