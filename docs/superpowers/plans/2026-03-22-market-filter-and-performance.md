# Market Filter & API Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "filter by market" checkboxes to the trade-up table and fix catastrophic cold query performance (60s timeouts → sub-second).

**Architecture:** Denormalized `input_sources TEXT[]` column on `trade_ups` for O(1) market filtering via Postgres `<@` operator + GIN index. Partial indexes for the universal WHERE clause. Capped COUNT for filtered queries. `/api/status` gated behind admin + parallelized.

**Tech Stack:** PostgreSQL (arrays, GIN indexes, partial indexes), Redis, Express, React, Vitest

**Spec:** `docs/superpowers/specs/2026-03-22-market-filter-and-performance-design.md`

---

### Task 1: Schema — Add `input_sources` column + test schema

**Files:**
- Modify: `server/db.ts:113-133` (trade_ups CREATE TABLE), `server/db.ts:380-426` (indexes)
- Modify: `tests/integration/setup.ts:93-126` (test trade_ups + trade_up_inputs schema)
- Test: `tests/integration/market-filter.test.ts` (new)

- [ ] **Step 1: Write failing integration test for `input_sources` column existence**

```typescript
// tests/integration/market-filter.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp, type TestContext } from "./setup.js";

describe("market filter", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("trade_ups table has input_sources column", async () => {
    const { rows } = await ctx.pool.query(`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'trade_ups' AND column_name = 'input_sources'
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].data_type).toBe("ARRAY");
  });

  it("input_sources defaults to empty array", async () => {
    const { rows } = await ctx.pool.query(`
      INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, type, outcomes_json)
      VALUES (1000, 1500, 500, 50.0, 'classified_covert', '[]')
      RETURNING input_sources
    `);
    expect(rows[0].input_sources).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/market-filter.test.ts`
Expected: FAIL — column `input_sources` does not exist

- [ ] **Step 3: Add `input_sources` column to production schema**

In `server/db.ts`, add after line 132 (`created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`), before the closing `);`:
```sql
,input_sources TEXT[] NOT NULL DEFAULT '{}'
```

Also add the `ALTER TABLE` migration for existing databases (after the CREATE TABLE block, around line 147):
```sql
ALTER TABLE trade_ups ADD COLUMN IF NOT EXISTS input_sources TEXT[] NOT NULL DEFAULT '{}';
```

- [ ] **Step 4: Add `input_sources` column to test schema**

In `tests/integration/setup.ts`, add to the `trade_ups` CREATE TABLE (after line 112, before `);`):
```sql
,input_sources TEXT[] NOT NULL DEFAULT '{}'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/integration/market-filter.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/db.ts tests/integration/setup.ts tests/integration/market-filter.test.ts
git commit -m "feat: add input_sources column to trade_ups schema"
```

---

### Task 2: Schema — Add partial indexes + GIN index

**Files:**
- Modify: `server/db.ts:380-426` (index creation block)

- [ ] **Step 1: Add new partial indexes and GIN index**

In `server/db.ts`, add a new `await pool.query(...)` block after the existing index block (after line 426):

```sql
-- Partial indexes for API hot path (active, non-theoretical trade-ups)
CREATE INDEX IF NOT EXISTS idx_tu_active_profit ON trade_ups(profit_cents DESC)
  WHERE is_theoretical = false AND listing_status = 'active';
CREATE INDEX IF NOT EXISTS idx_tu_active_roi ON trade_ups(roi_percentage DESC)
  WHERE is_theoretical = false AND listing_status = 'active';
CREATE INDEX IF NOT EXISTS idx_tu_active_chance ON trade_ups(chance_to_profit DESC)
  WHERE is_theoretical = false AND listing_status = 'active';
CREATE INDEX IF NOT EXISTS idx_tu_active_cost ON trade_ups(total_cost_cents ASC)
  WHERE is_theoretical = false AND listing_status = 'active';
CREATE INDEX IF NOT EXISTS idx_tu_active_ev ON trade_ups(expected_value_cents DESC)
  WHERE is_theoretical = false AND listing_status = 'active';
CREATE INDEX IF NOT EXISTS idx_tu_active_created ON trade_ups(created_at DESC)
  WHERE is_theoretical = false AND listing_status = 'active';
CREATE INDEX IF NOT EXISTS idx_tu_active_best ON trade_ups(best_case_cents DESC)
  WHERE is_theoretical = false AND listing_status = 'active';
CREATE INDEX IF NOT EXISTS idx_tu_active_worst ON trade_ups(worst_case_cents DESC)
  WHERE is_theoretical = false AND listing_status = 'active';

