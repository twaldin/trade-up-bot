# Market Filter & API Performance Optimization

**Date:** 2026-03-22
**Status:** Reviewed

## Overview

Two related changes: (1) add "filter by market" to the trade-up table so users can select which marketplace listings to see, and (2) optimize cold API response times which currently time out at 60s on uncached requests.

## Problem Statement

### Market Filter
Users cannot filter trade-ups by marketplace. A user who only buys on CSFloat sees trade-ups with DMarket-only inputs they can't act on. No market filter exists despite `source` being tracked on `trade_up_inputs` and `listings`.

### Performance
Cold (uncached) requests to key endpoints are catastrophically slow:
- `/api/trade-ups` — 60s timeout (504)
- `/api/status` — 60s timeout (504)
- `/api/filter-options` — 30s
- `/api/global-stats` — 106ms (OK, Redis-cached by daemon)

Root causes:
1. **COUNT(*) on 535K rows** for filtered queries with no cap
2. **Subqueries into ~5M-row `trade_up_inputs`** for skin/collection filters
3. **No partial indexes** matching the universal `WHERE is_theoretical = false AND listing_status = 'active'` predicate
4. **`/api/status` runs 14 sequential DB queries** every 60s for ALL users, despite being admin-only data
5. **WAL contention** from daemon heavy writes starving API reads

## Design

### 1. Schema Changes

#### New column on `trade_ups`

```sql
ALTER TABLE trade_ups ADD COLUMN input_sources TEXT[] NOT NULL DEFAULT '{}';
```

Stores the distinct sorted sources for each trade-up (e.g., `{'csfloat'}` or `{'csfloat','dmarket'}`). Denormalized from `trade_up_inputs.source` to avoid expensive subqueries.

#### Backfill migration (one-time)

```sql
UPDATE trade_ups t SET input_sources = COALESCE((
  SELECT ARRAY_AGG(DISTINCT source ORDER BY source)
  FROM trade_up_inputs WHERE trade_up_id = t.id
), '{}');
```

Note: `COALESCE` handles orphaned trade-ups with no inputs (ARRAY_AGG returns NULL for empty sets, which would violate the NOT NULL constraint).

#### New partial indexes

Replace existing full-table indexes with partial indexes that match the API hot path:

```sql
-- Partial indexes for active, non-theoretical rows (the universal WHERE clause)
CREATE INDEX idx_tu_active_profit ON trade_ups(profit_cents DESC)
  WHERE is_theoretical = false AND listing_status = 'active';
CREATE INDEX idx_tu_active_roi ON trade_ups(roi_percentage DESC)
  WHERE is_theoretical = false AND listing_status = 'active';
CREATE INDEX idx_tu_active_chance ON trade_ups(chance_to_profit DESC)
  WHERE is_theoretical = false AND listing_status = 'active';
CREATE INDEX idx_tu_active_cost ON trade_ups(total_cost_cents ASC)
  WHERE is_theoretical = false AND listing_status = 'active';
CREATE INDEX idx_tu_active_ev ON trade_ups(expected_value_cents DESC)
  WHERE is_theoretical = false AND listing_status = 'active';
CREATE INDEX idx_tu_active_created ON trade_ups(created_at DESC)
  WHERE is_theoretical = false AND listing_status = 'active';
CREATE INDEX idx_tu_active_best ON trade_ups(best_case_cents DESC)
  WHERE is_theoretical = false AND listing_status = 'active';
CREATE INDEX idx_tu_active_worst ON trade_ups(worst_case_cents DESC)
  WHERE is_theoretical = false AND listing_status = 'active';

-- GIN index for market filter array containment
CREATE INDEX idx_tu_active_sources ON trade_ups USING GIN(input_sources)
  WHERE is_theoretical = false AND listing_status = 'active';

-- Index on trade_up_inputs.source for backfill + consistency queries
CREATE INDEX idx_tui_source ON trade_up_inputs(source);
```

Old full-table indexes (`idx_trade_ups_profit`, `idx_trade_ups_roi`, etc.) can be dropped after new partial indexes are verified.

**Note:** The `include_stale` query path uses `WHERE is_theoretical = false AND (listing_status = 'active' OR preserved_at IS NOT NULL)`, which does not match these partial index predicates. This is acceptable — `include_stale` is a rarely-used checkbox and will fall back to the existing full-table indexes (or a sequential scan). The hot path (default, no stale) benefits from the partial indexes.

### 2. Backend — Market Filter

#### Query parameter

`?markets=csfloat,dmarket` (comma-separated). No param = no filter (show all).

#### SQL filter

Uses Postgres `<@` (contained-by) operator with the GIN index:

```sql
-- CSFloat only:
WHERE t.input_sources <@ ARRAY['csfloat']::text[]
-- CSFloat + DMarket (shows pure CSFloat, pure DMarket, AND mixed):
WHERE t.input_sources <@ ARRAY['csfloat','dmarket']::text[]
```

Semantics: every element of `input_sources` must be in the selected markets array. A trade-up with `{'csfloat','dmarket'}` passes `['csfloat','dmarket']` but fails `['csfloat']` — correctly excluded when user only wants CSFloat.

#### `input_sources` consistency

Maintained at every mutation point in the db-ops barrel:

| Mutation | File | Action |
|----------|------|--------|
| Trade-up creation (`saveTradeUps`) | `db-save.ts` | Compute from inputs being inserted, include in INSERT |
| Trade-up creation (`mergeTradeUps`) | `db-save.ts` | Same — compute `input_sources` from inputs at insert time. Update path only touches `trade_ups` columns (not inputs), so `input_sources` stays correct. |
| Input replacement (revival) | `db-revive.ts` | Recompute after replacing inputs |
| Status cascade (input swap) | `db-status.ts` | Recompute if inputs are modified |
| Staleness deletion | `db-status.ts` | No action — row is deleted |

