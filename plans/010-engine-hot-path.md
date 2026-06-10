# Plan 010: Hoist discovery condition pools and batch the trade-up write path

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3d7e65f..HEAD -- server/engine/discovery.ts server/engine/knife-discovery.ts server/engine/db-save.ts`
> On drift, compare "Current state" excerpts; mismatch = STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (daemon core; correctness guarded by characterization tests + stress budgets)
- **Depends on**: 001 (the stress budgets must be in the CI gate before this lands)
- **Category**: perf
- **Planned at**: commit `3d7e65f`, 2026-06-10

## Why this matters

Two verified hot-path inefficiencies in the discovery daemon (the process that needs an 8GB heap and ~20-minute cycles):

1. **Condition pools are re-filtered inside a loop whose variable they don't depend on.** In `server/engine/discovery.ts`, inside the per-collection-pair loop, the `for (let countA = 1; countA <= 9; countA++)` loop re-runs `listingsA.filter(l => floatToCondition(l.float_value) === cond)` for 5 conditions (line ~388-390) plus 4 condition-pairs × 2 directions (lines ~408-418) — **the filter results are identical for all 9 `countA` iterations**. With hundreds of collection pairs × thousands of listings per pool, this is millions of redundant predicate evaluations and array allocations per cycle. The same pattern exists in `knife-discovery.ts`.
2. **The merge/save write path is row-at-a-time.** `mergeTradeUps` (server/engine/db-save.ts) issues a per-row `SELECT profit_cents, profit_streak FROM trade_ups WHERE id = $1` inside the update loop (line 177), and both save paths insert `trade_up_inputs` one row at a time (10 INSERTs per trade-up — db-save.ts:95-110 and :239-244). New-row inserts also do an immediate per-row `UPDATE ... SET peak_profit_cents` (line 235) that can be folded into the INSERT. Merging thousands of trade-ups per cycle turns into tens of thousands of sequential round-trips inside transactions.

## Current state

```ts
// server/engine/discovery.ts:334 — the loop; :388-397 — per-condition refilter (INSIDE countA loop)
for (let countA = 1; countA <= 9; countA++) {
  ...
  for (const cond of CONDITION_BOUNDS.map(c => c.name)) {
    const condA = listingsA.filter(l => floatToCondition(l.float_value) === cond);
    const condB = listingsB.filter(l => floatToCondition(l.float_value) === cond);
    if (condA.length >= countA && condB.length >= countB) {
      await tryEval([...condA.slice(0, countA), ...condB.slice(0, countB)], outcomes);
    }
  }
  // :402-419 — condPairs [["Factory New","Field-Tested"],...] re-filter poolA/poolB and reversed
```

`listingsA`/`listingsB` come from `byCollection.get(...)` before the countA loop (lines ~321-322). `CONDITION_BOUNDS` is imported from `engine/types.ts` (repo rule: never hardcode float ranges).

```ts
// server/engine/db-save.ts:177 — per-row SELECT inside the 500-batch update transaction
const { rows: oldRows } = await client.query(`SELECT profit_cents, profit_streak FROM trade_ups WHERE id = $1`, [existId]);
```

```ts
// server/engine/db-save.ts:239-244 — per-input INSERT (same shape at :95-110)
for (const inp of tu.inputs) {
  await client.query(`
    INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `, [tradeUpId, inp.listing_id, ...]);
}
```

Conventions: integer cents; `$1` placeholders; `withRetry` from `engine/utils.ts` already wraps each batch; fixtures in `tests/helpers/fixtures.ts` (`makeListing()`, `makeTradeUp()`, `makeOutcome()`); stress budgets in `tests/stress/engine-perf.test.ts`. **Hard restart required for the daemon to pick up code (`pm2 restart daemon`)** — note in report.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Typecheck | `npm run typecheck`      | exit 0              |
| Unit      | `npm run test:unit`      | all pass            |
| Stress    | `npm run test:stress`    | all pass (budgets hold) |
| Integration | `npm test`             | all pass            |

## Scope

**In scope**:
- `server/engine/discovery.ts`, `server/engine/knife-discovery.ts` (condition-pool hoisting only)
- `server/engine/db-save.ts` (`mergeTradeUps`, `saveTradeUps`)
- `tests/unit/` characterization test (create), `tests/stress/` only if adding a budget

**Out of scope**:
- `server/daemon/calc-worker.ts` signature loading and the worker IPC/NDJSON transport — known MED-confidence issues, deferred (see README "investigate" list).
- `engine/selection.ts`, KNN internals, scoring logic — no behavioral changes anywhere.
- Import structure: keep the barrel rules (`engine/db-ops.ts` etc.).

## Git workflow

- Branch: `advisor/010-engine-hot-path`; commits `perf(engine): hoist condition pools out of countA loop`, `perf(engine): batch merge reads and input inserts`. No Co-Authored-By trailers.

## Steps

### Step 1: Characterization test for discovery equivalence

Create `tests/unit/discovery-condition-pools.test.ts`: build a deterministic fixture set with `makeListing()` — e.g. 2 collections × 30 listings spanning all five conditions (set explicit `float_value`s; derive condition expectations from `CONDITION_BOUNDS`, never hardcoded ranges). Call the relevant exported discovery function (read `discovery.ts` exports — `findProfitableTradeUps` per `server/engine/CLAUDE.md`) with a generous deadline and capture the resulting trade-up signatures (`listingSig` of each result's inputs). Snapshot/sort them into an array assertion. Run twice to confirm determinism (if results are nondeterministic due to `shuffle`/random strategies, restrict the fixture/options to the deterministic structured path — read the options the function takes; if no deterministic path exists, STOP and report).

**Verify**: test passes against UNCHANGED code, twice in a row.

### Step 2: Hoist the condition pools

In `discovery.ts`, immediately after `listingsA`/`listingsB` are bound (~line 322, before the `countA` loop):

```ts
const condPoolsA = new Map<string, AdjustedListing[]>();
const condPoolsB = new Map<string, AdjustedListing[]>();
for (const c of CONDITION_BOUNDS) { condPoolsA.set(c.name, []); condPoolsB.set(c.name, []); }
for (const l of listingsA) condPoolsA.get(floatToCondition(l.float_value))?.push(l);
for (const l of listingsB) condPoolsB.get(floatToCondition(l.float_value))?.push(l);
```

(Use the actual listing type from the file — read the local type names; do not invent.) Replace every `listingsA.filter(l => floatToCondition(l.float_value) === X)` / `listingsB.filter(...)` inside the countA loop with `condPoolsA.get(X) ?? []` / `condPoolsB.get(X) ?? []`. Order within each pool is preserved by construction (stable single pass), so `.slice(0, countA)` picks the same listings as before.

Then `grep -n "floatToCondition(l.float_value) === " server/engine/knife-discovery.ts` and apply the identical hoist to any filter sites inside loops that don't depend on the loop variable (read each site; only hoist where the input array and predicate are loop-invariant).

**Verify**: Step 1 characterization test passes byte-identically; `npm run test:unit` and `npm run test:stress` pass; `grep -c "listingsA.filter(l => floatToCondition" server/engine/discovery.ts` → 0.

### Step 3: Batch the merge read

In `mergeTradeUps` (db-save.ts), before the update batches loop (~line 168), fetch all needed rows once:

```ts
const ids = toUpdate.map(u => u.existId);
const { rows: oldStats } = await pool.query(
  `SELECT id, profit_cents, profit_streak FROM trade_ups WHERE id = ANY($1::int[])`, [ids]
);
const oldById = new Map<number, { profit_cents: number; profit_streak: number }>(
  oldStats.map(r => [r.id, { profit_cents: r.profit_cents, profit_streak: r.profit_streak }])
);
```

Inside the loop, replace the per-row SELECT (line 177) with `const old = oldById.get(existId);` — the streak logic below it is unchanged.

**Verify**: `npm test` (integration tests exercising mergeTradeUps — find them with `grep -rln "mergeTradeUps" tests/`; if none exists, write one: seed via `makeTradeUp()`, call mergeTradeUps twice with a profit flip, assert `profit_streak` increments exactly as before — write it against UNCHANGED code first, then re-run after the change).

### Step 4: Multi-row input inserts and folded peak update

1. Both input-insert loops (saveTradeUps :95-110, mergeTradeUps :239-244): build one multi-row INSERT per trade-up (10 rows, 90 parameters):

```ts
const values: unknown[] = [];
const placeholders = tu.inputs.map((inp, i) => {
  const b = i * 9;
  values.push(tradeUpId, inp.listing_id, inp.skin_id, inp.skin_name, inp.collection_name, inp.price_cents, inp.float_value, inp.condition, inp.source ?? "csfloat");
  return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9})`;
}).join(",");
await client.query(`INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source) VALUES ${placeholders}`, values);
```

