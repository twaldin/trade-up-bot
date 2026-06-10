# Plan 018: cachedRoute — never cache or coalesce non-2xx responses

> **Executor instructions**: Follow step by step with verification. STOP conditions binding. Reviewer maintains plans/README.md.
>
> **Drift check (run first)**: `git diff --stat 5fbb497..HEAD -- server/redis.ts tests/unit/cached-route.test.ts`
> On drift, compare excerpts; mismatch = STOP.

## Status

- **Priority**: P3 — **Effort**: S — **Risk**: LOW — **Depends on**: 006 (DONE) — **Category**: bug/perf
- **Planned at**: commit `5fbb497`, 2026-06-10

## Why this matters

Plan 006's adversarial reviewer found (recorded in plans/README.md investigate list): `cachedRoute` (server/redis.ts) captures whatever the handler passes to `res.json()` — **including error bodies**. A 404/400/500 JSON body gets (a) written to Redis and replayed to subsequent requests as status **200** with `X-Cache: HIT`, and (b) handed to coalesced followers as 200 via `X-Cache: COALESCED`. Several cached handlers do `res.status(404).json(...)` (e.g. server/routes/trade-ups.ts detail/inputs/outcomes endpoints, server/routes/data.ts). A transient error can therefore poison a cache key for its whole TTL and lie about the status code.

## Current state

- `server/redis.ts` `cachedRoute` (post-plan-006 shape): res.json interceptor sets `X-Cache: MISS`, stores `JSON.stringify(data)` to Redis fire-and-forget, resolves the single-flight deferred with the raw string; HIT path replays raw string with implicit 200; followers replay leader's string with implicit 200.
- Existing tests: `tests/unit/cached-route.test.ts` (3 tests: concurrent dedupe, sequential non-dedupe, error-handler propagation) — express + supertest, Redis down in unit env.
- Conventions: TDD mandatory; no `as any`.

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Typecheck / Target test / Unit | `npm run typecheck` / `npx vitest run tests/unit/cached-route.test.ts` / `npm run test:unit` | all green |

Build once before full test:unit (dist/ dependency).

## Scope

**In scope**: `server/redis.ts` (cachedRoute only), `tests/unit/cached-route.test.ts`.
**Out of scope**: route handlers; checkRateLimit etc.; changing HIT replay status for ALREADY-cached entries (they expire by TTL — no migration needed).

## Steps

### Step 1: Failing tests first

Add to tests/unit/cached-route.test.ts:
1. Handler responds `res.status(404).json({error:"x"})`; 3 concurrent requests → ALL receive 404 (followers must not get 200); a SUBSEQUENT request re-runs the handler (nothing cached/coalesced-poisoned). (With Redis down the cache half can't be asserted directly — assert via call count + statuses.)
2. Handler responds 200 → existing behavior intact (already covered; keep green).
Run: new test must FAIL against current code (followers currently get 200).

### Step 2: Implement

In the res.json interceptor, capture `res.statusCode` at call time. If `statusCode >= 300`: skip the Redis `set`, and resolve the single-flight deferred with `null` (followers fall through and run the handler themselves — same as the existing leader-failure semantics). Keep `X-Cache: MISS` header behavior as-is for the leader.

**Verify**: new tests green; all prior cached-route tests green; `npm run typecheck` exit 0; `npm run test:unit` full green.

## Done criteria

- [ ] Non-2xx responses are never stored in Redis nor replayed to followers
- [ ] 404-follower test green; prior 3 tests green; typecheck + unit suite green
- [ ] Only in-scope files modified

## STOP conditions

- `res.statusCode` is unreliable at json-time for some handler pattern in this repo (e.g. status set after json) — survey `grep -rn "status(.*).json\|json(.*).status" server/routes/ | head` first; report if the order is inconsistent.

## Maintenance notes

- Previously-cached error bodies expire naturally (TTLs ≤ 1800s) — no flush required.
- If a route someday WANTS negative caching (cache 404s briefly), add an explicit opt-in rather than reverting this.
