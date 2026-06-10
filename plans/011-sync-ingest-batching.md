# Plan 011: Batch market-data ingest writes and de-synchronize retry sleeps

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3d7e65f..HEAD -- server/sync/`
> On drift, compare "Current state" excerpts; mismatch = STOP.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: LOW–MED (ingest paths; data must land identically)
- **Depends on**: 001
- **Category**: perf
- **Planned at**: commit `3d7e65f`, 2026-06-10

## Why this matters

The fetchers write market data row-at-a-time and sleep in lockstep:

- **CSFloat sale ingest** (`server/sync/sales.ts:189-210`): per sale, one `INSERT INTO sale_history` AND one `recordSaleObservation(pool, ...)` — note the observation insert uses `pool` (a separate connection) while inside the `client` transaction, so each sale costs two round-trips on two connections. Hundreds of sales per cycle → hundreds of avoidable round-trips on the shared 20-connection pool the web API also uses.
- **Skinport WebSocket** (`server/sync/skinport-ws.ts:138-145`): one `INSERT INTO price_observations` per sale event, no batching/backpressure — sale bursts translate directly into connection-pool pressure.
- **Fixed retry sleeps** (`server/sync/csfloat.ts:115-119` — `const delay = 15000`; same pattern elsewhere: `grep -rn "15000\|30000" server/sync/ | grep -i "delay\|wait\|sleep"`): when multiple fetch paths hit the same 429 bucket they all retry simultaneously.

## Current state

```ts
// server/sync/sales.ts:189-210 (verify; abridged)
await client.query('BEGIN');
for (const sale of sales) {
  if (sale.state !== "sold") continue;
  if (sale.item.is_stattrak) continue;
  await client.query(`INSERT INTO sale_history (...) VALUES ($1,...,$6,'csfloat') ON CONFLICT DO NOTHING`, [...]);
  await recordSaleObservation(pool, pair.skinName, sale.item.float_value, sale.price, sale.created_at);
  totalSales++;
}
await client.query('COMMIT');
```

```ts
// server/sync/skinport-ws.ts:138-145
await pool.query(`
  INSERT INTO price_observations (skin_name, float_value, price_cents, source, observed_at)
  VALUES ($1, $2, $3, 'skinport_sale', NOW())
  ON CONFLICT DO NOTHING
`, [finalSkinName, item.wear, item.salePrice]);
```

- Dedup safety net already exists: `idx_price_obs_dedup` UNIQUE ON `price_observations(skin_name, float_value, price_cents, source)` (server/db.ts:508-510) — multi-row `ON CONFLICT DO NOTHING` inserts are therefore safe to batch.
- `recordSaleObservation` lives in `server/sync/` or `server/engine/observations.ts` — locate it (`grep -rn "export.*function recordSaleObservation" server/`) and read it before changing call sites; it may add normalization (Doppler phase re-keying etc.) that the batch must preserve.
- `withRetry` helper exists in `server/engine/utils.ts`.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Typecheck | `npm run typecheck`      | exit 0              |
| Unit      | `npm run test:unit`      | all pass            |
| Integration | `npm test`             | all pass            |

## Scope

**In scope**:
- `server/sync/sales.ts` (sale-history loop), `server/sync/skinport-ws.ts` (observation insert)
- The fixed-delay retry sites in `server/sync/csfloat.ts` and `server/sync/sales.ts`
- `tests/unit/` / `tests/integration/` for the new batch helpers

**Out of scope**:
- `price_data` UPSERT semantics, DMarket fetcher transactions, fetch concurrency across marketplaces — all real but MED-confidence; recorded as "investigate" items in the README, not fixed here.
- Rate-limit budget logic, API pagination, WS reconnect handling.

## Git workflow

- Branch: `advisor/011-sync-ingest-batching`; commits `perf(sync): ...`. No Co-Authored-By trailers.

## Steps

### Step 1: Batch the CSFloat sale ingest

1. Read `recordSaleObservation` fully. Extract its row-preparation logic (name normalization etc.) from its insert so both single and batch paths share it, or add a `recordSaleObservations(client, rows[])` batch variant beside it.
2. In the sales loop: collect eligible sales into two arrays (`saleHistoryRows`, `observationRows`) instead of inserting per item; after the loop, inside the SAME transaction `client`, run one multi-row `INSERT ... ON CONFLICT DO NOTHING` for each table (chunk at 200 rows; placeholder construction as in Plan 010 Step 4).
3. The observation insert moves onto `client` (transactional) instead of `pool` — verify `recordSaleObservation`'s current failure semantics first: today an observation failure aborts the whole sale loop via the thrown error? Read the catch structure; preserve whatever holds today (if observations were best-effort, keep the batch best-effort with its own try/catch).

**Verify**: `npm run typecheck` exit 0; integration test (Step 3) green; `grep -n "recordSaleObservation(pool" server/sync/sales.ts` → no match in the loop.

### Step 2: Micro-batch the Skinport WS observations

In `skinport-ws.ts`, replace the per-item insert with a module-level buffer: push prepared rows; flush with a multi-row `INSERT ... ON CONFLICT DO NOTHING` when the buffer reaches 50 rows OR a 500ms timer fires (start the timer on first push; clear after flush). Flush failures: log once per minute max, drop the batch (same as today's silent per-row catch, but observable). Add a `stats.totalSaleObservations += inserted` update consistent with current counters.

**Verify**: `npm run typecheck`; unit test for the buffer logic (extract it as a small pure-ish class/function so it's testable without a socket: push 49 rows → no flush; 50th → flush; timer path with vi.useFakeTimers).

### Step 3: Integration test for batch equivalence

`tests/integration/sync-batch-ingest.test.ts`: insert a synthetic batch of 5 sales (2 duplicates of existing rows) through the new batch path against `tradeupbot_test`; assert `sale_history` and `price_observations` contents equal what the old row-at-a-time semantics produced (3 new rows each, duplicates ignored). Use `makeObservation()` from `tests/helpers/fixtures.ts` where applicable.

**Verify**: `npm test` → all pass.

### Step 4: Jitter the fixed retry sleeps

At each fixed-delay retry site found by `grep -rn "setTimeout(r, " server/sync/ | grep -v jitter`: replace constant delays with `base + Math.floor(Math.random() * 5000)`. Where a `x-ratelimit-reset` header is already parsed (check `sales.ts:30-40` region), prefer `Math.max(0, resetMs - Date.now()) + jitter`. Keep retry counts unchanged.

**Verify**: `npm run typecheck`; `npm run test:unit` (if any test asserts exact delays, update it to assert a range).

## Test plan

- Step 2 buffer unit test (fake timers), Step 3 integration equivalence test.
- Full `npm test` green.

## Done criteria

- [ ] Sale ingest: ≤ 2 INSERT statements per fetched page (chunked), not 2 per sale
- [ ] Skinport WS: buffered flushes, no per-event INSERT
- [ ] All fixed sync retry delays jittered
- [ ] `npm run typecheck`, `npm run test:unit`, `npm test` all pass
- [ ] `plans/README.md` updated (note: daemon hard-restart required to pick up sync code)

## STOP conditions

- `recordSaleObservation` performs per-row logic that cannot be replicated in a batch without behavior change (e.g. reads back state per row).
- The WS buffer would reorder observations in a way any consumer depends on (check KNN loaders' ORDER BY — they sort by observed_at, so insert order shouldn't matter; if you find an exception, stop).
- Integration test shows any row-count or content difference vs the old path.

## Maintenance notes

- Deferred "investigate" items recorded in README: conditional `price_data` UPSERT (skip writes when values unchanged), parallelizing independent marketplace fetch phases, DMarket per-item transaction batching.
- If Skinport event volume grows, the buffer thresholds (50 rows / 500ms) are the tuning knobs; they're constants at the top of the module.
