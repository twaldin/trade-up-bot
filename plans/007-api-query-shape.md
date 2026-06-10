# Plan 007: Remove per-row correlated subqueries and the claims N+1 from the API hot path

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3d7e65f..HEAD -- server/routes/trade-ups.ts server/routes/claims.ts server/db.ts server/index.ts`
> On drift, compare "Current state" excerpts; mismatch = STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (changes the highest-traffic endpoint's SQL; response shape must be byte-compatible)
- **Depends on**: 001; pairs well with 006
- **Category**: perf
- **Planned at**: commit `3d7e65f`, 2026-06-10

## Why this matters

`GET /api/trade-ups` (the main product endpoint, `server/routes/trade-ups.ts:87`) attaches two **correlated subqueries to every returned row** — for a 50-row page that's ~100 extra scans of the ~11M-row `trade_up_inputs` table per cache miss, one of them LEFT JOINing `listings` per row. The Redis TTL is 30s and the cache key includes every filter combination, so misses are constant. Secondarily, `getActiveClaims` (server/routes/claims.ts:30-50) runs one query per active claim on its cache-miss path, and the 30-day price-trend query on `/skins/:slug` filters `price_observations` by `(skin_name, observed_at)` with no supporting index (`server/db.ts` has only `(skin_name)` and `(skin_name, float_value)`).

## Current state

```sql
-- server/routes/trade-ups.ts:328-340 (the list query; verify before editing)
SELECT t.id, t.type, ..., 0 as outcome_count,
  (SELECT COUNT(*)::int FROM trade_up_inputs tui WHERE tui.trade_up_id = t.id AND tui.listing_id NOT LIKE 'theor%') as real_input_count,
  (SELECT COUNT(*)::int FROM trade_up_inputs tui LEFT JOIN listings l ON tui.listing_id = l.id WHERE tui.trade_up_id = t.id AND tui.listing_id NOT LIKE 'theor%' AND l.id IS NULL) as missing_count
FROM trade_ups t ${collectionJoin} ${where}
ORDER BY ${sortCol} ${sortOrder}
LIMIT $N OFFSET $M
```

A similar correlated pair exists in the detail endpoint near `server/routes/trade-ups.ts:483`. Find every site: `grep -n "real_input_count\|missing_count" server/routes/trade-ups.ts`.

```ts
// server/routes/claims.ts:36-43 (same shape again at :59-66 in refreshClaimsCache)
const result: ActiveClaim[] = [];
for (const c of claims) {
  const { rows: inputs } = await pool.query(
    "SELECT listing_id FROM trade_up_inputs WHERE trade_up_id = $1",
    [c.trade_up_id]
  );
  result.push({ ...c, listing_ids: inputs.map((i: any) => i.listing_id) });
}
```

(Note: this path is behind a 5-minute Redis cache `active_claims`, so it's a minor win — included because the fix is mechanical.)

Index inventory relevant here (`server/db.ts:456-457`): `idx_price_obs_skin_float ON price_observations(skin_name, float_value)`, `idx_price_obs_skin ON price_observations(skin_name)` — nothing covering `observed_at`. The trend query is at `server/index.ts:614-621` (`WHERE skin_name = $1 AND observed_at > NOW() - INTERVAL '30 days'`), and KNN/observation queries in `server/sync/sales.ts` filter `(skin_name, source, observed_at)`.

Existing supporting index for the batch-count rewrite: `idx_trade_up_inputs_trade ON trade_up_inputs(trade_up_id)` (db.ts:442) and `idx_trade_up_inputs_listing ON trade_up_inputs(listing_id)` (db.ts:459).

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Typecheck | `npm run typecheck`      | exit 0              |
| Unit      | `npm run test:unit`      | all pass            |
| Integration | `npm test`             | all pass (needs `tradeupbot_test` PG) |
| Bench (optional) | `npx tsx scripts/api-bench.ts` | exists in repo — read it first; use to compare before/after |

## Scope

**In scope**:
- `server/routes/trade-ups.ts` (list + detail count computation)
- `server/routes/claims.ts` (`getActiveClaims`, `refreshClaimsCache`)
- `server/db.ts` (one new index statement) + `scripts/add-price-obs-index.ts` (create)
- `tests/integration/` (new/updated tests)

**Out of scope**:
- The `WHERE`-builder / filter logic in trade-ups.ts — do not refactor it.
- Response JSON shape — `real_input_count` and `missing_count` must remain present with identical values and types (`::int`).
- `cachedRoute` (Plan 006). Daemon write paths (Plan 010).

## Git workflow

- Branch: `advisor/007-api-query-shape`; commits `perf(api): batch input counts for trade-up list`, etc. No Co-Authored-By trailers.

## Steps

### Step 1: Characterization test first

In `tests/integration/`, find the existing trade-ups route test (look for files testing `/api/trade-ups`; if none exists, create `tests/integration/trade-ups-counts.test.ts` modeled on an existing integration test and `tests/helpers/fixtures.ts` — use `makeTradeUp()`/`makeListing()`). Seed: 2 trade-ups, one with all 10 inputs backed by listings rows, one with 3 inputs whose `listing_id` has no matching `listings` row and 1 input with `listing_id LIKE 'theor%'`. Assert the list response's `real_input_count` and `missing_count` for both rows match current behavior (run against current code to capture truth).

**Verify**: `npm test` → new test passes against UNCHANGED code.

### Step 2: Rewrite the list-query counts as one batched query

1. Remove the two correlated subqueries from the SELECT (keep `0 as outcome_count`; select the remaining columns unchanged).
2. After `dataPromise` resolves with the page rows, run ONE query:

```sql
SELECT tui.trade_up_id,
       COUNT(*) FILTER (WHERE tui.listing_id NOT LIKE 'theor%')::int AS real_input_count,
       COUNT(*) FILTER (WHERE tui.listing_id NOT LIKE 'theor%' AND l.id IS NULL)::int AS missing_count