-- GIN index for market filter array containment
CREATE INDEX IF NOT EXISTS idx_tu_active_sources ON trade_ups USING GIN(input_sources)
  WHERE is_theoretical = false AND listing_status = 'active';

-- Index on trade_up_inputs.source for backfill + consistency queries
CREATE INDEX IF NOT EXISTS idx_tui_source ON trade_up_inputs(source);
```

Do NOT drop old indexes yet — they serve the `include_stale` query path. Can be cleaned up later.

- [ ] **Step 2: Run existing tests to verify no regression**

Run: `npx vitest run tests/integration/`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add server/db.ts
git commit -m "feat: add partial indexes for API hot path + GIN index for market filter"
```

---

### Task 3: `input_sources` consistency — `saveTradeUps`

**Files:**
- Modify: `server/engine/db-save.ts:64-102` (saveTradeUps INSERT)
- Test: `tests/integration/market-filter.test.ts`

- [ ] **Step 1: Write failing test for `input_sources` set on save**

Add to `tests/integration/market-filter.test.ts`:

```typescript
import { saveTradeUps } from "../../server/engine/db-save.js";
import type { TradeUp, TradeUpInput, TradeUpOutcome } from "../../shared/types.js";

function makeMarketTradeUp(sources: string[]): TradeUp {
  const inputs: TradeUpInput[] = sources.map((source, i) => ({
    listing_id: `test-${source}-${Date.now()}-${i}`,
    skin_id: "skin-classified-1",
    skin_name: "AK-47 | Test Skin",
    collection_name: "Test Collection Alpha",
    price_cents: 1000,
    float_value: 0.15,
    condition: "Field-Tested" as const,
    source,
  }));
  const outcomes: TradeUpOutcome[] = [{
    skin_id: "skin-covert-1", skin_name: "AK-47 | Fire Serpent",
    collection_name: "Test Collection Alpha", probability: 1.0,
    predicted_float: 0.15, predicted_condition: "Field-Tested" as const,
    estimated_price_cents: 15000,
  }];
  return {
    id: 0, inputs, outcomes, total_cost_cents: 10000,
    expected_value_cents: 15000, profit_cents: 5000,
    roi_percentage: 50, created_at: new Date().toISOString(),
  };
}

describe("input_sources consistency", () => {
  it("saveTradeUps sets input_sources from input sources", async () => {
    // Insert required listings first
    const tu = makeMarketTradeUp(["csfloat", "csfloat", "dmarket"]);
    for (const inp of tu.inputs) {
      await ctx.pool.query(
        "INSERT INTO listings (id, skin_id, price_cents, float_value, source) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING",
        [inp.listing_id, inp.skin_id, inp.price_cents, inp.float_value, inp.source]
      );
    }
    await saveTradeUps(ctx.pool, [tu], false, "classified_covert", false, "discovery");

    const { rows } = await ctx.pool.query(
      "SELECT input_sources FROM trade_ups ORDER BY id DESC LIMIT 1"
    );
    expect(rows[0].input_sources.sort()).toEqual(["csfloat", "dmarket"]);
  });

  it("saveTradeUps sets input_sources for single-market trade-up", async () => {
    const tu = makeMarketTradeUp(["dmarket", "dmarket", "dmarket"]);
    for (const inp of tu.inputs) {
      await ctx.pool.query(
        "INSERT INTO listings (id, skin_id, price_cents, float_value, source) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING",
        [inp.listing_id, inp.skin_id, inp.price_cents, inp.float_value, inp.source]
      );
    }
    await saveTradeUps(ctx.pool, [tu], false, "classified_covert", false, "discovery");

    const { rows } = await ctx.pool.query(
      "SELECT input_sources FROM trade_ups ORDER BY id DESC LIMIT 1"
    );
    expect(rows[0].input_sources).toEqual(["dmarket"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/market-filter.test.ts`
Expected: FAIL — `input_sources` is `[]` (empty default), not computed

- [ ] **Step 3: Modify `saveTradeUps` to compute and insert `input_sources`**

In `server/engine/db-save.ts`, modify the trade_ups INSERT (lines 68-84):

Add `input_sources` to the INSERT column list and compute it from inputs:

```typescript
// Before the INSERT, compute input_sources
const inputSources = [...new Set(tu.inputs.map(i => i.source ?? "csfloat"))].sort();

// In the INSERT statement, add input_sources as column 12
const { rows } = await client.query(`
  INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, chance_to_profit, type, best_case_cents, worst_case_cents, is_theoretical, source, outcomes_json, input_sources)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  RETURNING id
