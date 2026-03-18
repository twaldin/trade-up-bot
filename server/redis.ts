/**
 * Redis cache layer — provides sub-millisecond reads for API routes.
 * Falls back gracefully to SQLite if Redis is unavailable.
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
  let deleted = 0;
  try {
    const stream = _redis.scanStream({ match: `${prefix}*`, count: 100 });
    for await (const keys of stream) {
      if ((keys as string[]).length > 0) {
        deleted += await _redis.del(...(keys as string[]));
      }
    }
  } catch { /* ignore */ }
  return deleted;
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
 * Express middleware that caches route responses in Redis.
 *
 * Usage:
 *   router.get("/api/foo", cachedRoute("foo", 60, (req, res) => { ... res.json(data) }))
 *
 * The keyFn receives the request and returns the cache key (or null to skip caching).
 * The handler should call res.json() as normal — the middleware intercepts the response.
 */
export function cachedRoute(
  keyFn: string | ((req: Request) => string | null),
  ttlSeconds: number,
  handler: (req: Request, res: Response, next: NextFunction) => void | Promise<void>,
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = typeof keyFn === "string" ? keyFn : keyFn(req);
    if (!key || !_available) {
      // No caching — run handler directly
      return handler(req, res, next);
    }

    // Check Redis cache
    try {
      const cached = await _redis!.get(key);
      if (cached !== null) {
        res.setHeader("X-Cache", "HIT");
        res.setHeader("Content-Type", "application/json");
        res.send(cached); // send raw string, skip re-serialization
        return;
      }
    } catch { /* Redis error — fall through to handler */ }

    // Cache miss — intercept res.json to capture the response
    const originalJson = res.json.bind(res);
    res.json = function (data: unknown) {
      res.setHeader("X-Cache", "MISS");
      // Store in Redis (fire-and-forget, don't block response)
      if (_available && _redis) {
        const raw = JSON.stringify(data);
        _redis.set(key, raw, "EX", ttlSeconds).catch(() => {});
      }
      return originalJson(data);
    } as typeof res.json;

    return handler(req, res, next);
  };
}
