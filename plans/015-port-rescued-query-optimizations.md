# Plan 015: Port the safe parts of the rescued VPS branch (housekeeping gate + dataviewer query rewrites)

> **Executor instructions**: Follow step by step with verification. STOP conditions binding. Reviewer maintains plans/README.md.
>
> **Drift check (run first)**: `git diff --stat 5fbb497..HEAD -- server/daemon/phases/housekeeping.ts server/routes/collections.ts server/routes/data.ts`
> On drift, compare excerpts; mismatch = STOP.

## Status

- **Priority**: P2 — **Effort**: M — **Risk**: MED (query rewrites; characterization tests required) — **Depends on**: none — **Category**: perf
- **Planned at**: commit `5fbb497`, 2026-06-10

## Why this matters

Branch `vps-local-changes-2026-06-10` (fetch from origin) holds production-tested perf work that was never committed (review: `plans/notes/vps-local-changes-review-2026-06-10.md`). Three parts were judged PORT/PARTIAL: (1) the daemon's orphan purge runs a full anti-join (`trade_ups` vs 11M-row `trade_up_inputs`) EVERY ~30-min cycle for a condition that occurs rarely; (2) `server/routes/collections.ts` computes per-collection listing counts via `COUNT(DISTINCT l.id)` over a 3-way join; (3) `server/routes/data.ts` dataviewer queries aggregate every listing in the table even for selective searches. The branch's versions fix these but carry ONE KNOWN BUG you must fix during the port (multi-collection count inflation) and have zero tests.

## Current state

- Reference implementation: `git show vps-local-changes-2026-06-10:server/daemon/phases/housekeeping.ts` (and same for the other files); base diff: `git diff 8394686..vps-local-changes-2026-06-10 -- <file>`. Main has NOT touched these three files since the branch's base — the diffs apply conceptually clean.
- housekeeping.ts: branch wraps the orphan purge in `if (cycleCount % 10 === 0)` (branch :91-98); `cycleCount` already flows in as a parameter.
- collections.ts: branch hunk 1 (:26-36) replaces COUNT(DISTINCT) with a `listing_counts_by_skin` CTE + SUM — PORT. Branch hunk 2 (:38-43) reads `trade_up_collection_index` — DO NOT PORT (table is being decommissioned).
- data.ts: branch (:114-150, :182-215, :227-245) pushes filters into MATERIALIZED CTEs + pre-aggregated `listing_stats`. **KNOWN BUG**: the outer `LEFT JOIN skin_collections` duplicates `listing_stats` rows for skins in >1 collection, inflating `SUM(ls.listing_count)`; old `COUNT(DISTINCT l.id)` was immune. Fix by aggregating collection names in their own CTE (per skin) BEFORE joining listing_stats, so the listing_stats join is 1:1.
- Conventions: $n placeholders, integer cents, no `as any`; integration tests on tradeupbot_test (setup.ts seeds multi-collection capable schema); fixtures in tests/helpers/fixtures.ts.

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Typecheck / Unit / Integration / Stress | `npm run typecheck` / `npm run test:unit` / `npm test` / `npm run test:stress` | all green |

Build once before test:unit (dist/ dependency: internal-cross-linking.test.ts).

## Scope

**In scope**: `server/daemon/phases/housekeeping.ts`, `server/routes/collections.ts` (hunk 1 only), `server/routes/data.ts`, tests (integration characterization).
**Out of scope**: `server/routes/trade-ups.ts` and ANYTHING referencing `trade_up_collection_index` (DISCARDED — see review note), `server/engine/knn-pricing.ts` (plan 016).

## Steps

### Step 1: Characterization tests FIRST (against unchanged code)

`tests/integration/dataviewer-counts.test.ts`: seed via setup.ts patterns a skin belonging to TWO collections with N listings; assert `/api/skin-data` returns `listing_count === N` (not 2N) and correct min/avg/max; plus a single-collection skin control; plus a `/api/collections` listing-count assertion. Run against UNCHANGED code — green (this pins the DISTINCT semantics the rewrite must preserve).

### Step 2: Port housekeeping gate

Apply the branch change (cycle-gated purge, comment included). **Verify**: `npm run test:unit` (daemon-state tests green); grep shows `% 10` gate present.

### Step 3: Port collections.ts hunk 1

Apply the listing-counts CTE rewrite ONLY (skip hunk 2). **Verify**: Step 1's collections assertion still green; `npm test` green.

### Step 4: Port data.ts rewrites WITH the inflation fix

Apply the branch's CTE structure but restructure: `filtered_skins` (MATERIALIZED, all s.* filters) → `collection_names_by_skin` CTE (`STRING_AGG(DISTINCT c.name)` grouped per skin_id) → `listing_stats` per skin → final join (each join now 1:1 per skin). Same for the knife-pool query and the sale-count rewrite (:227-245 — port as-is, it's per-skin correlated subqueries over indexed paths).

**Verify**: Step 1 tests green UNCHANGED (inflation case is the point); `npm test` full green; optional timing note via `npx tsx scripts/api-bench.ts` if it covers /api/skin-data (read it first).

### Step 5: Full gate

**Verify**: `npm run typecheck && npm test && npm run test:stress` green.

## Done criteria

- [ ] Orphan purge cycle-gated; dataviewer + collections queries CTE-based
- [ ] Multi-collection skin returns un-inflated listing_count (characterization test green pre+post)
- [ ] Zero references to trade_up_collection_index anywhere (`grep -rn trade_up_collection_index server/` → empty)
- [ ] All gates green; only in-scope files modified

## STOP conditions

- Characterization test reveals current behavior differs from the DISTINCT-count assumption — report before porting.
- The branch's filter interpolations don't transplant cleanly into the CTE (params order) — report rather than reordering params by guesswork.

## Maintenance notes

- The orphan purge now runs every ~5h (10 cycles); if orphans ever matter operationally, the modulus is the knob.
- Operator follow-up (separate, user-approved): drop `trg_trade_up_collection_index` trigger(s) + `trade_up_collection_index` table on prod (2.4GB, unread, taxing every daemon write) — see review note.