`, [
  tu.total_cost_cents, tu.expected_value_cents, tu.profit_cents,
  tu.roi_percentage, chanceToProfit, type, bestCase, worstCase,
  isTheoretical, source, JSON.stringify(tu.outcomes), inputSources
]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/market-filter.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite to verify no regression**

Run: `npx vitest run tests/unit/ tests/integration/`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add server/engine/db-save.ts tests/integration/market-filter.test.ts
git commit -m "feat: compute input_sources on saveTradeUps"
```

---

### Task 4: `input_sources` consistency — `mergeTradeUps`

**Files:**
- Modify: `server/engine/db-save.ts:215-231` (mergeTradeUps INSERT path)
- Test: `tests/integration/market-filter.test.ts`

- [ ] **Step 1: Write failing test for `mergeTradeUps` setting `input_sources`**

Add to the `input_sources consistency` describe block:

```typescript
import { mergeTradeUps } from "../../server/engine/db-save.js";

it("mergeTradeUps sets input_sources on insert", async () => {
  const tu = makeMarketTradeUp(["dmarket", "csfloat"]);
  for (const inp of tu.inputs) {
    await ctx.pool.query(
      "INSERT INTO listings (id, skin_id, price_cents, float_value, source) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING",
      [inp.listing_id, inp.skin_id, inp.price_cents, inp.float_value, inp.source]
    );
  }
  await mergeTradeUps(ctx.pool, [tu], "classified_covert");

  const { rows } = await ctx.pool.query(
    "SELECT input_sources FROM trade_ups ORDER BY id DESC LIMIT 1"
  );
  expect(rows[0].input_sources.sort()).toEqual(["csfloat", "dmarket"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/market-filter.test.ts`
Expected: FAIL — `input_sources` is `[]`

- [ ] **Step 3: Modify `mergeTradeUps` INSERT to include `input_sources`**

In `server/engine/db-save.ts`, modify the INSERT in the `mergeTradeUps` insert batch (lines 215-219):

```typescript
// Compute input_sources before the INSERT
const inputSources = [...new Set(tu.inputs.map(i => i.source ?? "csfloat"))].sort();

const { rows } = await client.query(`
  INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, chance_to_profit, type, best_case_cents, worst_case_cents, is_theoretical, source, outcomes_json, input_sources)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, 'discovery', $9, $10)
  RETURNING id
`, [tu.total_cost_cents, tu.expected_value_cents, tu.profit_cents, tu.roi_percentage, chanceToProfit, type, bestCase, worstCase, JSON.stringify(tu.outcomes), inputSources]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/market-filter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/engine/db-save.ts tests/integration/market-filter.test.ts
git commit -m "feat: compute input_sources on mergeTradeUps insert"
```

---

### Task 5: `input_sources` consistency — Revival (`db-revive.ts`)

**Note on `db-status.ts`:** The spec lists `cascadeTradeUpStatuses` as a mutation point, but examining the code, it only updates `listing_status`/`preserved_at` on `trade_ups` and deletes entire rows — it never modifies `trade_up_inputs`. No `input_sources` recomputation is needed there.

**Files:**
- Modify: `server/engine/db-revive.ts:191-199` (input replacement block)
- Test: `tests/integration/market-filter.test.ts`

- [ ] **Step 1: Write failing test for revival recomputing `input_sources`**

Add to the `input_sources consistency` describe block. This test creates a csfloat-only trade-up, then replaces its inputs with mixed sources (simulating revival), and checks that `input_sources` is NOT automatically updated (the failing state before our fix):

```typescript
it("input_sources becomes stale after manual input replacement (before fix)", async () => {
  // Create trade-up with csfloat-only inputs
  const tu = makeMarketTradeUp(["csfloat", "csfloat", "csfloat"]);
  for (const inp of tu.inputs) {
    await ctx.pool.query(
      "INSERT INTO listings (id, skin_id, price_cents, float_value, source) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING",
      [inp.listing_id, inp.skin_id, inp.price_cents, inp.float_value, inp.source]
    );
  }
  await saveTradeUps(ctx.pool, [tu], false, "classified_covert", false, "discovery");

  const { rows: [saved] } = await ctx.pool.query(
    "SELECT id, input_sources FROM trade_ups ORDER BY id DESC LIMIT 1"
  );
  expect(saved.input_sources).toEqual(["csfloat"]);

  // Replace inputs with mixed sources (simulating what db-revive does)
  await ctx.pool.query("DELETE FROM trade_up_inputs WHERE trade_up_id = $1", [saved.id]);
  const newSources = ["dmarket", "dmarket", "csfloat"];
  for (let i = 0; i < newSources.length; i++) {
    const lid = `revival-${Date.now()}-${i}`;
    await ctx.pool.query(
      "INSERT INTO listings (id, skin_id, price_cents, float_value, source) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING",
      [lid, "skin-classified-1", 1000, 0.15, newSources[i]]
    );
    await ctx.pool.query(
      "INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
      [saved.id, lid, "skin-classified-1", "AK-47 | Test Skin", "Test Collection Alpha", 1000, 0.15, "Field-Tested", newSources[i]]
    );
  }

  // Without the fix, input_sources is still ["csfloat"] — stale!
  const { rows: [stale] } = await ctx.pool.query(
    "SELECT input_sources FROM trade_ups WHERE id = $1", [saved.id]
  );
  // This SHOULD be ["csfloat", "dmarket"] after the fix
  expect(stale.input_sources.sort()).toEqual(["csfloat", "dmarket"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/market-filter.test.ts`
