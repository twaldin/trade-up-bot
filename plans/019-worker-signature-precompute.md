# Plan 019: Precompute discovery signatures in the daemon — fix the worker sig-load timeout feedback loop

> **Executor instructions**: Follow step by step with verification. STOP conditions binding. Reviewer maintains plans/README.md.
>
> **Drift check (run first)**: `git diff --stat 5fbb497..HEAD -- server/daemon/calc-worker.ts server/daemon/index.ts server/engine/db-save.ts`
> On drift, compare excerpts; mismatch = STOP.

## Status

- **Priority**: P3 — **Effort**: M–L — **Risk**: MED (daemon core concurrency; needs careful characterization) — **Depends on**: 010 (DONE) — **Category**: perf/bug
- **Planned at**: commit `5fbb497`, 2026-06-10

## Why this matters

From the original audit (recorded in plans/README.md investigate list, daemon-engine findings): each forked calc worker loads the existing trade-up signature set by querying the DB (`server/daemon/calc-worker.ts:113-130` region). Under write pressure (the daemon merging results concurrently), this query stalls **8–174s** and on timeout the worker falls back to **skipping dedup** — saving 100–500+ duplicate trade-ups per affected cycle. Duplicates make the next cycle's sig load slower → a feedback loop of degrading cycle times. The root fix the audit prescribed: the main daemon computes the signature set ONCE per cycle and hands workers a file, eliminating both the per-worker query and the race window.

## Current state (verify before editing — read these fully)

- `server/daemon/calc-worker.ts` (~242 lines): worker boot, sig load with statement timeout + skip-dedup fallback, NDJSON result writing to /tmp.
- `server/daemon/index.ts`: cycle orchestration; lines ~369-390 already NDJSON-cache discovery data for workers — the established pattern for passing per-cycle artifacts via files; worker fork/dispatch around line ~191; merge phase calls `mergeTradeUps`.
- `server/engine/db-save.ts` `mergeTradeUps` (post-plan-010): reads existing sigs via `STRING_AGG` GROUP BY query (lines ~156-168), builds `existingSigs` map — this is the SAME signature universe the workers need; `listingSig`/`parseSig` from `engine/utils.ts`.
- `server/engine/store.ts` `TradeUpStore.hasSig` — how workers consume sigs.
- Tests: tests/unit/daemon-state.test.ts and engine suites; tests/stress budgets; integration on tradeupbot_test.

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Typecheck / Unit / Integration / Stress | `npm run typecheck` / `npm run test:unit` / `npm test` / `npm run test:stress` | all green |

Build once before test:unit (dist/ dependency).

## Scope

**In scope**: `server/daemon/index.ts` (sig precompute + file handoff), `server/daemon/calc-worker.ts` (consume file; keep DB query as fallback when no file provided), a small shared helper if needed (engine/utils or daemon/utils — match existing placement), tests.
**Out of scope**: `mergeTradeUps` internals (plan 010's shape stays), the NDJSON result transport (separate investigate item), worker pooling/IPC redesign.

## Steps

### Step 1: Characterize current worker sig behavior

Read calc-worker.ts fully. Write a unit/integration test capturing the CURRENT contract: given a sigs source, the worker's store skips known signatures (find the seam — likely TradeUpStore seeding). If the sig-load code is untestable as-is, extract the load into a function first (mechanical, no behavior change) and test that.

### Step 2: Main-process precompute + file handoff

In the daemon cycle (where discovery data is already NDJSON-cached, ~:369-390): before forking workers for a type, compute the signature set for that type ONCE (reuse the exact query shape from mergeTradeUps' existingSigs read), write sigs one-per-line to a per-cycle file (same naming/dir convention as the discovery NDJSON files), and pass the path to workers via their existing payload/env mechanism (read how discovery-data paths are passed; mirror it).

### Step 3: Worker consumes the file

calc-worker: if a sig-file path is provided and readable, load sigs from it (streaming line read; no DB query, no timeout race); else fall back to the existing DB query path (keeps the worker robust if invoked standalone). Remove the skip-dedup fallback ONLY for the file path (file read can't stall on locks); keep it for the DB fallback.

**Verify**: unit test for the file loader (round-trips a generated file); integration test: seed trade-ups, generate the file via the new daemon helper, assert worker-side store skips those sigs; `npm test` green.

### Step 4: Full gate + cycle smoke

**Verify**: `npm run typecheck && npm test && npm run test:stress` green. Operator note: after deploy + daemon restart, watch one cycle's logs for the sig-file path and absence of sig-load timeout warnings.

## Done criteria

- [ ] Workers load sigs from a per-cycle file written by the main daemon; DB query remains only as explicit fallback
- [ ] No skip-dedup path reachable when the file exists
- [ ] New tests green; all suites + stress budgets green; only in-scope files modified

## STOP conditions

- Workers receive sigs through a mechanism that can't carry a file path without IPC changes — report the actual mechanism found.
- The sig universe needed by workers differs from mergeTradeUps' existingSigs (e.g. includes theoretical) — report the discrepancy; do not guess.

## Maintenance notes

- The sig file is per-cycle disposable; if cycle artifacts get a cleanup pass someday, include it.
- This unblocks the related investigate item (worker /tmp NDJSON result transport) — same file-lifecycle conventions.
