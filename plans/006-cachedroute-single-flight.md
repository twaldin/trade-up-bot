# Plan 006: Add single-flight coalescing (and optional serve-stale) to cachedRoute

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3d7e65f..HEAD -- server/redis.ts`
> On drift, compare the "Current state" excerpt before proceeding; mismatch = STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW–MED (middleware used by ~15 routes; behavior on the miss path changes)
- **Depends on**: 001
- **Category**: perf
- **Planned at**: commit `3d7e65f`, 2026-06-10

## Why this matters

`cachedRoute` (server/redis.ts:177-218) is the caching middleware for every hot API endpoint (`/api/trade-ups` 30s TTL, `/api/status`, `/api/global-stats`, skin-data 1800s, etc.). On a cache miss it falls straight through to the handler with **no in-flight tracking**: when a hot key's TTL expires under concurrent traffic, every concurrent request executes the same multi-second PG query simultaneously, piling onto the shared 20-connection pool (which the daemon also uses). The startup comment at `server/index.ts:1126` ("so the first user request doesn't wait 8-10s for cold PG queries") describes exactly the cost that recurs at *every* TTL expiry today. Single-flight coalescing makes N concurrent misses cost one handler execution.

## Current state

```ts
// server/redis.ts:177-218 (abridged — read the full function first)
export function cachedRoute(keyFn, ttlSeconds, handler) {
  return async (req, res, next) => {
    const key = typeof keyFn === "string" ? keyFn : keyFn(req);
    if (!key || !_available) return handler(req, res, next);
    try {
      const cached = await _redis!.get(key);
      if (cached !== null) {
        res.setHeader("X-Cache", "HIT");
        res.setHeader("Content-Type", "application/json");
        res.send(cached);
        return;
      }
    } catch { }
    const originalJson = res.json.bind(res);
    res.json = function (data: unknown) {
      res.setHeader("X-Cache", "MISS");
      if (_available && _redis) {
        const raw = JSON.stringify(data);
        _redis.set(key, raw, "EX", ttlSeconds).catch(() => {});
      }
      return originalJson(data);
    } as typeof res.json;
    try { return await handler(req, res, next); } catch (err) { next(err); }
  };
}
```

Conventions: TypeScript ESM, no `as any`/`as unknown as` casts, async pg Pool, Redis ops awaited before responses. Tests: vitest; `supertest` is available in devDependencies for express middleware tests.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Typecheck | `npm run typecheck`      | exit 0              |
| New test  | `npx vitest run tests/unit/cached-route.test.ts` | all pass |
| Unit      | `npm run test:unit`      | all pass            |

## Scope

**In scope**:
- `server/redis.ts` (the `cachedRoute` function and a new module-level pending map)
- `tests/unit/cached-route.test.ts` (create)

**Out of scope**:
- Any route registration or handler.
- `checkRateLimit` / other functions in redis.ts.
- HTTP `Cache-Control` headers on API responses — **considered and rejected**: `/api/trade-ups` responses are tier-dependent (free-tier sees delayed data per `server/routes/CLAUDE.md`), so browser-cacheable headers risk cross-tier leakage through shared caches for marginal benefit. Do not add them.

## Git workflow

- Branch: `advisor/006-cachedroute-single-flight`; commit: `perf(server): coalesce concurrent cache-miss executions in cachedRoute`. No Co-Authored-By trailers.

## Steps

### Step 1: Write the failing test (TDD — mandatory in this repo)

Create `tests/unit/cached-route.test.ts` using express + supertest:

- Build an express app with `cachedRoute("test_key", 60, handler)` where `handler` increments a counter, awaits a 100ms delay, then `res.json({ n: 1 })`.
- Redis is unavailable in unit tests (`_available === false`) — **note**: in that state cachedRoute bypasses caching entirely. The coalescing must therefore live in front of the Redis check so it works whether or not Redis is up. Design the test around that: fire 5 concurrent `supertest` GETs, assert all 5 get `{ n: 1 }` and the counter is **1**, not 5.
- Add a second test: sequential requests after the first completes still invoke the handler (when Redis is down there's no cache — counter becomes 2). This pins the semantics: coalescing dedupes only *concurrent* work.

Run it: must FAIL against current code (counter === 5).

**Verify**: `npx vitest run tests/unit/cached-route.test.ts` → failing for the right reason.

### Step 2: Implement single-flight

In `server/redis.ts`, add a module-level `const _pending = new Map<string, Promise<string | null>>();`

Rework `cachedRoute`'s miss path:

1. After the Redis GET misses (or Redis is down but a key exists), check `_pending.get(key)`:
   - If present: `const raw = await pending;` — if `raw !== null`, send it with `X-Cache: COALESCED` (and Content-Type application/json); if `null` (the leader failed or never called res.json), fall through and run the handler directly (no coalescing on failure).
2. If absent: become the leader. Create a promise with an external resolver; store in `_pending`. In the `res.json` interceptor, resolve it with the raw JSON string (in addition to the existing Redis set). In a `finally` around the handler invocation, if it was never resolved (error/early return), resolve with `null`; always `_pending.delete(key)`.
3. Keep every existing behavior identical: `X-Cache: HIT` path untouched, `keyFn` null → no caching, Redis-set fire-and-forget.

Implementation note: use a small helper so no `as any` casts are needed for the resolver:

```ts
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
```

**Verify**: `npx vitest run tests/unit/cached-route.test.ts` → all pass; `npm run typecheck` exit 0; `npm run test:unit` all pass.

### Step 3 (OPTIONAL — only if steps 1–2 were clean): serve-stale-while-revalidate for designated keys

Add an optional fourth parameter `opts?: { staleWhileRevalidate?: boolean }`. When set and Redis holds a value under `key + ":stale"` after the main key expired: send the stale value immediately (`X-Cache: STALE`), and let exactly one background refresh (reuse the single-flight map) repopulate both keys (`set key EX ttl` and `set key:stale EX ttl*10`). Wire it up ONLY for `"status"` and `"global_stats"`-style keys if a route owner is obvious; otherwise implement the mechanism + tests and leave routes opted out, noting it in the report.

**Verify**: new unit test for the stale path; `npm run test:unit` all pass.

## Test plan

- `tests/unit/cached-route.test.ts`: concurrent dedupe (counter === 1), sequential non-dedupe, error propagation (handler throws → all waiters get a non-hung response), optional stale path.
- Model test structure after existing unit tests; fixtures from `tests/helpers/fixtures.ts` are not needed here.

## Done criteria

- [ ] 5 concurrent identical requests execute the handler once (test green)
- [ ] A throwing handler does not hang concurrent waiters (test green)
- [ ] `npm run typecheck` exit 0, `npm run test:unit` all pass
- [ ] No `as any` / `as unknown as` introduced (`grep -n "as any\|as unknown as" server/redis.ts` → no new matches)
- [ ] Only in-scope files modified; `plans/README.md` updated

## STOP conditions

- The res.json interception approach cannot deliver the raw string to waiters without changing any route handler's observable behavior.
- Any existing route test (unit or integration) fails after the change.
- Memory concern: if you find yourself adding TTLs/sweepers for `_pending`, stop — entries must be deleted in `finally`; if that invariant can't hold, report.

## Maintenance notes

- The pending map is per-process; PM2 cluster mode (if ever enabled, see Plan 008 notes) would coalesce per worker — still correct, just less deduplication.
- Reviewers should scrutinize the `finally` cleanup: a leaked pending entry would serve one stale promise forever.
- Plans 005 and 007 reduce the cost of each miss; this plan reduces the *number* of misses. They compose.