Expected: FAIL — `input_sources` is still `["csfloat"]` (not recomputed after input replacement)

- [ ] **Step 3: Add `input_sources` recomputation to `db-revive.ts`**

In `server/engine/db-revive.ts`, after the input replacement loop (after line 199, before `revived++`), add:

```typescript
// Recompute input_sources after replacing inputs
await client.query(`
  UPDATE trade_ups SET input_sources = COALESCE((
    SELECT ARRAY_AGG(DISTINCT source ORDER BY source) FROM trade_up_inputs WHERE trade_up_id = $1
  ), '{}') WHERE id = $1
`, [tu.id]);
```

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run tests/unit/ tests/integration/`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add server/engine/db-revive.ts tests/integration/market-filter.test.ts
git commit -m "feat: recompute input_sources after revival input replacement"
```

---

### Task 6: Backend — Market filter on `/api/trade-ups`

**Files:**
- Modify: `server/routes/trade-ups.ts:54-74` (query param destructuring), `server/routes/trade-ups.ts:139-143` (type filter section), `server/routes/trade-ups.ts:242-243` (hasExtraFilters)
- Test: `tests/integration/market-filter.test.ts`

- [ ] **Step 1: Write failing integration test for market filter API**

Add to `tests/integration/market-filter.test.ts`:

```typescript
import request from "supertest";
// Requires: npm install -D supertest @types/supertest (if not already installed)

describe("GET /api/trade-ups?markets=", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();

    // Seed: 2 csfloat-only trade-ups, 1 dmarket-only, 1 mixed
    const sources = [
      ["csfloat", "csfloat"],
      ["csfloat", "csfloat"],
      ["dmarket", "dmarket"],
      ["csfloat", "dmarket"],
    ];

    for (const srcs of sources) {
      const tu = makeMarketTradeUp(srcs);
      for (const inp of tu.inputs) {
        await ctx.pool.query(
          "INSERT INTO listings (id, skin_id, price_cents, float_value, source) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING",
          [inp.listing_id, inp.skin_id, inp.price_cents, inp.float_value, inp.source]
        );
      }
      await saveTradeUps(ctx.pool, [tu], false, "classified_covert", false, "discovery");
    }
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("no markets param returns all trade-ups", async () => {
    const res = await request(ctx.app).get("/api/trade-ups?sort=profit&order=desc&page=1&per_page=50");
    expect(res.status).toBe(200);
    expect(res.body.trade_ups.length).toBe(4);
  });

  it("markets=csfloat returns only csfloat-only trade-ups", async () => {
    const res = await request(ctx.app).get("/api/trade-ups?markets=csfloat&sort=profit&order=desc&page=1&per_page=50");
    expect(res.status).toBe(200);
    expect(res.body.trade_ups.length).toBe(2);
  });

  it("markets=dmarket returns only dmarket-only trade-ups", async () => {
    const res = await request(ctx.app).get("/api/trade-ups?markets=dmarket&sort=profit&order=desc&page=1&per_page=50");
    expect(res.status).toBe(200);
    expect(res.body.trade_ups.length).toBe(1);
  });

  it("markets=csfloat,dmarket returns all (pure + mixed)", async () => {
    const res = await request(ctx.app).get("/api/trade-ups?markets=csfloat,dmarket&sort=profit&order=desc&page=1&per_page=50");
    expect(res.status).toBe(200);
    expect(res.body.trade_ups.length).toBe(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/market-filter.test.ts`
Expected: FAIL — `markets` param is ignored, all 4 returned for every query

- [ ] **Step 3: Add `markets` filter to the trade-ups route**

In `server/routes/trade-ups.ts`:

1. Add `markets` to the destructured query params (line 74, after `my_claims`):
```typescript
markets,
```

2. After the type filter section (after line 142), add the market filter:
```typescript
// Market filter: input_sources must be subset of selected markets
if (markets) {
  const marketList = (markets as string).split(",").map(m => m.trim()).filter(Boolean);
  if (marketList.length > 0) {
    where += ` AND t.input_sources <@ $${paramIndex++}::text[]`;
    params.push(marketList);
  }
}
```

