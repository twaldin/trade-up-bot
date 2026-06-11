# Plan 021: Free the stale global KNN cache when the scoped path builds its own (daemon Phase 5 OOM relief)

> **Executor instructions**: Follow step by step with verification. STOP conditions binding. Reviewer maintains plans/README.md.
>
> **Drift check (run first)**: `git diff --stat c2b3212..HEAD -- server/engine/knn-pricing.ts tests/integration/knn-scoped-loading.test.ts`
> Expected empty. Any drift = STOP.

## Status

- **Priority**: P1 (production discovery stalled — daemon OOM-killed in Phase 5 before forking workers) — **Effort**: S — **Risk**: LOW-MED (shared module cache semantics; mitigations below) — **Depends on**: 016, 020 (DONE) — **Category**: bug/perf
- **Planned at**: commit `c2b3212`, 2026-06-11

## Why this matters

The production VPS has 3.7GB RAM (+swap) shared by PG/Redis/api/daemon and has chronically OOM-cycled for weeks (879 kernel OOM kills since June 4; the daemon resumes from saved state each restart). Pre-plan-016, each ~11-minute loop still reached Phase 5 worker dispatch and made discovery progress. Post-016, observed live on 2026-06-11: every loop is killed during Phase 5 tier data loading (by tier 4 of 6 the box hits ~80MB free with swap full) and **workers never fork — discovery output is fully stalled**.

The marginal memory regression: Phase 4c repricing fills the module-level global cache `_knnCache` (observed: **1,313,629 observations, 3,539 skins** — several hundred MB). Pre-016, Phase 5's input-ratio path reused/reloaded that SAME map (one big map ever resident, cleared in place on reload at knn-pricing.ts:264). Post-016, the scoped path (`getInputKnnCache`) builds NEW per-tier scoped caches while the stale global map stays fully resident — the old margin is gone. Fix: when the scoped path finds the global cache stale, clear it in place before building the scoped cache, reclaiming the memory for the rest of Phase 5.

(Operational stopgap already applied 2026-06-11: swap widened 2GB→6GB. This plan recovers actual headroom rather than paging it.)

## Current state (verified 2026-06-11 at c2b3212, server/engine/knn-pricing.ts)

- `:168` `const _knnCache: KnnCacheMap = new Map();` — module-level, `const`, always mutated in place.
- `:172-173` `let _knnCacheLoadedAt = 0; const KNN_CACHE_TTL_MS = 2 * 60 * 1000;`
- `:262-279` full-load path: returns early if warm; otherwise `_knnCache.clear()` (line 264), awaits the full reload, re-`.set()`s entries — so consumers already tolerate an in-place clear + empty-map window during reloads.
- `:283-287` `resetKnnCache()` — existing exported test seam, also clears in place.
- `:380-394` `getInputKnnCache(pool, listings)`: `if (_knnCache.size > 0 && Date.now() - _knnCacheLoadedAt < KNN_CACHE_TTL_MS) return _knnCache;` then builds a scoped cache via `loadInputKnnObservationRows` + `buildKnnCache` — WITHOUT touching the stale `_knnCache`. This is the leak-shaped coexistence.
- Direct global-cache readers at `:580,600,737,749` (`_knnCache.get(...)`) — output-pricing paths; they read the module variable per call and degrade to misses/fallbacks on empty (same as during the existing line-264 reload window).
- Daemon call order is sequential: Phase 4c (full path) completes before Phase 5 (scoped path); no in-daemon consumer holds the map across that boundary.

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Typecheck / Target / Integration / Stress | `npm run typecheck` / `npx vitest run tests/integration/knn-scoped-loading.test.ts` / `npm test` / `npm run test:stress` | all green |

`npm run build` once before any full `npm run test:unit` / `npm test` (dist/ dependency).

## Scope

**In scope**: `server/engine/knn-pricing.ts` (`getInputKnnCache` + up to two small exported test seams following the `resetKnnCache` precedent), `tests/integration/knn-scoped-loading.test.ts`.
**Out of scope**: the full-load path (lines 262-279), TTL value, scoped query/chunking (plans 016/020 shapes), callers, daemon/index.ts.

## Steps

### Step 1: Failing test first (TDD red)

In `tests/integration/knn-scoped-loading.test.ts`, add a describe block "stale global cache is freed by the scoped path". You will need two tiny test seams in knn-pricing.ts (export them next to `resetKnnCache`, matching its naming style and a `// test seam` comment):
- one that force-expires the TTL (sets `_knnCacheLoadedAt = 0` WITHOUT clearing the map),
- one that reports `_knnCache.size`.

Test flow: seed a few observations (reuse the file's existing seeding helpers/patterns) → warm the GLOBAL cache by calling the exported full-path entry the daemon's Phase 4c uses (find the exported function that fills `_knnCache` — read the module's exports; it is the one logging `[KNN cache] ...`) → assert global size > 0 → force-expire the TTL via the new seam → call `batchInputValueRatios` with a listing (scoped path runs) → **assert the global cache size is now 0** (freed) AND the returned ratios are still valid/finite.

**Verify (red)**: the size assertion fails against current code (global stays > 0 after the scoped call). Capture the failing output.

### Step 2: Implement the stale-clear

In `getInputKnnCache`, after the warm-cache early return, add:

```ts
  // Stale global cache: free it before building scoped caches so the two
  // never coexist in memory (daemon Phase 5 OOM margin — see plan 021).
  if (_knnCache.size > 0) {
    _knnCache.clear();
    _knnCacheLoadedAt = 0;
  }
```

**Verify (green)**: Step 1 test green; ALL existing tests in the file green (16 from plans 016/020); `npm run typecheck` exit 0.

### Step 3: Full gate

**Verify**: `npm run build`, `npm test`, `npm run test:stress` all green.

## Done criteria

- [ ] New test red→green proving: warm global cache + expired TTL + scoped call ⇒ global cache emptied, scoped results still correct
- [ ] knn-pricing.ts production diff is the stale-clear block in `getInputKnnCache` plus the two test seams — nothing else
- [ ] All gates green; only in-scope files modified

## STOP conditions

- The exported full-path warm function turns out not to fill `_knnCache` in a way the test can observe — report what you found instead of inventing new seams.
- Any existing test (incl. plans 016/020 suites) changes result.

## Maintenance notes

- Known accepted trade-off (documented for the API process, where this module is also loaded): if an output-pricing read overlaps a scoped call that clears the stale cache, it sees misses and falls back, identical to the pre-existing reload window at line 264; next full-path call repopulates. Non-fatal, self-healing.
- Operator: after deploy, graceful daemon restart, then watch Phase 5: expect tier loads to complete, `Loaded N existing signatures ... from file` worker lines (plan 019), and discovery rounds saving trade-ups. The 2GB→6GB swap widening (2026-06-11) stays as belt-and-braces.
- If OOM kills persist after this, the remaining levers are the VPS resize (user decision) and the L-effort discovery-memory redesign in the README investigate list.