2. Fold the post-insert peak update (db-save.ts:234-235) into the INSERT at :228-232 by adding `peak_profit_cents` to the column list with value `Math.max(tu.profit_cents, 0)` (this matches the current semantics: UPDATE only ran when `profit_cents > 0`, leaving the DEFAULT 0 otherwise).

**Verify**: `npm test` all green (including the Step 3 merge test); `npm run test:stress` budgets hold; `grep -c "for (const inp of tu.inputs)" server/engine/db-save.ts` → 0 (and same check for the `input of tu.inputs` variant at :95).

## Test plan

- Step 1 discovery characterization (signature equality).
- Step 3 merge characterization (streak semantics).
- Existing stress budgets (`tests/stress/engine-perf.test.ts`) as the perf floor.
- Full `npm test` before finishing.

## Done criteria

- [ ] No `floatToCondition`-filter calls remain inside the countA loop (grep checks above)
- [ ] mergeTradeUps does zero per-row SELECTs (one `ANY(array)` read per merge call)
- [ ] trade_up_inputs written with one statement per trade-up
- [ ] Characterization tests pass identically pre/post change
- [ ] `npm run typecheck`, `npm run test:unit`, `npm run test:stress`, `npm test` all pass
- [ ] `plans/README.md` updated, with the deploy note: **daemon requires `pm2 restart daemon` (hard restart) to pick up this code**

## STOP conditions

- Discovery output is nondeterministic on the fixture set and no deterministic configuration exists — report with the options you tried.
- Any characterization mismatch after Step 2 (would mean pool construction changed selection order — investigate ordering, then report if unresolved).
- The 90-parameter INSERT hits a driver limit or the inputs array is ever ≠ 10 in tests (staircase types use 50 inputs per `engine/CLAUDE.md`'s table — if you find >10-input trade-ups flowing through these functions, chunk the multi-row insert at 50 rows and note it).

## Maintenance notes

- Deferred (recorded in README): worker signature pre-computation to fix the sig-load timeout feedback loop (`server/daemon/calc-worker.ts:113-130`), and the byCondition index abstraction across `selection.ts` — both build on this plan's pools.
- Reviewers: scrutinize the `peak_profit_cents` fold (semantics: GREATEST on update path, plain value on insert path) and the dep between pool ordering and `.slice(0, n)` selection.
