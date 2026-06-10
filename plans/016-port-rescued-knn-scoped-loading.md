# Plan 016: Port the rescued KNN scoped-loading rework (with chunking fix + tests)

> **Executor instructions**: Follow step by step with verification. STOP conditions binding. Reviewer maintains plans/README.md.
>
> **Drift check (run first)**: `git diff --stat 5fbb497..HEAD -- server/engine/knn-pricing.ts server/engine/data-load.ts server/routes/listing-sniper.ts`
> On drift, compare excerpts; mismatch = STOP.

## Status

- **Priority**: P2 — **Effort**: M–L — **Risk**: MED (KNN feeds output pricing; behavior must be equivalence-tested) — **Depends on**: 007 (DONE — uses `idx_price_obs_skin_observed`) — **Category**: perf
- **Planned at**: commit `5fbb497`, 2026-06-10

## Why this matters

Branch `vps-local-changes-2026-06-10` contains a 229-line rework of `server/engine/knn-pricing.ts` that production ran (uncommitted) until 2026-06-10. The review (`plans/notes/vps-local-changes-review-2026-06-10.md`) judged it a genuine perf fix worth porting properly:

1. `batchInputValueRatios` currently forces a **full load of every sale observation from the last 180 days** whenever its 2-minute cache is cold. It is called from `server/routes/listing-sniper.ts:133` — i.e. **a user web request can trigger a multi-million-row scan** — and from `server/engine/data-load.ts:226` in the daemon.
2. The current date predicate `EXTRACT(EPOCH FROM NOW() - observed_at)/86400 <= $1` is computed per-row and can never use an index. The branch's `observed_at >= NOW() - ($1::int * INTERVAL '1 day')` is sargable and is served by `idx_price_obs_skin_observed (skin_name, observed_at DESC)` (added to prod by plan 007).
3. The branch adds scoped loading (only the distinct (skin, condition-float-range) pairs of the requested listings via a VALUES CTE + JOIN LATERAL), float-sorted caches with binary-search ±0.04 windows, and fixes a latent pg-string bug (`Number(row.age_days) || 0`).

**Known defects you must fix during the port** (review findings): (a) `loadInputKnnObservationRows` pushes 4 bind params per pair — unbounded; PG caps at 65,535 (~16K pairs) and the daemon call site passes all listings for a rarity. Chunk the pairs (e.g. 2,000 pairs per query, concatenate results). (b) Zero tests on the branch.

## Current state

- Reference: `git show vps-local-changes-2026-06-10:server/engine/knn-pricing.ts`; base diff `git diff 8394686..vps-local-changes-2026-06-10 -- server/engine/knn-pricing.ts`. Main has not touched this file since the branch's base — but REAPPLY hunks thoughtfully, don't blind-apply.
- Key branch structures: `loadKnnObservationRows` + `buildKnnCache` split (:189-323); `KnnObservation` type from `engine/types.ts:68` replaces inline anon type; `getInputKnnCache`/`loadInputKnnObservationRows` (:212-275, :346-360) scoped path; `lowerBoundFloat` binary search; cache sorted by float in `buildKnnCache` (:311).
- Float-range semantics must match `floatToCondition` (`shared/types.ts:44-51`) and use `CONDITION_BOUNDS` (never hardcode ranges — repo rule).
- Existing tests: `tests/unit/` knn-pricing/knn-core/knn-outlier/pricing-accuracy suites (49 tests) — all must stay green. Integration DB: tradeupbot_test.
- Conventions: integer cents, $n placeholders, no `as any`, TDD.

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Typecheck / Unit / Integration / Stress | `npm run typecheck` / `npm run test:unit` / `npm test` / `npm run test:stress` | all green |

Build once before test:unit (dist/ dependency).

## Scope

**In scope**: `server/engine/knn-pricing.ts`; tests (unit for binary-search/window edges; integration for the scoped query incl. chunking).
**Out of scope**: callers (`data-load.ts`, `listing-sniper.ts`) — signatures must not change; KNN math/decay constants (`KNN_MAX_OBS_AGE_DAYS` stays 180 — the 90-day tuning idea remains a separate investigate item); `trade_up_collection_index` anything.

## Steps

### Step 1: Equivalence tests FIRST (against unchanged code)

`tests/integration/knn-scoped-loading.test.ts`: seed price_observations for 3 skins across conditions/floats (use `makeObservation()` where it fits); call `batchInputValueRatios` (read its exported signature first) and snapshot the returned ratios. These observed values become the assertions — they must hold byte-identically after the port. Add unit tests for the window logic you're about to introduce: boundary floats (exactly ±0.04 edges), empty condition pools, <2 same-condition observations.

### Step 2: Port the cache/load split + sargable predicate

Apply the `loadKnnObservationRows`/`buildKnnCache` refactor, the `KnnObservation` typing, sorted cache, `Number(age_days)` coercion, and the sargable predicate. **Verify**: all existing knn/pricing unit suites green; Step 1 integration snapshots unchanged; `npm run typecheck` exit 0.

### Step 3: Port the scoped input path WITH chunking

Apply `getInputKnnCache`/`loadInputKnnObservationRows`, but chunk the (skin, range) pairs at 2,000 pairs per query (8,000 params), concatenating rows across chunks before `buildKnnCache`. Add an integration test that exercises >1 chunk (seed 2,100 distinct skin/condition pairs cheaply — synthetic names are fine; assert row counts match an unchunked control query).

**Verify**: Step 1 snapshots STILL unchanged; chunking test green; `npm test` full green.

### Step 4: Port the binary-search window + memoizations

Apply `lowerBoundFloat` + per-(skin,condition) memoization in `batchInputValueRatios`. **Verify**: Step 1 snapshots unchanged (this is pure mechanics — any ratio drift = bug; STOP if found); window-edge unit tests green; `npm run test:stress` budgets hold.

### Step 5: Full gate

**Verify**: `npm run typecheck && npm test && npm run test:stress` green.

## Done criteria

- [ ] Scoped loading active (no full-table load on listing-sniper requests); predicate sargable
- [ ] Pair chunking proven by a >1-chunk test; ratios byte-identical to pre-port snapshots
- [ ] All existing knn/pricing suites green; new edge tests green; all gates pass
- [ ] Only in-scope files modified

## STOP conditions

- Any ratio snapshot changes at any step — the port must be behavior-preserving; report the diverging case.
- The branch's LATERAL query shape can't be chunked without changing semantics — report alternatives (e.g. ANY(array) reformulation) instead of improvising.

## Maintenance notes

- Operator: daemon graceful restart (scripts/daemon-restart.sh) required after deploy; listing-sniper benefits immediately via the api restart.
- Follow-up candidates kept in README investigate list: KNN_MAX_OBS_AGE_DAYS 180→90 tuning (needs accuracy measurement), memoizing the scoped path across daemon cycle.