Each recomputation is one query:
```sql
UPDATE trade_ups SET input_sources = COALESCE((
  SELECT ARRAY_AGG(DISTINCT source ORDER BY source)
  FROM trade_up_inputs WHERE trade_up_id = $1
), '{}') WHERE id = $1
```

#### Filter options extension

Extend `/api/filter-options` to return available markets:
```sql
SELECT source, COUNT(DISTINCT trade_up_id) as count
FROM trade_up_inputs GROUP BY source
```

### 3. Backend — Query Performance

#### Capped COUNT for filtered queries

Replace unbounded COUNT(*) (which scans all 535K rows) with a capped subquery:

```sql
SELECT COUNT(*) as c
FROM (SELECT 1 FROM trade_ups t {WHERE} LIMIT 10001) sub
```

Stops scanning after 10,001 rows. Frontend shows "10,000+" when total equals 10,001.

The `profitable` count is dropped from the capped query — an arbitrary subset of 10,001 rows (no ORDER BY in the subquery) would produce a meaningless profitable count. The unfiltered path still uses Redis-cached type counts which include accurate profitable numbers. For filtered queries, the total count is sufficient.

#### Daemon pre-warms common queries

After each cycle, daemon pre-computes and caches to Redis:
- Default page 1 results for each type (sorted by profit desc)
- Type counts (already done)
- Filter options
- Status data (new — see below)

### 4. `/api/status` Optimization

#### Gate behind admin

`useStatus()` in `App.tsx` currently runs for ALL users, polling 14 expensive DB queries every 60s. Gate it:

```typescript
const { status, newDataHint, refresh } = userIsAdmin ? useStatus() : { status: null, newDataHint: false, refresh: () => {} };
```

Note: this requires restructuring to avoid conditional hook call — use a `useStatus(enabled: boolean)` parameter that skips the fetch and polling when `enabled` is false.

#### Replace `newDataHint` for non-admin users

The `newDataHint` feature (detects when `trade_ups_count` changes) can use the already-fetched `global_stats` data instead. `global_stats` contains `total_trade_ups` and is already polled every 60s via a separate effect in `App.tsx`. Compare against previous value for the same hint behavior.

#### Parallelize DB fallback

For the rare Redis miss (admin user, daemon hasn't written yet), parallelize all independent queries via `Promise.all` instead of sequential awaits.

#### Keep separate queries, parallelize them

The 5 separate skins/listings COUNT queries (lines 116-139 in `status.ts`) should stay as separate queries rather than consolidated into one multi-JOIN. Consolidating into a single `skins LEFT JOIN listings LEFT JOIN skin_collections LEFT JOIN collections` produces a cartesian explosion (a skin with 2 collections and 5 listings = 10 intermediate rows), making it potentially slower than the originals. Instead, run all 5 in parallel via `Promise.all`.

#### Daemon pre-computes status to Redis

Same pattern as `global_stats`: daemon writes `status_data` key to Redis each cycle. API is Redis-first, DB-fallback. Bump cache TTL from 60s to 1800s (matches daemon cycle).

### 5. Frontend — Market Filter UI

#### Filter component

Checkbox group in `FilterBar.tsx`, placed after collection autocomplete, before range filters:
- `☐ CSFloat`
- `☐ DMarket`
- (Future markets added to array as they go live)

All unchecked = no filter (show everything).

#### State management

- Add `markets: string[]` to `Filters` interface
- `filtersToParams()` joins with comma: `?markets=csfloat,dmarket`
- Persisted in URL via `useSearchParams` (same pattern as all other filters)
- Shows as filter chip in `FilterChips` when active (e.g., "Markets: CSFloat, DMarket")
- Debounced like all other filter changes

#### Available markets

Hardcoded array: `['csfloat', 'dmarket']`. No API discovery needed — markets are added to the array when their listings go live.

#### Capped count display

When total equals 10,001, table header shows "10,000+ found" instead of exact number.

## Files Modified

### Backend
- `server/db.ts` — Schema migration (add column, new indexes, drop old indexes)
- `server/routes/trade-ups.ts` — Market filter param, capped COUNT, markets in filter-options
- `server/routes/status.ts` — Parallelize queries, consolidate, daemon pre-compute
- `server/engine/db-save.ts` — Compute `input_sources` on trade-up creation
- `server/engine/db-revive.ts` — Recompute `input_sources` on revival
- `server/engine/db-status.ts` — Recompute `input_sources` on input changes
- `server/daemon/` (cycle end) — Pre-warm status + filter-options Redis cache

### Frontend
- `src/components/FilterBar.tsx` — Market checkbox group
- `src/components/FilterChips.tsx` — Market filter chips
- `src/pages/TradeUpsPage.tsx` — Pass markets filter, capped count display
- `src/hooks/useStatus.ts` — Add `enabled` parameter
- `src/App.tsx` — Gate useStatus behind admin, use global_stats for newDataHint
- `shared/types.ts` — Add `markets` to Filters type

### Tests
- Unit tests for `input_sources` computation logic
- Unit tests for `<@` filter query building
- Unit tests for capped COUNT behavior
- Integration tests for market filter end-to-end
- Integration tests for `input_sources` consistency across save/revive/status-cascade

## Non-Goals
- Per-checkbox market counts (combinatorial explosion with 3+ markets)
- Skinport/BitSkins market filter options (no listings stored yet)
- Cursor-based pagination (bigger UX change, not needed now)
- Read replica for API vs daemon separation (infrastructure change)
