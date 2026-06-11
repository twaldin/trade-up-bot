# Plan 020: HOTFIX — RangeError crash loop in scoped KNN loader (spread-push over unbounded rows)

> **Executor instructions**: Follow step by step with verification. STOP conditions binding. Reviewer maintains plans/README.md.
>
> **Drift check (run first)**: `git diff --stat af328e0..HEAD -- server/engine/knn-pricing.ts tests/integration/knn-scoped-loading.test.ts`
> Expected empty (this plan is written at the current tip). Any drift = STOP.

## Status

- **Priority**: P0 (production daemon crash-looping) — **Effort**: S — **Risk**: LOW — **Depends on**: 016 (DONE) — **Category**: bug
- **Planned at**: commit `af328e0`, 2026-06-11

## Why this matters

Production daemon has crash-looped every ~3 minutes since plan 016's deploy (2026-06-10 evening → 2026-06-11, ~270 PM2 restarts observed). Stack trace (from `/root/.pm2/logs/daemon-error.log` on the VPS, repeating verbatim):

```
Daemon crashed: RangeError: Maximum call stack size exceeded
    at loadInputKnnObservationRows (/opt/trade-up-bot/server/engine/knn-pricing.ts:369:13)
    at async getInputKnnCache (knn-pricing.ts:390:16)
    at async batchInputValueRatios (knn-pricing.ts:648:25)
    at async loadDiscoveryData (server/engine/data-load.ts:226:23)
    at async main (server/daemon/index.ts:386:20)
```

Root cause: `allRows.push(...rows)` at `server/engine/knn-pricing.ts:369`. Spread arguments are pushed onto the call stack; V8 caps a call's argument count (~125K, stack-depth dependent). The daemon path passes ALL listings for a rarity, and a single 2,000-pair chunk over 180 days of `price_observations` returns far more rows than the cap → RangeError. Plan 016's chunking test seeded only ~4,200 rows total, so the suite never hit the limit. The API path (listing-sniper) passes few listings and is unaffected — only the daemon dies, before discovery, so plan 019's sig-file path has also never executed in production.

## Current state (verified 2026-06-11 at af328e0)

`server/engine/knn-pricing.ts:328-372` — chunk loop ends with:

```ts
  const allRows: KnnObservationRow[] = [];
  // Chunk to avoid exceeding PG's 65,535 bind-parameter limit (4 params per pair)
  for (let offset = 0; offset < pairs.length; offset += KNN_SCOPED_CHUNK_SIZE) {
    ...
    const { rows } = await pool.query<KnnObservationRow>(`...`, params);
    allRows.push(...rows);   // ← line 369, the crash site
  }
  return allRows;
```

Existing tests: `tests/integration/knn-scoped-loading.test.ts` (14 tests, incl. a 2,100-pair chunking test with 2 observations per pair — too few rows to trigger the V8 limit).

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Typecheck / Target / Integration / Stress | `npm run typecheck` / `npx vitest run tests/integration/knn-scoped-loading.test.ts` / `npm test` / `npm run test:stress` | all green |

Build once (`npm run build`) before any full `npm run test:unit` / `npm test` (internal-cross-linking.test.ts reads dist/).

## Scope

**In scope**: `server/engine/knn-pricing.ts` (the `allRows.push(...rows)` site ONLY), `tests/integration/knn-scoped-loading.test.ts` (one new regression test).
**Out of scope**: every other line of knn-pricing.ts (plan 016's reviewed port must not change semantically), other `push(...x)` sites in the repo (audited: all bounded), callers, query shape, chunk size.

## Steps

### Step 1: Failing regression test FIRST (TDD red)

Add to `tests/integration/knn-scoped-loading.test.ts` a describe block "large single-chunk result (regression: spread-push RangeError)":

- Seed ONE skin/condition pair with **200,000** observations using a single server-side INSERT (fast, ~1-2s): `INSERT INTO price_observations (skin_name, float_value, price_cents, source, observed_at) SELECT '★ Stress Knife | Overflow', 0.15 + (random() * 0.22), 1000 + (g % 500), 'sale', NOW() - (random() * INTERVAL '170 days') FROM generate_series(1, 200000) g;` (floats stay inside Field-Tested bounds; follow the file's existing seeding/cleanup conventions and clean these rows up in afterAll).
- Call `batchInputValueRatios` (same call pattern as the file's existing tests) with one listing for that skin at a FT float (e.g. 0.20). Assert it RESOLVES and returns a Map with a finite ratio for the listing — no assertion on the ratio's value.
- Give this test an explicit generous timeout (e.g. `it(..., 60_000)`).
- Beware the module-level KNN cache: the existing tests in this file already handle cache freshness between tests — follow whatever reset/isolation pattern they use so the scoped path (not a warm global cache) is exercised.

**Verify (red)**: `npx vitest run tests/integration/knn-scoped-loading.test.ts` → the new test FAILS with `RangeError: Maximum call stack size exceeded` (capture the output). If it does NOT reproduce at 200K rows: STOP and report — do not raise the row count past 500K or guess.

### Step 2: Fix — bounded append

Replace `allRows.push(...rows);` with a plain loop:

```ts
    for (const row of rows) allRows.push(row);
```

(No other change. Do not "improve" anything else.)

**Verify (green)**: targeted test file all green (15 tests incl. the new one); `npm run typecheck` exit 0.

### Step 3: Full gate

**Verify**: `npm run build`, `npm test`, `npm run test:stress` all green.

## Done criteria

- [ ] New 200K-row regression test: red against `allRows.push(...rows)` (RangeError observed), green after the loop fix
- [ ] `server/engine/knn-pricing.ts` diff is exactly the one-line-site replacement (plus nothing)
- [ ] `npm run typecheck`, `npm test`, `npm run test:stress` green; only in-scope files modified

## STOP conditions

- The RangeError does not reproduce with the 200K-row seed — report observed behavior instead of escalating row counts blindly.
- Any test outside the new one changes result — report.

## Maintenance notes

- Rule of thumb now demonstrated in this codebase: never `push(...arr)` when `arr` is a query result or otherwise unbounded; loop-append instead. Other audited sites (params arrays, per-page/per-collection groups) are bounded and were left alone.
- Operator: after deploy, `pm2 start daemon` (it is STOPPED, not just stale) and watch one full cycle: expect `[KNN scoped] N observations` to complete, discovery to run, and plan 019's `Loaded N existing signatures ... from file` lines to appear with no `Daemon crashed` entries.