3. Add `markets` to the `hasExtraFilters` check (line 242-243):
```typescript
const hasExtraFilters = !!(min_profit || max_profit || min_roi || max_roi || max_cost || min_cost ||
  min_chance || max_chance || max_outcomes || skin || collection || max_loss || min_win || my_claims === "true" || markets);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/market-filter.test.ts`
Expected: PASS

- [ ] **Step 5: Extend `/api/filter-options` to include market sources**

In `server/routes/trade-ups.ts`, in the filter-options route (around line 28-46), add a markets query to the DB fallback path:

```typescript
// After the collections query, add:
const { rows: marketRows } = await pool.query(
  "SELECT source as name, COUNT(DISTINCT trade_up_id) as count FROM trade_up_inputs GROUP BY source ORDER BY count DESC"
);
const result = { skins: skinMap, collections, markets: marketRows };
```

Also extend the daemon pre-warm in `server/daemon/index.ts` (after line 622) to include markets in the `filter_opts` cache:

```typescript
const { rows: marketRows } = await pool.query(
  "SELECT source as name, COUNT(DISTINCT trade_up_id) as count FROM trade_up_inputs GROUP BY source ORDER BY count DESC"
);
await cacheSet("filter_opts", { skins: skinMap, collections, markets: marketRows }, 600);
```

- [ ] **Step 6: Commit**

```bash
git add server/routes/trade-ups.ts server/daemon/index.ts tests/integration/market-filter.test.ts
git commit -m "feat: add markets filter param to /api/trade-ups + filter-options"
```

---

### Task 7: Backend — Capped COUNT for filtered queries

**Files:**
- Modify: `server/routes/trade-ups.ts:288-296` (COUNT query for filtered path)
- Test: `tests/integration/market-filter.test.ts`

- [ ] **Step 1: Write test for capped count behavior**

Add to `tests/integration/market-filter.test.ts`:

```typescript
describe("capped COUNT", () => {
  it("returns exact count when under cap", async () => {
    // With only 4 seeded trade-ups, count should be exact
    const res = await request(ctx.app).get("/api/trade-ups?min_profit=1&sort=profit&order=desc&page=1&per_page=50");
    expect(res.status).toBe(200);
    expect(res.body.total).toBeLessThan(10001);
  });
});
```

- [ ] **Step 2: Modify the COUNT query to use capped subquery**

In `server/routes/trade-ups.ts`, replace the filtered COUNT block (lines 290-296):

```typescript
// Capped COUNT: stop scanning after 10,001 rows for filtered queries
const { rows: [countRow] } = await pool.query(
  `SELECT COUNT(*) as c FROM (SELECT 1 FROM trade_ups t ${where} LIMIT 10001) sub`,
  params
);
total = parseInt(countRow?.c) || 0;
totalProfitable = 0; // Not available for filtered queries (arbitrary subset would be meaningless)
```

- [ ] **Step 3: Run tests to verify pass**

