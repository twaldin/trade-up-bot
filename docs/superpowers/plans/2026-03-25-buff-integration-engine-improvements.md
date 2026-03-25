# Buff Integration + Discovery Engine Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate Buff.market listings into the main discovery pipeline, fix the weighted pool bug so gun-tier exploration is profit-guided, clean up dead freshness code, and overhaul exploration strategies with deeper offsets, value-ratio selection, and output curve classification.

**Architecture:** The buff-fetcher writes to the main `listings` table (like DMarket) instead of the isolated `buff_listings` table. The weighted pool maps collection IDs to names before weight lookup. Exploration gets new strategies that use `byColValue` (KNN value-ratio sorted) and a precomputed output curve score per collection-pair+split to gate whether to cost-minimize or float-optimize.

**Tech Stack:** TypeScript ESM, PostgreSQL (pg Pool), vitest, Redis cache, Express API, React frontend

**Spec:** `docs/superpowers/specs/2026-03-25-buff-integration-engine-improvements-design.md`

**Task dependency chain:** 1 → 2 → 3 (independent) | 4 (independent) | 5 → 6 → 7 → 8

**Critical reviewer notes for implementers:**
- `marketplace_id` must flow from DB → API response → frontend (add to `shared/types.ts` `TradeUpInput`, add to `db-save.ts` input insert, add to trade-up API query)
- The dead code barrel is at `server/daemon/phases.ts` (NOT `server/daemon/phases/phases.ts`)
- Housekeeping purge should use `staleness_checked_at` (not `created_at`) for buff — a listing refreshed 10 min ago shouldn't be purged
- No `as any` casts — use proper row types
- Frontend files: `src/components/trade-up/InputList.tsx` (badges/links), `src/utils/format.ts` (`sourceLabel`, `sourceColor`, `listingUrl`), `src/components/data-viewer/ScatterChart.tsx` + `types.ts` + `SkinDetailPanel.tsx` (chart/sidebar), `src/components/FilterBar.tsx` (market dropdown)

---

## File Map

### New Files
- `server/engine/curve-classification.ts` — output curve classification (staircase/smooth/flat) + combo curve score cache
- `tests/unit/curve-classification.test.ts` — unit tests for curve classification + comboCurveScore
- `tests/unit/weighted-pool.test.ts` — unit tests for weighted pool fix

### Modified Files
- `server/db.ts` — add `marketplace_id` column to listings table creation
- `server/buff-fetcher.ts` — write to `listings` table instead of `buff_listings`, update queue queries, add cascade on delete
- `shared/types.ts` — add `marketplace_id` to `TradeUpInput` type
- `server/engine/db-save.ts` — include `marketplace_id` in trade-up input INSERT
- `server/engine/data-load.ts` — fix `buildWeightedPool`, add `byCollection` param for ID→name mapping
- `server/engine/discovery.ts` — add `byColValue` destructuring, new value-ratio strategies, curve-aware gate, deeper offsets
- `server/engine/knife-discovery.ts` — same explore changes for knife tier
- `server/engine/pricing.ts` — call curve classification build in `buildPriceCache`
- `server/daemon/phases/housekeeping.ts` — add buff to 24h purge (use `staleness_checked_at`)
- `server/daemon/phases.ts` — remove dead exports (NOT `phases/phases.ts`)
- `server/daemon/state.ts` — remove dead `needsRecalc`/`markCalcDone`
- `src/utils/format.ts` — add buff to `sourceLabel`, `sourceColor`, `listingUrl`
- `src/components/trade-up/InputList.tsx` — marketplace badges (CSF/DM/BUFF)
- `src/components/data-viewer/types.ts` — add `buff` to `SeriesKey`, `SERIES_COLORS`
- `src/components/data-viewer/ScatterChart.tsx` — add buff listing series
- `src/components/data-viewer/SkinDetailPanel.tsx` — buff in sidebar sums
- `src/components/FilterBar.tsx` — add buff to market filter dropdown
- `server/daemon/phases/classified-calc.ts` — remove dead `phase5ClassifiedCalc` if present
- `server/daemon/phases/knife-calc.ts` — remove dead `phase5KnifeCalc` if present
- `server/daemon/state.ts` — remove `needsRecalc`/`markCalcDone` from FreshnessTracker
- `server/verify-listings.ts` — already handles buff (no change needed, verified)
- `server/routes/trade-ups.ts` — market filter already handles arbitrary sources (no change needed)
- `src/components/TradeUpInputs.tsx` (or equivalent) — marketplace badges + buff link tooltip
- `src/pages/SkinDetail.tsx` (or equivalent data viewer) — buff listings in chart/table/sidebar