FROM trade_up_inputs tui
LEFT JOIN listings l ON tui.listing_id = l.id
WHERE tui.trade_up_id = ANY($1::int[])
GROUP BY tui.trade_up_id
```

with `[rows.map(r => r.id)]`, build a `Map<number, {real_input_count, missing_count}>`, and merge into each row before the response is assembled (rows absent from the map get `{0, 0}`).
3. Apply the same pattern to the detail endpoint's correlated pair (~line 483) — for a single id the batched query degenerates to one id in the array; reuse the same helper.

**Verify**: `npm test` → Step 1's characterization test still passes byte-for-byte; `npm run typecheck` exit 0. Optional: run `scripts/api-bench.ts` before/after on a production-sized local DB and record numbers in the commit message.

### Step 3: Batch the claims listing-id load

Replace the per-claim loop in BOTH `getActiveClaims` and `refreshClaimsCache` with:

```sql
SELECT trade_up_id, array_agg(listing_id) AS listing_ids
FROM trade_up_inputs
WHERE trade_up_id = ANY($1::int[])
GROUP BY trade_up_id
```

then stitch onto the claims rows (claims with no inputs get `[]`). Remove the `(i: any)` cast while you're in there — type the row as `{ trade_up_id: number; listing_ids: string[] }`.

**Verify**: `npm run typecheck` exit 0; existing claims integration tests pass (`npm test`); `grep -n ": any" server/routes/claims.ts` → no new matches.

### Step 4: Index for time-windowed observation queries

1. Add to the index block in `server/db.ts` (line ~456 region): `CREATE INDEX IF NOT EXISTS idx_price_obs_skin_observed ON price_observations(skin_name, observed_at DESC);` — fresh databases get it cheaply.
2. Create `scripts/add-price-obs-index.ts` for production (the table is large; plain CREATE INDEX inside startup would lock/block — production should run this once, manually):

```ts
// runs CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_price_obs_skin_observed ... ;
// CONCURRENTLY cannot run inside a transaction — use a direct client, not pool.query inside BEGIN.
```

Model the script's structure on an existing one in `scripts/` (e.g. `backfill-collection-names.ts`). Print EXPLAIN output for the trend query before/after.

**Verify**: `npm run typecheck`; on the local dev DB run the script → exits 0, second run exits 0 (idempotent); `psql tradeupbot -c "\d price_observations"` lists the new index.

## Test plan

- Step 1 characterization test (counts correctness) — the core regression net.
- Claims: existing integration tests in `tests/integration/` covering claim/release (find them; if `getActiveClaims` is untested, add one test seeding 2 claims and asserting `listing_ids` arrays).
- Full `npm test` green before finishing.

## Done criteria

- [ ] `grep -c "SELECT COUNT(\*)::int FROM trade_up_inputs tui WHERE tui.trade_up_id = t.id" server/routes/trade-ups.ts` → 0
- [ ] Characterization test passes unchanged across the rewrite
- [ ] Claims functions issue exactly 2 queries total on cache miss (claims + batched inputs)
- [ ] `idx_price_obs_skin_observed` exists in db.ts AND `scripts/add-price-obs-index.ts` is idempotent
- [ ] `npm run typecheck`, `npm run test:unit`, `npm test` all pass
- [ ] `plans/README.md` updated; production note added there: "run scripts/add-price-obs-index.ts on the VPS once after deploy"

## STOP conditions

- The characterization test reveals the current counts are themselves buggy (e.g. theor% semantics differ from assumption) — report the discrepancy before changing anything.
- The batched query returns different values than the correlated version for any seeded case.
- `ANY($1::int[])` conflicts with how ids are typed (trade_ups.id is SERIAL/int — if you find TEXT ids anywhere, stop).

## Maintenance notes

- If pagination size ever grows beyond ~200, the `ANY(array)` approach stays fine; the thing to watch is the `NOT LIKE 'theor%'` filter — if theoretical inputs get a real flag column someday, both the query and the index strategy simplify.
- The production index must be created CONCURRENTLY during a quiet window; it's additive and safe to roll back by `DROP INDEX`.