Run: `npx vitest run tests/integration/`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add server/routes/trade-ups.ts tests/integration/market-filter.test.ts
git commit -m "perf: cap COUNT at 10,001 for filtered trade-up queries"
```

---

### Task 8: `/api/status` — Gate behind admin + parallelize

**Files:**
- Modify: `src/hooks/useStatus.ts` (add `enabled` parameter)
- Modify: `src/App.tsx:233` (gate behind admin), `src/App.tsx:239-249` (newDataHint from global_stats)
- Modify: `server/routes/status.ts:12-144` (parallelize queries)

- [ ] **Step 1: Add `enabled` parameter to `useStatus` hook**

In `src/hooks/useStatus.ts`, modify the hook signature and add early returns:

```typescript
export function useStatus(enabled = true, pollInterval = 60_000) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [diffs, setDiffs] = useState<StatusDiffs>({ knife_trade_ups: 0, knife_profitable: 0, covert_trade_ups: 0, covert_profitable: 0 });
  const [newDataHint, setNewDataHint] = useState(false);
  const prevCount = useRef(0);
  const prevStatus = useRef<SyncStatus | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!enabled) return null;
    // ... rest of existing fetchStatus
  }, [enabled]);

  // Initial fetch — only if enabled
  useEffect(() => {
    if (enabled) fetchStatus();
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // Background polling — only if enabled
  useEffect(() => {
    if (!enabled) return;
    const checkInterval = setInterval(async () => {
      // ... existing polling logic
    }, pollInterval);
    return () => { clearInterval(checkInterval); };
  }, [enabled, fetchStatus, pollInterval]);

  // ... rest unchanged

  return { status, diffs, newDataHint, refresh };
}
```

- [ ] **Step 2: Gate `useStatus` behind admin in `App.tsx`**

In `src/App.tsx` line 233, change:
```typescript
// Before:
const { status, newDataHint, refresh } = useStatus();

// After:
const { status, newDataHint: statusHint, refresh } = useStatus(userIsAdmin);
```

- [ ] **Step 3: Add `newDataHint` based on `global_stats` for all users**

In `src/App.tsx`, in the global-stats polling effect (around lines 239-249), add change detection:

```typescript
const prevTotalRef = useRef(0);
const [globalNewData, setGlobalNewData] = useState(false);

useEffect(() => {
  const fetchStats = () =>
    fetch("/api/global-stats", { credentials: "include" })
      .then(r => r.json())
      .then((data: GlobalStats) => {
        setGlobalStats(data);
        if (prevTotalRef.current > 0 && data.total_trade_ups !== prevTotalRef.current) {
          setGlobalNewData(true);
        }
        prevTotalRef.current = data.total_trade_ups;
      })
      .catch(() => {});
  fetchStats();
  const interval = setInterval(fetchStats, 60_000);
  return () => clearInterval(interval);
}, []);

// Combine both hints
const newDataHint = statusHint || globalNewData;
```

Update the Refresh button click handler to also clear `globalNewData`:
```typescript
const handleRefresh = useCallback(() => {
  setGlobalNewData(false);
  refresh();
  // ... existing refresh logic
}, [refresh]);
```

- [ ] **Step 4: Parallelize `/api/status` queries**

In `server/routes/status.ts`:

1. Bump cache TTL: line 12, change `cachedRoute("status", 60, ...)` → `cachedRoute("status", 1800, ...)`

2. Parallelize the `listingStats` helper (lines 13-26): its 2 internal queries should use `Promise.all` instead of sequential awaits.

3. Wrap the 12 independent query calls (lines 28-139) in `Promise.all`. Keep each query's existing code but move from sequential `await` to parallel. The structure:

```typescript
const [
  classified,
  covert,
  covertPrices,
  tuStats,
  knifeTu,
  topCollections,
  totalSkins,
  totalListings,
  knifeGloveSkins,
  knifeGloveWithListings,
  knifeGloveListings,
  collectionCount,
] = await Promise.all([
  listingStats("Classified"),
  listingStats("Covert", true),
  pool.query(/* covert prices query — same SQL as current line 31-36 */),
  pool.query(/* tuStats GROUP BY type — same SQL as current line 38-43 */),
  (async () => {
    // knifeTu query — same try/catch as current lines 46-64
    try {
      const { rows: [row] } = await pool.query(/* same SQL */);
      return { cnt: parseInt(row.cnt) || 0, /* ... same parsing ... */ };
    } catch { return { cnt: 0, profitable: 0, active: 0, partial: 0, stale: 0 }; }
  })(),
  pool.query(/* top collections — same SQL as line 69-72 */),
  pool.query(/* total skins — same SQL as line 117 */),
  pool.query(/* total listings — same SQL as line 121 */),
  pool.query(/* knife/glove skins — same SQL as line 125 */),
  pool.query(/* knife/glove with listings — same SQL as line 129 */),
  pool.query(/* knife/glove listings — same SQL as line 133 */),
  pool.query(/* collection count — same SQL as line 137 */),
]);
```

The result assembly (lines 74-141) stays the same — just reference the destructured variables instead of the sequential results. Keep `getSyncMeta` calls (daemon_status, exploration_stats) sequential after the Promise.all since they're fast key lookups.

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/integration/ tests/unit/`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useStatus.ts src/App.tsx server/routes/status.ts
git commit -m "perf: gate /api/status behind admin, parallelize queries, bump cache TTL"
```

---

### Task 9: Daemon — Pre-warm status cache

**Files:**
- Modify: `server/daemon/index.ts:594-632` (Redis pre-populate section)

- [ ] **Step 1: Add status pre-computation after global_stats**

In `server/daemon/index.ts`, after the `global_stats` cacheSet (after line 618), add status pre-computation. Compute the full `SyncStatus` object and write to Redis with key `"status"` and TTL 1800:

```typescript
// Pre-compute /api/status data so API never hits cold DB
try {
  const listingStatsQuery = async (rarity: string, excludeKnives = false) => {
    const knifeFilter = excludeKnives ? "AND s.name NOT LIKE '★%'" : "";
    const { rows: [r] } = await pool.query(`
      SELECT COUNT(l.id) as total_listings, COUNT(DISTINCT s.name) as skins_with_listings
      FROM listings l JOIN skins s ON l.skin_id = s.id
      WHERE s.rarity = $1 AND s.stattrak = false ${knifeFilter}
    `, [rarity]);
    const knifeFilterNoAlias = excludeKnives ? "AND name NOT LIKE '★%'" : "";
    const { rows: [totalRow] } = await pool.query(
      `SELECT COUNT(DISTINCT name) as c FROM skins WHERE rarity = $1 AND stattrak = false ${knifeFilterNoAlias}`, [rarity]
    );
    return { listings: parseInt(r.total_listings), skins: parseInt(r.skins_with_listings), total: parseInt(totalRow.c) };
  };

  // Run all status queries in parallel
  const [classified, covert, covertPrices, tuStats, knifeTu,
         topCollections, totalSkins, totalListings,
         knifeGloveSkins, knifeGloveWithListings, knifeGloveListings,
         collectionCount] = await Promise.all([
    listingStatsQuery("Classified"),
    listingStatsQuery("Covert", true),
    pool.query(`SELECT (SELECT COUNT(*) FROM price_data WHERE source = 'csfloat_sales') as sale_prices, (SELECT COUNT(*) FROM price_data WHERE source = 'csfloat_ref') as ref_prices, (SELECT COUNT(*) FROM sale_history) as total_sales`),
    pool.query(`SELECT type, COUNT(*) as cnt, SUM(CASE WHEN profit_cents > 0 THEN 1 ELSE 0 END) as profitable FROM trade_ups GROUP BY type`),
    pool.query(`SELECT COUNT(*) as cnt, SUM(CASE WHEN profit_cents > 0 THEN 1 ELSE 0 END) as profitable, SUM(CASE WHEN listing_status = 'active' THEN 1 ELSE 0 END) as active, SUM(CASE WHEN listing_status = 'partial' THEN 1 ELSE 0 END) as partial, SUM(CASE WHEN listing_status = 'stale' THEN 1 ELSE 0 END) as stale FROM trade_ups WHERE type = 'covert_knife' AND is_theoretical = false`),
    pool.query(`SELECT collection_name, priority_score, profitable_count, avg_profit_cents FROM collection_scores ORDER BY priority_score DESC LIMIT 5`),
    pool.query("SELECT COUNT(DISTINCT name) as c FROM skins WHERE stattrak = false"),
    pool.query("SELECT COUNT(*) as c FROM listings"),
    pool.query("SELECT COUNT(DISTINCT name) as c FROM skins WHERE name LIKE '★%' AND stattrak = false"),
    pool.query("SELECT COUNT(DISTINCT s.name) as c FROM skins s JOIN listings l ON s.id = l.skin_id WHERE s.name LIKE '★%' AND s.stattrak = false"),
    pool.query("SELECT COUNT(*) as c FROM listings l JOIN skins s ON l.skin_id = s.id WHERE s.name LIKE '★%' AND s.stattrak = false"),
    pool.query("SELECT COUNT(DISTINCT c.id) as c FROM collections c JOIN skin_collections sc ON c.id = sc.collection_id"),
  ]);

  // Assemble and cache (matches SyncStatus shape from /api/status)
  // ... assemble statusData object from results ...
  await cacheSet("status", statusData, 1800);
} catch (e) {
  console.error(`  Status pre-compute failed: ${(e as Error).message}`);
}
```

**Important:** Extract the query execution + assembly into a shared `buildStatusData(pool)` helper function (e.g., in `server/routes/status-helpers.ts`) that both the `/api/status` route and the daemon pre-warm can call. This avoids duplicating ~100 lines of query + assembly logic. The helper returns the full `SyncStatus` object. Both callers just do:

```typescript
const statusData = await buildStatusData(pool);
// Route: res.json(statusData)
// Daemon: await cacheSet("status", statusData, 1800)
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/unit/ tests/integration/`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add server/daemon/index.ts
git commit -m "perf: daemon pre-warms /api/status cache to Redis each cycle"
```

---

### Task 10: Frontend — Market checkboxes in FilterBar

**Files:**
- Modify: `src/components/FilterBar.tsx:11-24` (Filters interface), `src/components/FilterBar.tsx:26-39` (EMPTY_FILTERS), `src/components/FilterBar.tsx:41-56` (filtersToParams), `src/components/FilterBar.tsx:58-61` (hasActiveFilters), `src/components/FilterBar.tsx:201-253` (FilterChips), `src/components/FilterBar.tsx:294-336` (FilterBar JSX)
- Modify: `src/pages/TradeUpsPage.tsx:62-80` (URL param parsing), `src/pages/TradeUpsPage.tsx:244-246` (capped count display)

- [ ] **Step 1: Add `markets` to `Filters` interface and constants**

In `src/components/FilterBar.tsx`:

Add to `Filters` interface (line 23, before closing `}`):
```typescript
markets: string[];
```

Add to `EMPTY_FILTERS` (line 38, before closing `}`):
```typescript
markets: [],
```

Add hardcoded market options at top of file:
```typescript
const AVAILABLE_MARKETS = [
  { value: "csfloat", label: "CSFloat" },
  { value: "dmarket", label: "DMarket" },
] as const;
```

- [ ] **Step 2: Add `markets` to `filtersToParams` and `hasActiveFilters`**

In `filtersToParams` (after line 54):
```typescript
if (f.markets.length) params.set("markets", f.markets.join(","));
```

In `hasActiveFilters` (line 59-61), add `f.markets.length > 0` to the check.

- [ ] **Step 3: Add market chips to `FilterChips`**

In `FilterChips` (after the collections loop, around line 209):
```typescript
if (filters.markets.length > 0) {
  const labels = filters.markets.map(m => AVAILABLE_MARKETS.find(am => am.value === m)?.label ?? m);
  chips.push({
    label: `Markets: ${labels.join(", ")}`,
    onRemove: () => onUpdate({ ...filters, markets: [] }),
  });
}
```

- [ ] **Step 4: Add market checkboxes to `FilterBar` JSX**

In `FilterBar` component, add after the autocomplete inputs `</div>` (after line 311), before the range filters `<div>`:

```tsx
<div className="flex gap-2.5 items-center shrink-0">
  {AVAILABLE_MARKETS.map(m => (
    <label key={m.value} className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer select-none">
      <input
        type="checkbox"
        checked={filters.markets.includes(m.value)}
        onChange={(e) => {
          const next = e.target.checked
            ? [...filters.markets, m.value]
            : filters.markets.filter(x => x !== m.value);
          update({ markets: next });
        }}
        className="rounded border-border"
      />
      {m.label}
    </label>
  ))}
</div>
```

- [ ] **Step 5: Parse `markets` from URL in `TradeUpsPage.tsx`**

In `src/pages/TradeUpsPage.tsx`, add to the URL param parsing block (after line 78):
```typescript
const marketsParam = searchParams.get("markets");
if (marketsParam) f.markets = marketsParam.split(",");
```

- [ ] **Step 6: Handle capped count display**

In `src/pages/TradeUpsPage.tsx`, modify the total display (line 244-246):

```tsx
{total > 0 && (
  <span className={`text-xs text-muted-foreground whitespace-nowrap ${loading ? "opacity-50" : ""}`}>
    {total >= 10001 ? "10,000+" : total.toLocaleString()} found{totalProfitable > 0 && <> (<span className="text-green-500">{totalProfitable.toLocaleString()} profitable</span>)</>}
  </span>
)}
```

- [ ] **Step 7: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add src/components/FilterBar.tsx src/pages/TradeUpsPage.tsx
git commit -m "feat: add market filter checkboxes to trade-up table UI"
```

---

### Task 11: Backfill migration script

**Files:**
- Create: `scripts/backfill-input-sources.ts`

- [ ] **Step 1: Write backfill script**

```typescript
// scripts/backfill-input-sources.ts
// One-time migration: populate input_sources for all existing trade-ups.
// Run on VPS: npx tsx scripts/backfill-input-sources.ts

import pg from "pg";
const { Pool } = pg;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  console.log("Backfilling input_sources on trade_ups...");

  // Batch to avoid locking the whole table
  const BATCH = 5000;
  let updated = 0;

  while (true) {
    const { rowCount } = await pool.query(`
      UPDATE trade_ups SET input_sources = COALESCE((
        SELECT ARRAY_AGG(DISTINCT source ORDER BY source)
        FROM trade_up_inputs WHERE trade_up_id = trade_ups.id
      ), '{}')
      WHERE id IN (
        SELECT id FROM trade_ups WHERE input_sources = '{}' LIMIT $1
      )
    `, [BATCH]);

    updated += rowCount ?? 0;
    console.log(`  Updated ${updated} trade-ups so far...`);
    if (!rowCount || rowCount < BATCH) break;
  }

  console.log(`Done. Total updated: ${updated}`);
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Commit**

```bash
git add scripts/backfill-input-sources.ts
git commit -m "feat: add one-time backfill script for input_sources column"
```

---

### Task 12: Final integration test + full suite verification

**Files:**
- Test: `tests/integration/market-filter.test.ts` (complete)

- [ ] **Step 1: Run the complete test suite**

Run: `npx vitest run tests/unit/ tests/integration/`
Expected: All PASS

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "test: finalize market filter + performance integration tests"
```