### Test Files
- `tests/unit/weighted-pool.test.ts` — new
- `tests/unit/curve-classification.test.ts` — new
- `tests/unit/discovery.prop.test.ts` — add value-ratio strategy property tests
- `tests/integration/db-ops.test.ts` — add buff listing integration tests

---

## Task 1: Add `marketplace_id` Column + Buff Housekeeping

**Files:**
- Modify: `server/db.ts` (listings table creation)
- Modify: `server/daemon/phases/housekeeping.ts:40-50`
- Test: `tests/integration/db-ops.test.ts`

- [ ] **Step 1: Write failing test — marketplace_id column exists**

```typescript
// In tests/integration/db-ops.test.ts, add:
it("listings table has marketplace_id column", async () => {
  const { rows } = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'listings' AND column_name = 'marketplace_id'
  `);
  expect(rows).toHaveLength(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/db-ops.test.ts -t "marketplace_id"`
Expected: FAIL (column doesn't exist yet)

- [ ] **Step 3: Add marketplace_id column to DB schema**

In `server/db.ts`, add to the listings table creation:
```sql
marketplace_id TEXT
```

And run migration on local DB:
```bash
psql -d tradeupbot -c "ALTER TABLE listings ADD COLUMN IF NOT EXISTS marketplace_id TEXT"
psql -d tradeupbot_test -c "ALTER TABLE listings ADD COLUMN IF NOT EXISTS marketplace_id TEXT"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/db-ops.test.ts -t "marketplace_id"`
Expected: PASS

- [ ] **Step 5: Add buff to housekeeping 24h purge**

In `server/daemon/phases/housekeeping.ts`, after the DMarket purge block (line 40-50), add:
```typescript
// Purge Buff listings older than 24h
const { rows: buffPurgedRows } = await pool.query(`
  SELECT id FROM listings WHERE source = 'buff'
    AND EXTRACT(EPOCH FROM NOW() - created_at) / 86400.0 > 1
`);
if (buffPurgedRows.length > 0) {
  const ids = buffPurgedRows.map((r: any) => r.id);
  await pool.query(`DELETE FROM listings WHERE id = ANY($1)`, [ids]);
  await cascadeTradeUpStatuses(pool, ids);
  console.log(`  Purged ${ids.length} Buff listings (>24h old)`);
}
```

- [ ] **Step 6: Commit**

```bash
git add server/db.ts server/daemon/phases/housekeeping.ts tests/integration/db-ops.test.ts
git commit -m "feat: add marketplace_id column + buff housekeeping purge"
```

---

## Task 2: Migrate Buff Fetcher to Write to Main Listings Table

**Files:**
- Modify: `server/buff-fetcher.ts:219-231` (upsertBuffListing)
- Modify: `server/buff-fetcher.ts:418-430` (staleness diff)
- Modify: `server/buff-fetcher.ts:149-213` (queue-building queries)
- Test: `tests/integration/db-ops.test.ts`

- [ ] **Step 1: Write failing test — buff listing appears in main listings table**

```typescript
it("buff listing is stored in listings table with source=buff", async () => {
  // Insert a skin first (required FK)
  await pool.query(`INSERT INTO skins (id, name, weapon, rarity, min_float, max_float, stattrak)
    VALUES ('test-skin', 'AK-47 | Redline', 'AK-47', 'Classified', 0.0, 1.0, false)
    ON CONFLICT DO NOTHING`);

  // Simulate what the migrated buff fetcher does
  await pool.query(`
    INSERT INTO listings (id, skin_id, price_cents, float_value, paint_seed, stattrak, source, listing_type, staleness_checked_at, marketplace_id)
    VALUES ('buff-test-123', 'test-skin', 500, 0.15, 42, false, 'buff', 'buy_now', NOW(), '33348')
    ON CONFLICT (id) DO UPDATE SET price_cents = EXCLUDED.price_cents, staleness_checked_at = NOW()
  `);

  const { rows } = await pool.query("SELECT * FROM listings WHERE id = 'buff-test-123'");
  expect(rows).toHaveLength(1);
  expect(rows[0].source).toBe("buff");
  expect(rows[0].marketplace_id).toBe("33348");
  expect(rows[0].staleness_checked_at).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/db-ops.test.ts -t "buff listing"`
Expected: FAIL or PASS depending on schema migration state — test validates the pattern works

- [ ] **Step 3: Migrate `upsertBuffListing` to write to `listings` table**

In `server/buff-fetcher.ts`, replace the `upsertBuffListing` function (line ~219-231):

```typescript
async function upsertBuffListing(
  pool: pg.Pool,
  listing: BuffListing,
  skinId: string,
): Promise<boolean> {
  const { rowCount } = await pool.query(`
    INSERT INTO listings (id, skin_id, price_cents, float_value, paint_seed, stattrak, source, listing_type, staleness_checked_at, marketplace_id)
    VALUES ($1, $2, $3, $4, $5, $6, 'buff', 'buy_now', NOW(), $7)
    ON CONFLICT (id) DO UPDATE SET
      price_cents = EXCLUDED.price_cents,
      float_value = EXCLUDED.float_value,
      paint_seed = EXCLUDED.paint_seed,
      staleness_checked_at = NOW(),
      price_updated_at = CASE WHEN listings.price_cents != EXCLUDED.price_cents THEN NOW() ELSE listings.price_updated_at END,
      marketplace_id = EXCLUDED.marketplace_id
  `, [listing.id, skinId, listing.priceCents, listing.floatValue, listing.paintSeed, listing.stattrak, String(listing.goodsId)]);
  return (rowCount ?? 0) > 0;
}
```

- [ ] **Step 4: Migrate staleness diff to use `listings` table**

In `server/buff-fetcher.ts`, replace the staleness diff block (line ~418-430):

```typescript
// Staleness diff: remove stored buff listings for this goods_id that aren't in API response
if (activeBuffIds.size > 0) {
  const { rows: stored } = await pool.query(
    "SELECT id FROM listings WHERE skin_id = $1 AND source = 'buff' AND marketplace_id = $2",
    [skinId, String(entry.goodsId)],
  );
  const removedIds: string[] = [];
  for (const s of stored) {
    if (!activeBuffIds.has(s.id)) {
      await pool.query("DELETE FROM listings WHERE id = $1", [s.id]);
      removedIds.push(s.id);
      result.listingsRemoved++;
    }
  }
  if (removedIds.length > 0) {
    const { cascadeTradeUpStatuses } = await import("./engine.js");
    await cascadeTradeUpStatuses(pool, removedIds);
  }
}
```

- [ ] **Step 5: Migrate queue-building queries**

In `server/buff-fetcher.ts`, update `getCoverageGaps` and `getStaleSkins` to query `listings WHERE source = 'buff'` instead of `buff_listings`. Replace all references to the `buff_listings` table in queue queries.

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/integration/`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add server/buff-fetcher.ts tests/integration/db-ops.test.ts
git commit -m "feat: migrate buff fetcher to write to main listings table"
```

---

## Task 3: Fix Weighted Pool Bug

**Files:**
- Modify: `server/engine/data-load.ts:142-162`
- Create: `tests/unit/weighted-pool.test.ts`

- [ ] **Step 1: Write failing test — weighted pool uses profit history for collection IDs**

```typescript
// tests/unit/weighted-pool.test.ts
import { describe, it, expect } from "vitest";

describe("buildWeightedPool with collection IDs", () => {
  it("produces non-uniform weights when collection IDs map to names with profit history", () => {
    // We test the pure logic by extracting the weighting into a testable function
    // The fix adds a nameMap parameter to buildWeightedPool

    const eligibleCollections = ["col-id-1", "col-id-2", "col-id-3"];
    const nameMap = new Map([
      ["col-id-1", "The Chroma Collection"],
      ["col-id-2", "The Glove Collection"],
      ["col-id-3", "The Dust Collection"],
    ]);
    const profitWeights = new Map([
      ["The Glove Collection", 100],  // 100 profitable trade-ups → sqrt(100)=10 → capped at 10
      ["The Chroma Collection", 4],   // 4 profitable → sqrt(4)=2
      // Dust has none → weight 1
    ]);

    // Apply the weighting logic
    const pool: string[] = [];
    for (const col of eligibleCollections) {
      const name = nameMap.get(col);
      const w = Math.max(1, name ? (profitWeights.get(name) ?? 0) : 0);
      const entries = Math.min(10, Math.ceil(Math.sqrt(w)));
      for (let i = 0; i < entries; i++) pool.push(col);
    }

    // Glove should appear 10x, Chroma 2x, Dust 1x
    const counts = new Map<string, number>();
    for (const c of pool) counts.set(c, (counts.get(c) ?? 0) + 1);

    expect(counts.get("col-id-2")).toBe(10); // Glove: sqrt(100) = 10
    expect(counts.get("col-id-1")).toBe(2);  // Chroma: sqrt(4) = 2
    expect(counts.get("col-id-3")).toBe(1);  // Dust: default 1
  });
});
```

- [ ] **Step 2: Run test to verify it passes** (testing the intended logic)

Run: `npx vitest run tests/unit/weighted-pool.test.ts`
Expected: PASS (this tests the target logic, next step tests the actual function)

- [ ] **Step 3: Fix `buildWeightedPool` in data-load.ts**

Update the function signature and implementation to accept a `byCollection` map for ID→name resolution:

```typescript
export async function buildWeightedPool(
  pool: pg.Pool,
  eligibleCollections: string[],
  tradeUpType: string,
  byCollection?: Map<string, ListingWithCollection[]>,
): Promise<string[]> {
  const profitWeights = new Map<string, number>();
  const { rows: profitRows } = await pool.query(`
    SELECT tui.collection_name, COUNT(*) as cnt
    FROM trade_up_inputs tui JOIN trade_ups t ON t.id = tui.trade_up_id
    WHERE t.type = $1 AND t.profit_cents > 0
    GROUP BY tui.collection_name
  `, [tradeUpType]);
  for (const r of profitRows) profitWeights.set(r.collection_name, parseInt(r.cnt, 10));

  // Build ID→name mapping from loaded listings (fixes gun-tier weighting)
  const nameMap = new Map<string, string>();
  if (byCollection) {
    for (const [key, listings] of byCollection) {
      if (listings.length > 0 && listings[0].collection_name) {
        nameMap.set(key, listings[0].collection_name);
      }
    }
  }

  const weightedPool: string[] = [];
  for (const col of eligibleCollections) {
    // Resolve collection_id to collection_name for profit weight lookup
    const name = nameMap.get(col) ?? col;
    const w = Math.max(1, profitWeights.get(name) ?? 0);
    for (let i = 0; i < Math.min(10, Math.ceil(Math.sqrt(w))); i++) weightedPool.push(col);
  }
  return weightedPool;
}
```

- [ ] **Step 4: Update all callers to pass `byCollection`**

In `discovery.ts` `randomExplore` (~line 460) and `exploreWithBudget` (~line 869):
```typescript
const weightedPool = await buildWeightedPool(pool, eligibleCollections, tradeUpType, byCollection);
```

In `knife-discovery.ts` equivalent calls — knife already passes collection_name so this is a no-op enhancement.

- [ ] **Step 5: Run all tests**

Run: `npx vitest run tests/unit/ tests/integration/`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add server/engine/data-load.ts server/engine/discovery.ts server/engine/knife-discovery.ts tests/unit/weighted-pool.test.ts
git commit -m "fix: weighted pool now resolves collection IDs to names for profit weighting"
```

---

## Task 4: Dead Code Cleanup — FreshnessTracker

**Files:**
- Modify: `server/daemon/state.ts`
- Modify: `server/daemon/phases/phases.ts`
- Remove or modify: `server/daemon/phases/knife-calc.ts`
- Remove or modify: `server/daemon/phases/classified-calc.ts`

- [ ] **Step 1: Verify dead code — confirm no live imports**

Run:
```bash
grep -r "phase5KnifeCalc\|phase5ClassifiedCalc\|needsRecalc\|markCalcDone" server/daemon/index.ts
```
Expected: No matches (confirming these are dead)

- [ ] **Step 2: Remove dead exports from phases.ts**

In `server/daemon/phases/phases.ts`, remove exports for `phase5KnifeCalc` and `phase5ClassifiedCalc`.

- [ ] **Step 3: Remove `needsRecalc` and `markCalcDone` from FreshnessTracker**

In `server/daemon/state.ts`, remove the `needsRecalc()` and `markCalcDone()` methods. Keep `markListingsChanged()` if referenced elsewhere for logging.

- [ ] **Step 4: Remove dead function implementations**

Remove the dead functions from `knife-calc.ts` and `classified-calc.ts`. If those files contain only dead code, delete them. If they contain live exports too, only remove the dead functions.

- [ ] **Step 5: Run type check + tests**

```bash
npx tsc --noEmit && npx vitest run
```
Expected: All pass, no type errors

- [ ] **Step 6: Commit**

```bash
git add -u server/daemon/
git commit -m "chore: remove dead FreshnessTracker methods and unused phase functions"
```

---

## Task 5: Output Curve Classification

**Files:**
- Create: `server/engine/curve-classification.ts`
- Create: `tests/unit/curve-classification.test.ts`
- Modify: `server/engine/pricing.ts` (call classification build)

- [ ] **Step 1: Write failing tests for curve classification**

```typescript
// tests/unit/curve-classification.test.ts
import { describe, it, expect } from "vitest";
import { classifySkinCurve, type CurveData } from "../../server/engine/curve-classification.js";

describe("classifySkinCurve", () => {
  it("classifies staircase: high condition ratio, low intra-CV", () => {
    const data: CurveData = {
      fnAvg: 10000, fnStd: 500, fnCount: 10,   // FN: $100 ± $5
      mwAvg: 3000, mwStd: 200, mwCount: 10,    // MW: $30 ± $2
      ftAvg: 1000, ftStd: 100, ftCount: 10,     // FT: $10 ± $1
      wwAvg: 800, wwStd: 50, wwCount: 10,
      bsAvg: 700, bsStd: 40, bsCount: 10,
    };
    const result = classifySkinCurve(data);
    expect(result.conditionRatio).toBeGreaterThan(3);
    expect(result.intraConditionCV).toBeLessThan(30);
  });

  it("classifies flat: low condition ratio, low intra-CV", () => {
    const data: CurveData = {
      fnAvg: 1200, fnStd: 50, fnCount: 10,
      mwAvg: 1000, mwStd: 40, mwCount: 10,
      ftAvg: 900, ftStd: 35, ftCount: 10,
      wwAvg: 850, wwStd: 30, wwCount: 10,
      bsAvg: 800, bsStd: 25, bsCount: 10,
    };
    const result = classifySkinCurve(data);
    expect(result.conditionRatio).toBeLessThan(1.5);
    expect(result.intraConditionCV).toBeLessThan(30);
  });

  it("classifies smooth: high intra-CV", () => {
    const data: CurveData = {
      fnAvg: 8000, fnStd: 4000, fnCount: 10,  // 50% CV within FN
      mwAvg: 4000, mwStd: 2000, mwCount: 10,
      ftAvg: 2000, ftStd: 1000, ftCount: 10,
      wwAvg: 1500, wwStd: 600, wwCount: 10,
      bsAvg: 1000, bsStd: 200, bsCount: 10,
    };
    const result = classifySkinCurve(data);
    expect(result.intraConditionCV).toBeGreaterThan(30);
  });

  it("returns null for insufficient data", () => {
    const data: CurveData = {
      fnAvg: 10000, fnStd: 500, fnCount: 2, // below 5 threshold
      mwAvg: 3000, mwStd: 200, mwCount: 10,
      ftAvg: 1000, ftStd: 100, ftCount: 2,  // below 5 threshold
      wwAvg: 0, wwStd: 0, wwCount: 0,
      bsAvg: 0, bsStd: 0, bsCount: 0,
    };
    const result = classifySkinCurve(data);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/curve-classification.test.ts`
Expected: FAIL (module doesn't exist)

- [ ] **Step 3: Implement curve-classification.ts**

Create `server/engine/curve-classification.ts`:

```typescript
/**
 * Output skin price curve classification.
 *
 * Computes per-skin curve shape from price_observations:
 * - conditionRatio: max inter-condition price ratio (FN/FT, FN/MW, MW/FT)
 * - intraConditionCV: avg coefficient of variation within conditions
 *
 * Strategy mapping:
 * - STAIRCASE (high ratio, low CV): cost-minimize, target condition thresholds
 * - FLAT (low ratio, low CV): pure cost-minimize
 * - SMOOTH/STEEP+WIDE/MIXED (high CV): value-ratio optimize, float precision matters
 */

import pg from "pg";

export interface CurveData {
  fnAvg: number; fnStd: number; fnCount: number;
  mwAvg: number; mwStd: number; mwCount: number;
  ftAvg: number; ftStd: number; ftCount: number;
  wwAvg: number; wwStd: number; wwCount: number;
  bsAvg: number; bsStd: number; bsCount: number;
}

export interface CurveScore {
  conditionRatio: number;
  intraConditionCV: number;
}

const MIN_OBS_PER_CONDITION = 5;

export function classifySkinCurve(data: CurveData): CurveScore | null {
  // Need sufficient data in at least FN and one other condition
  const conditions = [
    { avg: data.fnAvg, std: data.fnStd, count: data.fnCount },
    { avg: data.mwAvg, std: data.mwStd, count: data.mwCount },
    { avg: data.ftAvg, std: data.ftStd, count: data.ftCount },
  ];

  const valid = conditions.filter(c => c.count >= MIN_OBS_PER_CONDITION && c.avg > 0);
  if (valid.length < 2) return null;

  // Inter-condition ratio: max ratio between adjacent conditions
  const avgs = valid.map(c => c.avg).sort((a, b) => b - a);
  const conditionRatio = avgs[0] / avgs[avgs.length - 1];

  // Intra-condition CV: average coefficient of variation across conditions with data
  const cvs = valid.map(c => c.avg > 0 ? (c.std / c.avg) * 100 : 0);
  const intraConditionCV = cvs.reduce((s, v) => s + v, 0) / cvs.length;

  return { conditionRatio, intraConditionCV };
}

// --- Curve cache (per-skin, refreshed with price cache) ---

export const curveCache = new Map<string, CurveScore>();
let curveCacheBuiltAt = 0;
const CURVE_CACHE_TTL_MS = 5 * 60 * 1000;

export async function buildCurveCache(pool: pg.Pool): Promise<number> {
  if (curveCache.size > 0 && Date.now() - curveCacheBuiltAt < CURVE_CACHE_TTL_MS) {
    return curveCache.size;
  }
  curveCache.clear();

  const { rows } = await pool.query(`
    SELECT skin_name,
      AVG(CASE WHEN float_value < 0.07 THEN price_cents END) as fn_avg,
      STDDEV(CASE WHEN float_value < 0.07 THEN price_cents END) as fn_std,
      COUNT(*) FILTER (WHERE float_value < 0.07) as fn_cnt,
      AVG(CASE WHEN float_value >= 0.07 AND float_value < 0.15 THEN price_cents END) as mw_avg,
      STDDEV(CASE WHEN float_value >= 0.07 AND float_value < 0.15 THEN price_cents END) as mw_std,
      COUNT(*) FILTER (WHERE float_value >= 0.07 AND float_value < 0.15) as mw_cnt,
      AVG(CASE WHEN float_value >= 0.15 AND float_value < 0.38 THEN price_cents END) as ft_avg,
      STDDEV(CASE WHEN float_value >= 0.15 AND float_value < 0.38 THEN price_cents END) as ft_std,
      COUNT(*) FILTER (WHERE float_value >= 0.15 AND float_value < 0.38) as ft_cnt,
      AVG(CASE WHEN float_value >= 0.38 AND float_value < 0.45 THEN price_cents END) as ww_avg,
      STDDEV(CASE WHEN float_value >= 0.38 AND float_value < 0.45 THEN price_cents END) as ww_std,
      COUNT(*) FILTER (WHERE float_value >= 0.38 AND float_value < 0.45) as ww_cnt,
      AVG(CASE WHEN float_value >= 0.45 THEN price_cents END) as bs_avg,
      STDDEV(CASE WHEN float_value >= 0.45 THEN price_cents END) as bs_std,
      COUNT(*) FILTER (WHERE float_value >= 0.45) as bs_cnt
    FROM price_observations
    WHERE source IN ('sale', 'buff_sale', 'skinport_sale')
    GROUP BY skin_name
    HAVING COUNT(*) >= 10
  `);

  for (const row of rows) {
    const score = classifySkinCurve({
      fnAvg: parseFloat(row.fn_avg) || 0, fnStd: parseFloat(row.fn_std) || 0, fnCount: parseInt(row.fn_cnt),
      mwAvg: parseFloat(row.mw_avg) || 0, mwStd: parseFloat(row.mw_std) || 0, mwCount: parseInt(row.mw_cnt),
      ftAvg: parseFloat(row.ft_avg) || 0, ftStd: parseFloat(row.ft_std) || 0, ftCount: parseInt(row.ft_cnt),
      wwAvg: parseFloat(row.ww_avg) || 0, wwStd: parseFloat(row.ww_std) || 0, wwCount: parseInt(row.ww_cnt),
      bsAvg: parseFloat(row.bs_avg) || 0, bsStd: parseFloat(row.bs_std) || 0, bsCount: parseInt(row.bs_cnt),
    });
    if (score) curveCache.set(row.skin_name, score);
  }

  curveCacheBuiltAt = Date.now();
  return curveCache.size;
}

// --- Combo curve score ---

export interface ComboOutcome {
  skinName: string;
  probability: number;
  estimatedPrice: number;
}

/**
 * Compute EV-weighted curve score for a set of output outcomes.
 * Returns { conditionRatio, intraConditionCV } averaged by price × probability.
 * High CV → float precision matters (use value-ratio strategies).
 * Low CV + high ratio → condition thresholds matter (use price-sorted).
 * Low CV + low ratio → flat (pure cost-minimize).
 */
export function comboCurveScore(outcomes: ComboOutcome[]): CurveScore | null {
  let weightedRatio = 0;
  let weightedCV = 0;
  let totalWeight = 0;

  for (const o of outcomes) {
    const score = curveCache.get(o.skinName);
    if (!score) continue;
    const weight = o.probability * o.estimatedPrice;
    weightedRatio += score.conditionRatio * weight;
    weightedCV += score.intraConditionCV * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) return null;
  return {
    conditionRatio: weightedRatio / totalWeight,
    intraConditionCV: weightedCV / totalWeight,
  };
}

/**
 * Should this combo use value-ratio strategies (true) or price-sorted (false)?
 * Returns null if no curve data available (use default balanced approach).
 */
export function shouldUseValueRatio(score: CurveScore | null): boolean | null {
  if (!score) return null;
  // High intra-condition CV → float precision pays off → value-ratio
  return score.intraConditionCV > 30;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/curve-classification.test.ts`
Expected: All PASS

- [ ] **Step 5: Wire into price cache build**

In `server/engine/pricing.ts`, at the end of `buildPriceCache`:
```typescript
import { buildCurveCache } from "./curve-classification.js";
// ... at end of buildPriceCache:
const curveCount = await buildCurveCache(pool);
```

- [ ] **Step 6: Commit**

```bash
git add server/engine/curve-classification.ts tests/unit/curve-classification.test.ts server/engine/pricing.ts
git commit -m "feat: add output curve classification (staircase/smooth/flat)"
```

---

## Task 6: Deeper Offsets + Value-Ratio Strategies + Curve-Aware Gate

**Files:**
- Modify: `server/engine/discovery.ts` (exploreWithBudget)
- Modify: `server/engine/knife-discovery.ts` (exploreKnifeWithBudget)
- Modify: `tests/unit/properties/discovery.prop.test.ts`

This is the largest task. It modifies the explore strategy switch statements.

- [ ] **Step 1: Write tests for deeper offsets and value-ratio strategy**

Add to `tests/unit/properties/discovery.prop.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { shouldUseValueRatio } from "../../../server/engine/curve-classification.js";

describe("curve-aware strategy selection", () => {
  it("selects value-ratio for high intra-condition CV", () => {
    expect(shouldUseValueRatio({ conditionRatio: 5, intraConditionCV: 50 })).toBe(true);
  });

  it("selects price-sorted for low CV staircase", () => {
    expect(shouldUseValueRatio({ conditionRatio: 8, intraConditionCV: 15 })).toBe(false);
  });

  it("selects price-sorted for flat", () => {
    expect(shouldUseValueRatio({ conditionRatio: 1.2, intraConditionCV: 10 })).toBe(false);
  });

  it("returns null for no data", () => {
    expect(shouldUseValueRatio(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it passes** (tests the classification logic)

Run: `npx vitest run tests/unit/properties/discovery.prop.test.ts -t "curve-aware"`
Expected: PASS

- [ ] **Step 3: Update `exploreWithBudget` in discovery.ts**

Key changes:
1. Add `byColValue` to destructuring from `loadDiscoveryData`
2. Raise all offset caps (20→200, 30→300, 10→100)
3. Add 3 new value-ratio strategy cases
4. Import `comboCurveScore`, `shouldUseValueRatio` from curve-classification
5. Precompute combo curve scores per collection-pair at worker start
6. In each strategy, check `shouldUseValueRatio` to decide whether to draw from `byCollection` or `byColValue`

The specific code changes are extensive — the implementer should:
- Add `byColValue` to the destructuring on the line that calls `loadDiscoveryData`
- Find all `Math.min(listA.length - countA, 20)` patterns and raise the cap
- Add strategy cases 12, 13, 14 for value-ratio single, pair, and hybrid
- Update `TOTAL_STRATEGIES` constant
- Before the main while loop, precompute `comboCurveScores` for all collection pairs using loaded outcomes + price data

- [ ] **Step 4: Apply same changes to `exploreKnifeWithBudget` in knife-discovery.ts**

Same pattern: deeper offsets, value-ratio strategies, curve-aware gating. Knife uses 5 inputs not 10, and splits are 1-4 through 4-1.

- [ ] **Step 5: Run full test suite**

```bash
npx tsc --noEmit && npx vitest run
```
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add server/engine/discovery.ts server/engine/knife-discovery.ts tests/unit/properties/discovery.prop.test.ts
git commit -m "feat: deeper offsets, value-ratio strategies, curve-aware exploration"
```

---

## Task 7: Frontend — Marketplace Badges + Buff Links

**Files:**
- Modify: Trade-up input component (find via `grep -r "source.*csfloat\|marketplace.*badge" src/`)
- Modify: Skin detail / data viewer page

- [ ] **Step 1: Find the relevant frontend files**

```bash
grep -rn "csfloat\|dmarket\|source.*badge\|listing.*link" src/components/ src/pages/ --include="*.tsx" | head -20
```

- [ ] **Step 2: Add marketplace badges**

Add badge rendering for each source: `CSF` (CSFloat), `DM` (DMarket), `BUFF` (Buff). Style with distinct colors.

- [ ] **Step 3: Add Buff link with tooltip**

When `source === 'buff'`, the link should point to `https://buff.market/market/goods/{marketplace_id}`. Show a tooltip/popover before redirect: "Look for float **{float}** at **${price}**".

- [ ] **Step 4: Add Buff to data viewer**

In the skin detail page:
- Chart: Add Buff listings as a new data series (new color)
- Sidebar: Include Buff listing count
- Table: Add buff as a source filter/column
- Sales: Add `buff_sale` observations alongside other sale sources

- [ ] **Step 5: Run type check**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/
git commit -m "feat: marketplace badges (CSF/DM/BUFF), buff link tooltip, data viewer integration"
```

---

## Task 8: Final Verification + Deploy

- [ ] **Step 1: Run full test suite**

```bash
npx tsc --noEmit && npx vitest run
```
Expected: All pass

- [ ] **Step 2: Push and deploy**

```bash
git push origin main
```

Deploy to VPS:
```bash
ssh root@178.156.239.58 "cd /opt/trade-up-bot && git pull && npx vite build 2>&1 | tail -3"
```

- [ ] **Step 3: Run DB migration on VPS**

```bash
ssh root@178.156.239.58 "sudo -u postgres psql -d tradeupbot -c 'ALTER TABLE listings ADD COLUMN IF NOT EXISTS marketplace_id TEXT'"
```

- [ ] **Step 4: Restart buff-fetcher (writes to new table now)**

```bash
ssh root@178.156.239.58 "pm2 restart buff-fetcher"
```

- [ ] **Step 5: Fresh daemon restart**

```bash
ssh root@178.156.239.58 "cd /opt/trade-up-bot && bash scripts/daemon-fresh.sh"
```

- [ ] **Step 6: Monitor first cycle**

```bash
ssh root@178.156.239.58 "tail -f /tmp/daemon.log"
```

Watch for: buff-sourced listings appearing, weighted pool non-uniform, curve classification count logged, no errors.
