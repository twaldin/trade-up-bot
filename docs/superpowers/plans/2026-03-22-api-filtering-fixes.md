# API Filtering & Search Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix broken skin/collection filtering, add server-side search, fix collection knife/glove display, redesign market filter UX, and optimize SQL performance.

**Architecture:** Backend changes to `/api/filter-options`, `/api/trade-ups`, `/api/skin-data`, plus a new `/api/skin-suggestions` endpoint. Frontend changes to `FilterBar.tsx` (autocomplete normalization + market pill), `DataViewer.tsx` (server-side search), and `CollectionViewer.tsx` (knife merge). DB indexes for performance.

**Tech Stack:** TypeScript, Express, PostgreSQL (pg), Redis, React, Vitest + supertest for integration tests.

**Spec:** `docs/superpowers/specs/2026-03-22-api-filtering-fixes-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `server/routes/trade-ups.ts:16-50` | `/api/filter-options` — add output skins |
| Modify | `server/routes/trade-ups.ts:190-220` | `/api/trade-ups` — AND logic for multi-skin/collection |
| Modify | `server/routes/data.ts:17-168` | `/api/skin-data` — collection knife merge for "all" tab |
| Modify | `server/routes/data.ts` (new route) | `/api/skin-suggestions` — lightweight server-side search |
| Modify | `server/daemon/index.ts:620-626` | Daemon — pre-populate filter_opts with output skins |
| Modify | `src/components/FilterBar.tsx:73-132` | AutocompleteInput — search normalization |
| Modify | `src/components/FilterBar.tsx:332-349` | Market checkboxes → pill/popover |
| Modify | `src/components/FilterBar.tsx:218-227` | FilterChips — remove market chip |
| Modify | `src/components/DataViewer.tsx:140-172` | Server-side search suggestions |
| Modify | `src/components/CollectionViewer.tsx:204-210` | Pass props for knife merge in "all" tab |
| Modify | `tests/integration/setup.ts` | Add dataRouter to test app, seed knife skins |
| Create | `tests/integration/filter-options.test.ts` | Tests for filter-options with output skins |
| Create | `tests/integration/skin-filter-and.test.ts` | Tests for AND logic on multi-skin/collection |
| Create | `tests/integration/skin-suggestions.test.ts` | Tests for skin-suggestions endpoint |
| Create | `tests/integration/collection-knives.test.ts` | Tests for collection knife/glove display |

---

### Task 1: Extend test infrastructure for dataRouter

**Files:**
- Modify: `tests/integration/setup.ts`
- Modify: `tests/integration/routes.test.ts:75-84`

The test app currently doesn't mount `dataRouter`. We need it for skin-data and skin-suggestions tests. The `createExpandedApp` function must live in `setup.ts` (exported) so all test files can import it.

- [ ] **Step 1: Add sale_history table to createSchema in setup.ts**

The `data.ts` routes query `sale_history`, which is currently only in `routes.test.ts`'s `createAdditionalTables`. Add it to the base schema in `setup.ts`'s `createSchema` function (after the `price_observations` table):

```typescript
CREATE TABLE IF NOT EXISTS sale_history (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  skin_name TEXT NOT NULL,
  condition TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL,
  float_value DOUBLE PRECISION NOT NULL DEFAULT 0,
  sold_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Also add `float_price_data` table (queried by `/api/skin-data/:name`):

```typescript
CREATE TABLE IF NOT EXISTS float_price_data (
  skin_name TEXT NOT NULL,
  float_min DOUBLE PRECISION NOT NULL,
  float_max DOUBLE PRECISION NOT NULL,
  avg_price_cents INTEGER NOT NULL DEFAULT 0,
  listing_count INTEGER NOT NULL DEFAULT 0,
  last_checked TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (skin_name, float_min, float_max)
);
```

- [ ] **Step 2: Create and export createExpandedApp in setup.ts**

Add directly in `setup.ts` (not `routes.test.ts`). Import additional routers and build test knife pool:

```typescript
import { dataRouter } from "../../server/routes/data.js";
import { statusRouter } from "../../server/routes/status.js";
import { collectionsRouter } from "../../server/routes/collections.js";

export async function createExpandedApp(opts: TestAppOptions = {}): Promise<TestContext> {
  const ctx = await createTestApp(opts);

  // Additional tables needed by status/collections routers
  await ctx.pool.query(`
    CREATE TABLE IF NOT EXISTS collection_scores (
      collection_id TEXT PRIMARY KEY, collection_name TEXT NOT NULL,
      profitable_count INTEGER NOT NULL DEFAULT 0,
      avg_profit_cents INTEGER NOT NULL DEFAULT 0,
      priority_score DOUBLE PRECISION NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS daemon_cycle_stats (
      id SERIAL PRIMARY KEY, daemon_version TEXT, cycle INTEGER,
      started_at TIMESTAMPTZ, duration_ms INTEGER, api_calls_used INTEGER,
      api_limit_detected INTEGER, api_available INTEGER,
      knife_tradeups_total INTEGER, knife_profitable INTEGER,
      theories_generated INTEGER, theories_profitable INTEGER, gaps_filled INTEGER,
      cooldown_passes INTEGER, cooldown_new_found INTEGER, cooldown_improved INTEGER,
      top_profit_cents INTEGER, avg_profit_cents INTEGER,
      classified_total INTEGER DEFAULT 0, classified_profitable INTEGER DEFAULT 0,
      classified_theories INTEGER DEFAULT 0, classified_theories_profitable INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS daemon_events (
      id SERIAL PRIMARY KEY, event_type TEXT NOT NULL,
      summary TEXT, detail TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Test knife pool: "Test Collection Alpha" has Bayonet + Flip Knife
  const collectionKnifePool = new Map([
    ["Test Collection Alpha", {
      knifeTypes: ["Bayonet", "Flip Knife"],
      gloveTypes: [],
      knifeFinishes: ["Fade", "Doppler", "Vanilla"],
      gloveFinishes: [],
      finishCount: 3,
    }],
  ]);
  const knifeTypeToCases = new Map([
    ["Bayonet", ["Test Collection Alpha"]],
    ["Flip Knife", ["Test Collection Alpha"]],
  ]);

  ctx.app.use(statusRouter(ctx.pool));
  ctx.app.use(collectionsRouter(ctx.pool, collectionKnifePool));
  ctx.app.use(dataRouter(ctx.pool, knifeTypeToCases, collectionKnifePool));

  return ctx;
}
```

- [ ] **Step 3: Update routes.test.ts to import from setup.ts**

Replace the local `createExpandedApp` in `routes.test.ts` with an import:

```typescript
import { createExpandedApp, createTestApp, seedTestData, type TestContext } from "./setup.js";
```

Remove the local `createExpandedApp` function and `createAdditionalTables` (now in `setup.ts`).

- [ ] **Step 4: Add knife skin seed data to seedTestData in setup.ts**

In `seedTestData`, add knife skins that are NOT in `skin_collections` (matching real-world behavior):

```typescript
// Knife skins (not in skin_collections — mapped via CASE_KNIFE_MAP)
await pool.query(`INSERT INTO skins (id, name, weapon, rarity, min_float, max_float) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
  ["skin-knife-1", "★ Bayonet | Fade", "Bayonet", "Covert", 0.0, 0.08]);
await pool.query(`INSERT INTO skins (id, name, weapon, rarity, min_float, max_float) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
  ["skin-knife-2", "★ Flip Knife | Doppler", "Flip Knife", "Covert", 0.0, 0.08]);
await pool.query(`INSERT INTO skins (id, name, weapon, rarity, min_float, max_float) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
  ["skin-knife-3", "★ Karambit | Fade", "Karambit", "Covert", 0.0, 0.08]);
// skin-knife-3 is a Karambit NOT in Test Collection Alpha's knife pool — should not appear

// Knife listings
await pool.query(`INSERT INTO listings (id, skin_id, price_cents, float_value, source) VALUES ($1, $2, $3, $4, $5)`,
  ["listing-knife-1", "skin-knife-1", 50000, 0.01, "csfloat"]);
await pool.query(`INSERT INTO listings (id, skin_id, price_cents, float_value, source) VALUES ($1, $2, $3, $4, $5)`,
  ["listing-knife-2", "skin-knife-2", 30000, 0.03, "csfloat"]);
await pool.query(`INSERT INTO listings (id, skin_id, price_cents, float_value, source) VALUES ($1, $2, $3, $4, $5)`,
  ["listing-knife-3", "skin-knife-3", 80000, 0.02, "csfloat"]);
```

- [ ] **Step 5: Run existing tests to verify nothing broke**

Run: `npx vitest run tests/integration/ --reporter=verbose`
Expected: All existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add tests/integration/setup.ts tests/integration/routes.test.ts
git commit -m "Extend test infra: mount dataRouter, add sale_history, seed knife skins"
```

---

### Task 2: Fix /api/filter-options to include output skins

**Files:**
- Modify: `server/routes/trade-ups.ts:16-50`
- Modify: `server/daemon/index.ts:620-626`
- Create: `tests/integration/filter-options.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/integration/filter-options.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createTestApp, seedTestData, type TestContext } from "./setup.js";

describe("/api/filter-options", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
    await seedTestData(ctx.pool);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("returns input skins", async () => {
    const res = await request(ctx.app).get("/api/filter-options");
    expect(res.status).toBe(200);
    const skinNames = res.body.skins.map((s: any) => s.name);
    expect(skinNames).toContain("AK-47 | Test Skin");
  });

  it("returns output skins from outcomes_json", async () => {
    const res = await request(ctx.app).get("/api/filter-options");
    const skinNames = res.body.skins.map((s: any) => s.name);
    // AK-47 | Fire Serpent is an outcome in seed data, not an input
    expect(skinNames).toContain("AK-47 | Fire Serpent");
  });

  it("marks skins with correct input/output flags", async () => {
    const res = await request(ctx.app).get("/api/filter-options");
    const testSkin = res.body.skins.find((s: any) => s.name === "AK-47 | Test Skin");
    expect(testSkin.input).toBe(true);
    // AK-47 | Test Skin is only an input
    const fireSerpent = res.body.skins.find((s: any) => s.name === "AK-47 | Fire Serpent");
    expect(fireSerpent.output).toBe(true);
  });

  it("returns collections with counts", async () => {
    const res = await request(ctx.app).get("/api/filter-options");
    expect(res.body.collections.length).toBeGreaterThan(0);
    const alpha = res.body.collections.find((c: any) => c.name === "Test Collection Alpha");
    expect(alpha).toBeDefined();
    expect(Number(alpha.count)).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/integration/filter-options.test.ts --reporter=verbose`
Expected: "returns output skins" and "marks skins with correct input/output flags" FAIL.

- [ ] **Step 3: Implement output skin extraction in /api/filter-options**

In `server/routes/trade-ups.ts`, replace the DB fallback (lines 28-40) to also extract output skins from `outcomes_json`:

```typescript
// Input skins
const { rows: inputSkins } = await pool.query(
  `SELECT DISTINCT skin_name as name FROM trade_up_inputs`
);
// Output skins from outcomes_json
const { rows: outputSkins } = await pool.query(
  `SELECT DISTINCT elem->>'skin_name' as name
   FROM trade_ups t, json_array_elements(t.outcomes_json::json) AS elem
   WHERE t.listing_status = 'active' AND t.is_theoretical = false
     AND t.outcomes_json IS NOT NULL AND t.outcomes_json != '[]'`
);

// Merge: build map of name → { input, output }
const skinFlags = new Map<string, { input: boolean; output: boolean }>();
for (const s of inputSkins) {
  skinFlags.set(s.name, { input: true, output: false });
}
for (const s of outputSkins) {
  const existing = skinFlags.get(s.name);
  if (existing) existing.output = true;
  else skinFlags.set(s.name, { input: false, output: true });
}
const skinMap = [...skinFlags.entries()].map(([name, flags]) => ({
  name, input: flags.input, output: flags.output,
}));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/integration/filter-options.test.ts --reporter=verbose`
Expected: All PASS.

- [ ] **Step 5: Update daemon pre-population to include output skins**

In `server/daemon/index.ts` lines 620-626, replace the skin query with the same merge logic:

```typescript
const { rows: inputSkins } = await pool.query("SELECT DISTINCT skin_name as name FROM trade_up_inputs");
const { rows: outputSkins } = await pool.query(
  `SELECT DISTINCT o.skin_name as name
   FROM trade_ups t,
   json_array_elements(t.outcomes_json::json) AS o_raw,
   LATERAL (SELECT o_raw->>'skin_name' as skin_name) AS o
   WHERE t.listing_status = 'active' AND t.is_theoretical = false
     AND t.outcomes_json IS NOT NULL AND t.outcomes_json != '[]'`
);
const skinFlags = new Map<string, { input: boolean; output: boolean }>();
for (const s of inputSkins) skinFlags.set(s.name, { input: true, output: false });
for (const s of outputSkins) {
  const existing = skinFlags.get(s.name);
  if (existing) existing.output = true;
  else skinFlags.set(s.name, { input: false, output: true });
}
const skinMap = [...skinFlags.entries()].map(([name, flags]) => ({
  name, input: flags.input, output: flags.output,
}));
```

- [ ] **Step 6: Commit**

```bash
git add server/routes/trade-ups.ts server/daemon/index.ts tests/integration/filter-options.test.ts
git commit -m "Fix filter-options: include output skins with input/output flags"
```

---

### Task 3: Change /api/trade-ups to AND logic for multi-skin/collection

**Files:**
- Modify: `server/routes/trade-ups.ts:190-220`
- Create: `tests/integration/skin-filter-and.test.ts`

- [ ] **Step 1: Write failing tests for AND logic**

Create `tests/integration/skin-filter-and.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createTestApp, seedTestData, type TestContext } from "./setup.js";

describe("/api/trade-ups AND filter logic", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
    await seedTestData(ctx.pool);

    // Create a trade-up with TWO different input skins + a distinct outcome
    const outcomes = JSON.stringify([{
      skin_id: "skin-covert-1", skin_name: "AK-47 | Fire Serpent",
      collection_name: "Test Collection Alpha", probability: 0.5,
      predicted_float: 0.15, predicted_condition: "Field-Tested",
      estimated_price_cents: 20000,
    }, {
      skin_id: "skin-classified-2", skin_name: "M4A4 | Test Skin",
      collection_name: "Test Collection Beta", probability: 0.5,
      predicted_float: 0.15, predicted_condition: "Field-Tested",
      estimated_price_cents: 8000,
    }]);

    const { rows } = await ctx.pool.query(`
      INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, chance_to_profit, type, listing_status, outcomes_json, created_at)
      VALUES (5000, 14000, 9000, 180, 0.5, 'covert_knife', 'active', $1, NOW() - INTERVAL '4 hours')
      RETURNING id
    `, [outcomes]);
    const tuId = rows[0].id;

    // Mix of skins from both collections
    await ctx.pool.query(`INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [tuId, `multi-a-${tuId}`, "skin-classified-1", "AK-47 | Test Skin", "Test Collection Alpha", 1000, 0.15, "Field-Tested", "csfloat"]);
    await ctx.pool.query(`INSERT INTO listings (id, skin_id, price_cents, float_value, source) VALUES ($1, $2, $3, $4, $5)`,
      [`multi-a-${tuId}`, "skin-classified-1", 1000, 0.15, "csfloat"]);
    await ctx.pool.query(`INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [tuId, `multi-b-${tuId}`, "skin-classified-2", "M4A4 | Test Skin", "Test Collection Beta", 1000, 0.35, "Field-Tested", "csfloat"]);
    await ctx.pool.query(`INSERT INTO listings (id, skin_id, price_cents, float_value, source) VALUES ($1, $2, $3, $4, $5)`,
      [`multi-b-${tuId}`, "skin-classified-2", 1000, 0.35, "csfloat"]);
  });

  afterAll(async () => { await ctx.cleanup(); });

  it("single skin filter works (input)", async () => {
    const res = await request(ctx.app).get("/api/trade-ups?skin=AK-47+%7C+Test+Skin");
    expect(res.status).toBe(200);
    expect(res.body.trade_ups.length).toBeGreaterThan(0);
  });

  it("single skin filter works (output via outcomes_json)", async () => {
    const res = await request(ctx.app).get("/api/trade-ups?skin=AK-47+%7C+Fire+Serpent");
    expect(res.status).toBe(200);
    expect(res.body.trade_ups.length).toBeGreaterThan(0);
  });

  it("multi-skin AND: both present returns results", async () => {
    // This trade-up has AK-47 | Test Skin as input AND AK-47 | Fire Serpent as outcome
    const res = await request(ctx.app).get("/api/trade-ups?skin=AK-47+%7C+Test+Skin||AK-47+%7C+Fire+Serpent");
    expect(res.status).toBe(200);
    expect(res.body.trade_ups.length).toBeGreaterThan(0);
  });

  it("multi-skin AND: impossible combo returns zero", async () => {
    // No trade-up has both M4A4 | Test Skin as input AND some non-existent skin
    const res = await request(ctx.app).get("/api/trade-ups?skin=M4A4+%7C+Test+Skin||NonExistent+Skin");
    expect(res.status).toBe(200);
    expect(res.body.trade_ups).toHaveLength(0);
  });

  it("multi-collection AND: both present returns results", async () => {
    // The mixed trade-up has inputs from both Alpha and Beta collections
    const res = await request(ctx.app).get("/api/trade-ups?collection=Test+Collection+Alpha|Test+Collection+Beta");
    expect(res.status).toBe(200);
    expect(res.body.trade_ups.length).toBeGreaterThan(0);
  });

  it("multi-collection AND: impossible combo returns zero", async () => {
    const res = await request(ctx.app).get("/api/trade-ups?collection=Test+Collection+Alpha|NonExistent+Collection");
    expect(res.status).toBe(200);
    expect(res.body.trade_ups).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify AND tests fail (currently OR logic)**

Run: `npx vitest run tests/integration/skin-filter-and.test.ts --reporter=verbose`
Expected: "impossible combo returns zero" tests FAIL (OR logic returns results).

- [ ] **Step 3: Implement AND logic for multi-skin filter**

In `server/routes/trade-ups.ts`, replace lines 198-203 (multi-skin OR) with AND logic:

```typescript
} else if (skinNames.length > 1) {
  // Multiple exact skin names (AND) — each skin gets its own clause
  for (const skinName of skinNames) {
    where += ` AND (t.id IN (SELECT trade_up_id FROM trade_up_inputs WHERE skin_name = $${paramIndex}) OR t.outcomes_json LIKE $${paramIndex + 1})`;
    params.push(skinName, `%"skin_name":"${skinName.replace(/"/g, '\\"')}"%`);
    paramIndex += 2;
  }
}
```

- [ ] **Step 4: Implement AND logic for multi-collection filter**

In `server/routes/trade-ups.ts`, replace lines 214-219 (collection IN) with AND logic:

```typescript
if (collection) {
  const collNames = collection.split("|").map(s => s.trim()).filter(Boolean);
  for (const collName of collNames) {
    where += ` AND t.id IN (SELECT trade_up_id FROM trade_up_inputs WHERE collection_name = $${paramIndex++})`;
    params.push(collName);
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/integration/skin-filter-and.test.ts --reporter=verbose`
Expected: All PASS.

- [ ] **Step 6: Run full integration suite**

Run: `npx vitest run tests/integration/ --reporter=verbose`
Expected: All existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add server/routes/trade-ups.ts tests/integration/skin-filter-and.test.ts
git commit -m "Change multi-skin/collection filter from OR to AND logic"
```

---

### Task 4: New /api/skin-suggestions endpoint

**Files:**
- Modify: `server/routes/data.ts` (add new route after skin-data)
- Create: `tests/integration/skin-suggestions.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/integration/skin-suggestions.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createExpandedApp, seedTestData, type TestContext } from "./setup.js";

describe("/api/skin-suggestions", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createExpandedApp();
    await seedTestData(ctx.pool);
  });

  afterAll(async () => { await ctx.cleanup(); });

  it("returns 400 for query under 2 chars", async () => {
    const res = await request(ctx.app).get("/api/skin-suggestions?q=A");
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(0);
  });

  it("matches by partial name", async () => {
    const res = await request(ctx.app).get("/api/skin-suggestions?q=Test+Skin");
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeGreaterThan(0);
    expect(res.body.results[0].name).toContain("Test Skin");
  });

  it("matches knives without star character", async () => {
    const res = await request(ctx.app).get("/api/skin-suggestions?q=bayonet");
    expect(res.status).toBe(200);
    const names = res.body.results.map((r: any) => r.name);
    expect(names.some((n: string) => n.includes("Bayonet"))).toBe(true);
  });

  it("matches knives without pipe character", async () => {
    const res = await request(ctx.app).get("/api/skin-suggestions?q=bayonet+fade");
    expect(res.status).toBe(200);
    const names = res.body.results.map((r: any) => r.name);
    expect(names).toContain("★ Bayonet | Fade");
  });

  it("returns at most 15 results", async () => {
    const res = await request(ctx.app).get("/api/skin-suggestions?q=Skin");
    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeLessThanOrEqual(15);
  });

  it("includes collection_name for regular skins", async () => {
    const res = await request(ctx.app).get("/api/skin-suggestions?q=AK-47+Test");
    expect(res.status).toBe(200);
    const ak = res.body.results.find((r: any) => r.name === "AK-47 | Test Skin");
    expect(ak).toBeDefined();
    expect(ak.collection_name).toContain("Test Collection Alpha");
  });

  it("sorts by rarity rank descending (Covert first)", async () => {
    const res = await request(ctx.app).get("/api/skin-suggestions?q=AK");
    expect(res.status).toBe(200);
    if (res.body.results.length >= 2) {
      const rarityOrder = ["Consumer Grade", "Industrial Grade", "Mil-Spec", "Restricted", "Classified", "Covert", "Extraordinary"];
      const firstRank = rarityOrder.indexOf(res.body.results[0].rarity);
      const lastRank = rarityOrder.indexOf(res.body.results[res.body.results.length - 1].rarity);
      expect(firstRank).toBeGreaterThanOrEqual(lastRank);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/integration/skin-suggestions.test.ts --reporter=verbose`
Expected: FAIL with 404 (route doesn't exist yet).

- [ ] **Step 3: Implement /api/skin-suggestions endpoint**

Add to `server/routes/data.ts`, after the skin-data route:

```typescript
router.get("/api/skin-suggestions", cachedRoute(
  (req) => `skin_suggest:${(req.query.q as string || "").toLowerCase()}`,
  60,
  async (req, res) => {
    const q = ((req.query.q as string) || "").trim();
    if (q.length < 2) {
      res.json({ results: [] });
      return;
    }

    // Normalize: strip ★ and | from query, split into words for matching
    const normalized = q.replace(/★/g, "").replace(/\|/g, "").replace(/\s+/g, " ").trim();
    // Build LIKE pattern: each word must appear somewhere in the name (after stripping ★ and |)
    // Use SQL: REPLACE(REPLACE(s.name, '★', ''), '|', '') LIKE '%word1%' AND ... LIKE '%word2%'
    const words = normalized.toLowerCase().split(" ").filter(Boolean);
    if (words.length === 0) {
      res.json({ results: [] });
      return;
    }

    const params: string[] = [];
    let paramIndex = 1;
    const conditions = words.map(w => {
      params.push(`%${w}%`);
      return `LOWER(REPLACE(REPLACE(s.name, '★', ''), '|', '')) LIKE $${paramIndex++}`;
    });

    const { rows } = await pool.query(`
      SELECT s.name, s.weapon, s.rarity,
        STRING_AGG(DISTINCT c.name, ',') as collection_name
      FROM skins s
      LEFT JOIN skin_collections sc ON s.id = sc.skin_id
      LEFT JOIN collections c ON sc.collection_id = c.id
      WHERE ${conditions.join(" AND ")} AND s.stattrak = false
      GROUP BY s.name, s.weapon, s.rarity
      ORDER BY CASE s.rarity
        WHEN 'Extraordinary' THEN 6 WHEN 'Covert' THEN 5
        WHEN 'Classified' THEN 4 WHEN 'Restricted' THEN 3
        WHEN 'Mil-Spec' THEN 2 WHEN 'Industrial Grade' THEN 1
        WHEN 'Consumer Grade' THEN 0 ELSE -1
      END DESC, s.name ASC
      LIMIT 15
    `, params);

    res.json({ results: rows });
  },
));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/integration/skin-suggestions.test.ts --reporter=verbose`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/data.ts tests/integration/skin-suggestions.test.ts
git commit -m "Add /api/skin-suggestions endpoint with normalized search"
```

---

### Task 5: Fix collection knife/glove display

**Files:**
- Modify: `server/routes/data.ts:17-168` (skin-data route)
- Modify: `src/components/CollectionViewer.tsx:204-210`
- Create: `tests/integration/collection-knives.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/integration/collection-knives.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createExpandedApp, seedTestData, type TestContext } from "./setup.js";

describe("/api/skin-data collection knife/glove display", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createExpandedApp();
    await seedTestData(ctx.pool);
  });

  afterAll(async () => { await ctx.cleanup(); });

  it("all tab includes regular skins from collection", async () => {
    const res = await request(ctx.app).get("/api/skin-data?collection=Test+Collection+Alpha&limit=200");
    expect(res.status).toBe(200);
    const names = res.body.map((s: any) => s.name);
    expect(names).toContain("AK-47 | Test Skin");
  });

  it("all tab includes knife skins from collection's case pool", async () => {
    const res = await request(ctx.app).get("/api/skin-data?collection=Test+Collection+Alpha&limit=200");
    const names = res.body.map((s: any) => s.name);
    // Bayonet and Flip Knife are in the test collection's knife pool
    expect(names.some((n: string) => n.includes("Bayonet"))).toBe(true);
    expect(names.some((n: string) => n.includes("Flip Knife"))).toBe(true);
  });

  it("all tab does NOT include knives from other collections", async () => {
    const res = await request(ctx.app).get("/api/skin-data?collection=Test+Collection+Alpha&limit=200");
    const names = res.body.map((s: any) => s.name);
    // Karambit is NOT in Test Collection Alpha's knife pool
    expect(names.some((n: string) => n.includes("Karambit"))).toBe(false);
  });

  it("all tab sorts knives first", async () => {
    const res = await request(ctx.app).get("/api/skin-data?collection=Test+Collection+Alpha&limit=200");
    const names: string[] = res.body.map((s: any) => s.name);
    const firstKnifeIdx = names.findIndex(n => n.startsWith("★"));
    const lastKnifeIdx = names.length - 1 - [...names].reverse().findIndex(n => n.startsWith("★"));
    const firstRegularIdx = names.findIndex(n => !n.startsWith("★"));
    if (firstKnifeIdx !== -1 && firstRegularIdx !== -1) {
      expect(lastKnifeIdx).toBeLessThan(firstRegularIdx);
    }
  });

  it("outputCollection returns only collection-specific knives", async () => {
    const res = await request(ctx.app).get("/api/skin-data?outputCollection=Test+Collection+Alpha");
    expect(res.status).toBe(200);
    const names = res.body.map((s: any) => s.name);
    // Should have Bayonet and Flip Knife (in pool)
    expect(names.some((n: string) => n.includes("Bayonet"))).toBe(true);
    // Should NOT have Karambit (not in pool)
    expect(names.some((n: string) => n.includes("Karambit"))).toBe(false);
  });

  it("outputCollection for unknown collection returns empty", async () => {
    const res = await request(ctx.app).get("/api/skin-data?outputCollection=NonExistent+Collection");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it("collection without knives shows no knives in all tab", async () => {
    const res = await request(ctx.app).get("/api/skin-data?collection=Test+Collection+Beta&limit=200");
    const names = res.body.map((s: any) => s.name);
    expect(names.every((n: string) => !n.startsWith("★"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/integration/collection-knives.test.ts --reporter=verbose`
Expected: "all tab includes knife skins" and "sorts knives first" FAIL.

- [ ] **Step 3: Fix outputCollection to return empty when pool not found**

In `server/routes/data.ts`, after line 47 (`if (poolData) {`), add an else that returns empty:

```typescript
if (outputCollection) {
  const poolData = collectionKnifePool.get(outputCollection);
  if (poolData) {
    // ... existing weapon/finish filter logic ...
  } else {
    // Collection not in CASE_KNIFE_MAP — return empty result
    console.warn(`outputCollection "${outputCollection}" not found in collectionKnifePool`);
    res.json([]);
    return;
  }
}
```

- [ ] **Step 4: Implement all-tab knife merge**

In `server/routes/data.ts`, after the main skin-data query (around line 126), add knife merge logic when `collection` is set and rarity is "all" or empty:

```typescript
// After the main query result...
let allSkins = skins;

// Merge knives from collection's case pool into "all" tab
if (collection && (!rarity || rarity === "all" || rarity === "")) {
  const poolData = collectionKnifePool.get(collection);
  if (poolData) {
    const weapons = [...poolData.knifeTypes, ...poolData.gloveTypes];
    if (weapons.length > 0) {
      // Build knife query with same stattrak filter
      const knifeParams: (string | number | boolean)[] = [stattrak, stattrak, stattrak];
      let kpi = 4;
      const weaponPlaceholders = weapons.map((_, i) => `s.weapon = $${kpi + i}`).join(" OR ");
      knifeParams.push(...weapons);
      kpi += weapons.length;

      const finishes = [...poolData.knifeFinishes, ...poolData.gloveFinishes].filter(f => f !== "Vanilla");
      const hasVanilla = poolData.knifeFinishes.includes("Vanilla");
      let finishFilter = "";
      if (finishes.length > 0) {
        const fp = finishes.map((_, i) => `$${kpi + i}`).join(",");
        knifeParams.push(...finishes);
        kpi += finishes.length;
        finishFilter = hasVanilla
          ? `AND (split_part(s.name, ' | ', 2) IN (${fp}) OR s.name NOT LIKE '%|%')`
          : `AND split_part(s.name, ' | ', 2) IN (${fp})`;
      } else if (hasVanilla) {
        finishFilter = `AND s.name NOT LIKE '%|%'`;
      }

      const { rows: knifeSkins } = await pool.query(`
        SELECT MIN(s.id) as id, s.name, s.rarity, s.weapon, s.min_float, s.max_float, $1::boolean as stattrak,
          STRING_AGG(DISTINCT c.name, ',') as collection_names,
          COUNT(DISTINCT l.id) as listing_count,
          MIN(l.price_cents) as min_price,
          ROUND(AVG(l.price_cents)) as avg_price,
          MAX(l.price_cents) as max_price,
          MIN(l.float_value) as min_float_seen,
          MAX(l.float_value) as max_float_seen
        FROM skins s
        LEFT JOIN skin_collections sc ON s.id = sc.skin_id
        LEFT JOIN collections c ON sc.collection_id = c.id
        LEFT JOIN listings l ON s.id = l.skin_id AND l.stattrak = $2::boolean
        WHERE s.stattrak = $3::boolean AND s.name LIKE '★%'
          AND (${weaponPlaceholders}) ${finishFilter}
        GROUP BY s.name, s.rarity, s.weapon, s.min_float, s.max_float
        ORDER BY listing_count DESC
      `, knifeParams);

      // Merge: knives first, then regular skins. No processedKnives needed —
      // knifeSkins are raw DB rows, same shape as skins. They flow through the
      // existing batch price/sale loading + final result mapping below.
      allSkins = [...knifeSkins, ...skins];
    }
  }
}
```

Then replace `skins` with `allSkins` in:
1. The `skinNames` extraction for batch price/sale loading (`const skinNames = allSkins.map(...)`)
2. The final `result` mapping (`const result = allSkins.map(...)`)

The existing mapping already resolves `collection_name` for knife skins via `knifeTypeToCases` (lines 159-163 in data.ts), and the batch loading populates `priceMap`/`saleCountMap` for all skin names. No deduplication needed — the two queries (regular + knife) produce disjoint sets (knives have `★` prefix, regular skins don't).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/integration/collection-knives.test.ts --reporter=verbose`
Expected: All PASS.

- [ ] **Step 6: Update CollectionViewer to pass both filters for "all" tab**

In `src/components/CollectionViewer.tsx` line 207, change so that the "all" tab passes `collectionFilter` for all rarity values (the server now handles the knife merge):

```typescript
<DataViewer
  key={`${collectionName}-${skinRarity}`}
  onNavigateCollection={onNavigateCollection}
  collectionFilter={collectionName}
  outputCollection={skinRarity === "knife_glove" ? collectionName : undefined}
  initialRarity={skinRarity === "all" ? "" : skinRarity === "knife_glove" ? "knife_glove" : skinRarity}
/>
```

Note: `collectionFilter` is now always set (the server merges knives when collection is set). `outputCollection` is additionally set for the knife_glove tab to tell the server to only show knives.

- [ ] **Step 7: Update DataViewer to pass rarity when outputCollection is set**

In `src/components/DataViewer.tsx` line 48, remove the `!outputCollection` guard so rarity is always sent:

```typescript
if (rarity) params.set("rarity", rarity);
```

And update the server-side `/api/skin-data` route to respect rarity="knife_glove" even when outputCollection is set (it already handles `knife_glove` rarity with `AND s.name LIKE '★%'`, which is compatible with outputCollection).

- [ ] **Step 8: Run full test suite**

Run: `npx vitest run tests/integration/ --reporter=verbose`
Expected: All PASS.

- [ ] **Step 9: Commit**

```bash
git add server/routes/data.ts src/components/CollectionViewer.tsx src/components/DataViewer.tsx tests/integration/collection-knives.test.ts
git commit -m "Fix collection knife/glove: merge into all tab, filter by case pool"
```

---

### Task 6: AutocompleteInput search normalization

**Files:**
- Modify: `src/components/FilterBar.tsx:73-132`

- [ ] **Step 1: Add normalization helper function**

Add above `AutocompleteInput` in `FilterBar.tsx`:

```typescript
/** Strip ★ and | for search matching — user types "bayonet fade" to match "★ Bayonet | Fade" */
function normalizeForSearch(text: string): string {
  return text.replace(/★/g, "").replace(/\|/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}
```

- [ ] **Step 2: Update filtered memo to use normalized matching**

In `AutocompleteInput`, replace the `filtered` useMemo (lines 93-100):

```typescript
const filtered = useMemo(() => {
  const available = items.filter(i => !selected.includes(i.label));
  if (!query) return available.slice(0, 50);
  const q = normalizeForSearch(query);
  const words = q.split(" ").filter(Boolean);
  return available
    .filter(i => {
      const normalized = normalizeForSearch(i.label);
      return words.every(w => normalized.includes(w));
    })
    .slice(0, 50);
}, [items, query, selected]);
```

- [ ] **Step 3: Manually verify in browser**

Start dev server: `npm run dev` + `npx tsx watch server/index.ts`
- Go to trade-ups page
- Type "phantom" in skin filter → should show skins containing "Phantom" in finish name
- Type "bayonet fade" → should show "★ Bayonet | Fade"
- Type "chroma" in collection filter → should show Chroma collections

- [ ] **Step 4: Commit**

```bash
git add src/components/FilterBar.tsx
git commit -m "Add search normalization to FilterBar autocomplete (strip star and pipe)"
```

---

### Task 7: Market filter pill/popover

**Files:**
- Modify: `src/components/FilterBar.tsx:332-349` (market checkboxes → pill)
- Modify: `src/components/FilterBar.tsx:218-227` (remove market chip from FilterChips)

- [ ] **Step 1: Create MarketFilter component**

Add in `FilterBar.tsx` after `RangeFilter`:

```typescript
function MarketFilter({ selected, onChange }: {
  selected: string[];
  onChange: (markets: string[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const hasValue = selected.length > 0;

  useEffect(() => {
    if (!expanded) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setExpanded(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [expanded]);

  const summary = hasValue
    ? selected.map(m => AVAILABLE_MARKETS.find(am => am.value === m)?.label || m).join(", ")
    : "any";

  return (
    <div className="relative" ref={ref}>
      <button
        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border whitespace-nowrap transition-colors cursor-pointer ${
          hasValue
            ? "border-blue-500/40 bg-blue-500/10 text-blue-400"
            : "border-border text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground"
        }`}
        onClick={() => setExpanded(e => !e)}
      >
        <span className="font-medium">Market</span>
        <span className={`text-[0.72rem] ${hasValue ? "text-blue-400" : "text-muted-foreground/60"}`}>{summary}</span>
      </button>
      {expanded && (
        <div className="absolute top-[calc(100%+4px)] left-0 z-[200] bg-popover border border-border rounded-md p-3 min-w-[180px] shadow-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-foreground">Market</span>
            <button
              className="text-muted-foreground hover:text-foreground text-sm cursor-pointer leading-none px-1"
              onClick={() => setExpanded(false)}
            >×</button>
          </div>
          <div className="flex flex-col gap-2">
            {AVAILABLE_MARKETS.map(m => (
              <label key={m.value} className="flex items-center gap-2 text-xs text-popover-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={selected.includes(m.value)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...selected, m.value]
                      : selected.filter(x => x !== m.value);
                    onChange(next);
                  }}
                  className="rounded border-border"
                />
                {m.label}
              </label>
            ))}
          </div>
          {hasValue && (
            <button
              className="mt-2 text-[0.68rem] text-muted-foreground hover:text-foreground cursor-pointer"
              onClick={() => onChange([])}
            >Clear</button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Replace market checkboxes with MarketFilter pill in FilterBar**

Remove the market checkboxes section (lines 332-349) and add MarketFilter to the range filters row:

```typescript
{/* In the range filters flex row, add: */}
<MarketFilter selected={filters.markets} onChange={(m) => update({ markets: m })} />
```

- [ ] **Step 3: Remove market chip from FilterChips**

In `FilterChips`, remove the markets chip block (lines 218-227). Market state is now exclusively managed by the pill.

- [ ] **Step 4: Manually verify in browser**

- Market pill shows "Market any" by default
- Click → popover with CSFloat/DMarket checkboxes
- Select one → pill shows "Market CSFloat" with blue highlight
- Click outside → popover closes
- FilterChips area no longer shows separate market chip

- [ ] **Step 5: Commit**

```bash
git add src/components/FilterBar.tsx
git commit -m "Redesign market filter: checkboxes to pill/popover"
```

---

### Task 8: DataViewer server-side search

**Files:**
- Modify: `src/components/DataViewer.tsx:140-172`

- [ ] **Step 1: Add debounced server-side suggestion fetching**

Replace the client-side suggestion logic in DataViewer (lines 152-172) with server-side calls:

```typescript
const [suggestions, setSuggestions] = useState<{ name: string; weapon: string; rarity: string; collection_name: string | null }[]>([]);
const suggestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

// Debounced server-side search suggestions
useEffect(() => {
  if (search.length < 2 || !showSuggestions) {
    setSuggestions([]);
    return;
  }
  if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current);
  suggestTimerRef.current = setTimeout(async () => {
    try {
      const res = await fetch(`/api/skin-suggestions?q=${encodeURIComponent(search)}`);
      const data = await res.json();
      setSuggestions(data.results || []);
    } catch {
      setSuggestions([]);
    }
  }, 250);
  return () => {
    if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current);
  };
}, [search, showSuggestions]);
```

- [ ] **Step 2: Update suggestion dropdown to use server results**

Replace the inline suggestion rendering (lines 152-172) with:

```typescript
{showSuggestions && suggestions.length > 0 && (
  <div className="absolute top-full left-0 right-0 z-[200] bg-popover border border-border rounded-b-md max-h-48 overflow-y-auto shadow-lg">
    {suggestions.map(s => (
      <div
        key={s.name}
        className="px-3 py-1.5 text-xs cursor-pointer hover:bg-accent transition-colors"
        onMouseDown={e => { e.preventDefault(); setSearch(s.name); setAppliedSearch(s.name); setSelectedSkin(s.name); setShowSuggestions(false); }}
      >
        <span className="text-foreground">{s.name}</span>
        {s.collection_name && <span className="text-muted-foreground ml-2 text-[0.65rem]">{s.collection_name}</span>}
      </div>
    ))}
  </div>
)}
```

- [ ] **Step 3: Remove old client-side filtered suggestion logic**

Remove the inline IIFE at lines 152-172 that was doing `skins.filter(...)`.

- [ ] **Step 4: Manually verify in browser**

- Go to Data Viewer page
- Type "phantom" → suggestions appear after ~250ms from server
- Type "bayonet" → shows knife skins (without needing ★)
- Select a suggestion → detail panel loads
- Type "nonexistent" → no suggestions

- [ ] **Step 5: Commit**

```bash
git add src/components/DataViewer.tsx
git commit -m "DataViewer: server-side search suggestions via /api/skin-suggestions"
```

---

### Task 9: Performance — DB indexes and cache tuning

**Files:**
- Modify: `server/routes/data.ts` (cache TTL)
- Run SQL on local dev DB

- [ ] **Step 1: Check which indexes already exist**

Run on local DB:
```bash
psql -d tradeupbot -c "\di trade_up_inputs*" && psql -d tradeupbot -c "\di listings*" && psql -d tradeupbot -c "\di skin_collections*"
```

Compare against the test schema in `tests/integration/setup.ts` (which already has `idx_trade_up_inputs_skin` and `idx_trade_up_inputs_collection_tuid`).

- [ ] **Step 2: Add missing indexes to production DB**

Based on findings from step 1, add any missing:

```sql
-- For AND-logic multi-skin subqueries (skin_name leading)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trade_up_inputs_skin_tuid ON trade_up_inputs(skin_name, trade_up_id);

-- For skin-data JOIN performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_skin_stattrak ON listings(skin_id, stattrak);

-- For collection filter subquery
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_skin_collections_skin ON skin_collections(skin_id);
```

- [ ] **Step 3: Add indexes to test schema in setup.ts**

In `tests/integration/setup.ts`, add the new indexes after existing ones (around line 198):

```typescript
CREATE INDEX IF NOT EXISTS idx_trade_up_inputs_skin_tuid ON trade_up_inputs(skin_name, trade_up_id);
CREATE INDEX IF NOT EXISTS idx_listings_skin_stattrak ON listings(skin_id, stattrak);
CREATE INDEX IF NOT EXISTS idx_skin_collections_skin ON skin_collections(skin_id);
```

- [ ] **Step 4: Update cache TTLs**

In `server/routes/data.ts` line 17, change the skin-data cache TTL from `120` to `300`:

```typescript
router.get("/api/skin-data", cachedRoute((req) => `skins:${...}`, 300, async (req, res) => {
```

- [ ] **Step 5: Run EXPLAIN ANALYZE on key queries locally**

```bash
psql -d tradeupbot -c "EXPLAIN ANALYZE SELECT DISTINCT skin_name FROM trade_up_inputs;"
psql -d tradeupbot -c "EXPLAIN ANALYZE SELECT trade_up_id FROM trade_up_inputs WHERE skin_name = 'AK-47 | Redline';"
```

Verify indexes are being used (look for "Index Scan" or "Index Only Scan" in output).

- [ ] **Step 6: Run full test suite**

Run: `npx vitest run tests/integration/ --reporter=verbose`
Expected: All PASS.

- [ ] **Step 7: Commit**

```bash
git add server/routes/data.ts tests/integration/setup.ts
git commit -m "Performance: add DB indexes, increase skin-data cache TTL to 300s"
```

---

### Task 10: Final integration test and type check

**Files:** All modified files

- [ ] **Step 1: Run type checker**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run tests/unit/ tests/integration/ --reporter=verbose`
Expected: All tests pass.

- [ ] **Step 3: Manual end-to-end verification in browser**

Start servers: `npm run dev` + `npx tsx watch server/index.ts`

Checklist:
- [ ] Trade-ups page: skin autocomplete shows results, normalized matching works
- [ ] Trade-ups page: collection autocomplete shows results
- [ ] Trade-ups page: selecting multiple skins filters with AND logic
- [ ] Trade-ups page: market pill/popover works
- [ ] Data viewer: server-side search finds any skin
- [ ] Data viewer: typing "bayonet" finds knife skins
- [ ] Collection page → Skins → All tab: shows knives + regular skins, knives first
- [ ] Collection page → Skins → Knife/Glove tab: shows only that collection's knives
- [ ] Collection page → Skins → Knife/Glove tab for non-knife collection: shows empty

- [ ] **Step 4: Commit any fixes**

If any manual testing revealed issues, fix and commit individually.

---

### Task 11: VPS deploy and verification

**Files:** None (deployment task)

Use `/vps` skill for all remote operations.

- [ ] **Step 1: Record pre-deploy performance baselines**

SSH into VPS and measure current response times:

```bash
curl -w '%{time_total}s\n' -s -o /dev/null localhost:3001/api/filter-options
curl -w '%{time_total}s\n' -s -o /dev/null 'localhost:3001/api/skin-data?rarity=Covert&limit=200'
curl -w '%{time_total}s\n' -s -o /dev/null 'localhost:3001/api/trade-ups?sort=profit&order=desc&per_page=50'
```

- [ ] **Step 2: Deploy code to VPS**

Push branch, pull on VPS, restart services.

- [ ] **Step 3: Add DB indexes on VPS**

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trade_up_inputs_skin_tuid ON trade_up_inputs(skin_name, trade_up_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listings_skin_stattrak ON listings(skin_id, stattrak);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_skin_collections_skin ON skin_collections(skin_id);
```

- [ ] **Step 4: Run functionality tests**

Per spec Section 6 — test each endpoint with curl:

```bash
# Filter options
curl -s localhost:3001/api/filter-options | jq '.skins | length'
curl -s localhost:3001/api/filter-options | jq '.skins[] | select(.output == true) | .name' | head -5

# Skin suggestions
curl -s 'localhost:3001/api/skin-suggestions?q=bayonet' | jq '.results[].name'
curl -s 'localhost:3001/api/skin-suggestions?q=phantom' | jq '.results[].name'

# Collection knife display
curl -s 'localhost:3001/api/skin-data?collection=The+Chroma+Collection&limit=200' | jq '[.[] | select(.name | startswith("★"))] | length'
curl -s 'localhost:3001/api/skin-data?outputCollection=The+Chroma+Collection' | jq '.[].name' | head -10
```

- [ ] **Step 5: Record post-deploy performance**

Same curl commands as step 1. Compare response times.

- [ ] **Step 6: Run EXPLAIN ANALYZE on VPS**

```bash
psql -d tradeupbot -c "EXPLAIN ANALYZE SELECT trade_up_id FROM trade_up_inputs WHERE skin_name = 'AK-47 | Redline';"
```

Verify indexes are used.
