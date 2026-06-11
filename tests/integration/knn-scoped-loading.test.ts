/**
 * Integration tests for KNN scoped-loading port (plan 016).
 *
 * Step 1: Equivalence snapshots — capture batchInputValueRatios output
 *   against the UNCHANGED code. After the port these ratios must be
 *   byte-identical (plan STOP condition if any drift).
 *
 * Step 3: Chunking test — seed 2,100 distinct skin/condition pairs,
 *   verify chunk-split path produces same row count as unchunked control.
 *
 * Step 4: Binary-search window + memoization edge tests.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { batchInputValueRatios, clearKnnCache } from "../../server/engine/knn-pricing.js";
import { makeObservation } from "../helpers/fixtures.js";

const { Pool } = pg;

const connectionString =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgresql://tradeupbot:tradeupbot_pg_2026@localhost:5432/tradeupbot_test";

let pool: pg.Pool;
let schema: string;

// ── Schema helpers ─────────────────────────────────────────────────────────

async function createIsolatedSchema(): Promise<string> {
  const s = `test_knn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const boot = new Pool({ connectionString, max: 1 });
  await boot.query(`CREATE SCHEMA IF NOT EXISTS "${s}"`);
  await boot.query(`SET search_path TO "${s}"`);
  await boot.query(`
    CREATE TABLE IF NOT EXISTS price_observations (
      id SERIAL PRIMARY KEY,
      skin_name TEXT NOT NULL,
      float_value DOUBLE PRECISION NOT NULL,
      price_cents INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'listing',
      observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_price_obs_dedup
      ON price_observations(skin_name, float_value, price_cents, source);
  `);
  await boot.end();
  return s;
}

// Insert a single price observation directly to the schema pool.
async function insertObservation(
  p: pg.Pool,
  obs: ReturnType<typeof makeObservation>,
) {
  const observedAt = new Date(Date.now() - obs.ageDays * 86400 * 1000).toISOString();
  await p.query(
    `INSERT INTO price_observations (skin_name, float_value, price_cents, source, observed_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING`,
    [obs.skinName, obs.float, obs.price, obs.source, observedAt],
  );
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
  schema = await createIsolatedSchema();
  const sep = connectionString.includes("?") ? "&" : "?";
  pool = new Pool({
    connectionString: `${connectionString}${sep}options=-c%20search_path%3D${schema}`,
    max: 5,
  });
});

afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await pool.end();
});

// ── Helper: clear module-level cache between test groups ──────────────────────
function resetKnnCache() {
  clearKnnCache();
}

// ──────────────────────────────────────────────────────────────────────────────
// Step 1: Equivalence snapshots
// Seed 3 skins across conditions, call batchInputValueRatios, snapshot results.
// These exact values are asserted after the port.
// ──────────────────────────────────────────────────────────────────────────────

describe("Step 1 — batchInputValueRatios equivalence snapshots", () => {
  // Skin A: "AK-47 | Redline" — Field-Tested (0.15–0.38)
  // Seed enough FT obs so Gaussian KNN fires (≥3 within ±0.04 of the target float)
  const SKIN_A = "AK-47 | Redline";
  // Skin B: "M4A4 | Howl" — Factory New (0.00–0.07)
  const SKIN_B = "M4A4 | Howl";
  // Skin C: "AWP | Dragon Lore" — Minimal Wear (0.07–0.15) — sparse (2 obs only → condition median)
  const SKIN_C = "AWP | Dragon Lore";

  // Listings we'll price — no `as const` so the inferred type is mutable and
  // compatible with the function signature without any cast.
  const listings = [
    // Skin A: float 0.20 (FT) — should have KNN neighbors
    { id: "list-a-1", skin_name: SKIN_A, float_value: 0.20, price_cents: 4500 },
    // Skin A: float 0.35 (FT) — further from obs cluster, may fall back
    { id: "list-a-2", skin_name: SKIN_A, float_value: 0.35, price_cents: 3000 },
    // Skin B: float 0.02 (FN) — 3 obs seeded at FN
    { id: "list-b-1", skin_name: SKIN_B, float_value: 0.02, price_cents: 80000 },
    // Skin C: float 0.10 (MW) — only 2 obs → condition median fallback
    { id: "list-c-1", skin_name: SKIN_C, float_value: 0.10, price_cents: 50000 },
    // Skin D: no observations — neutral 1.0
    { id: "list-d-1", skin_name: "Glock-18 | Water Elemental", float_value: 0.15, price_cents: 1000 },
  ];

  beforeAll(async () => {
    resetKnnCache();

    // Skin A (FT) — 5 obs clustered around 0.20–0.26 (within ±0.04 of 0.20)
    const skinAObs = [
      makeObservation({ skinName: SKIN_A, float: 0.18, price: 5000, source: "sale", ageDays: 3 }),
      makeObservation({ skinName: SKIN_A, float: 0.20, price: 4800, source: "sale", ageDays: 5 }),
      makeObservation({ skinName: SKIN_A, float: 0.22, price: 4600, source: "sale", ageDays: 7 }),
      makeObservation({ skinName: SKIN_A, float: 0.24, price: 4400, source: "sale", ageDays: 10 }),
      makeObservation({ skinName: SKIN_A, float: 0.26, price: 4200, source: "buff_sale", ageDays: 14 }),
    ];
    for (const obs of skinAObs) await insertObservation(pool, obs);

    // Skin B (FN) — 3 obs within ±0.04 of 0.02
    const skinBObs = [
      makeObservation({ skinName: SKIN_B, float: 0.01, price: 90000, source: "sale", ageDays: 2 }),
      makeObservation({ skinName: SKIN_B, float: 0.02, price: 85000, source: "sale", ageDays: 4 }),
      makeObservation({ skinName: SKIN_B, float: 0.03, price: 78000, source: "sale", ageDays: 6 }),
    ];
    for (const obs of skinBObs) await insertObservation(pool, obs);

    // Skin C (MW) — only 2 obs → triggers condition-median path
    const skinCObs = [
      makeObservation({ skinName: SKIN_C, float: 0.09, price: 120000, source: "sale", ageDays: 5 }),
      makeObservation({ skinName: SKIN_C, float: 0.13, price: 100000, source: "sale", ageDays: 8 }),
    ];
    for (const obs of skinCObs) await insertObservation(pool, obs);
  });

  it("returns Map with one entry per listing", async () => {
    resetKnnCache();
    const result = await batchInputValueRatios(pool, listings);
    expect(result.size).toBe(listings.length);
  });

  it("neutral ratio (1.0) for skin with no observations", async () => {
    resetKnnCache();
    const result = await batchInputValueRatios(pool, listings);
    expect(result.get("list-d-1")).toBe(1.0);
  });

  it("ratio > 0 for all listings", async () => {
    resetKnnCache();
    const result = await batchInputValueRatios(pool, listings);
    for (const [id, ratio] of result) {
      expect(ratio, `ratio for ${id}`).toBeGreaterThan(0);
    }
  });

  // Equivalence assertions — pinned to current code's exact IEEE-754 output values.
  // age_days is computed from NOW() at query time; Gaussian weights include a
  // time-decay term, so sub-millisecond NOW() jitter could shift the last ~16th
  // significant digit. The measured run-to-run noise floor is ≈1e-16, so
  // precision 8 (toBeCloseTo tolerance ±5×10⁻⁹) is safely attainable.
  // All values below were anchored by running against the unmodified production
  // code and recording the exact JS number output.
  it("skin A list-a-1 ratio is stable across port", async () => {
    resetKnnCache();
    const result = await batchInputValueRatios(pool, listings);
    const ratio = result.get("list-a-1")!;
    expect(typeof ratio).toBe("number");
    expect(ratio).toBeGreaterThan(0);
    // listing 4500 / Gaussian-weighted predicted ~4799 (4 obs within ±0.04 of 0.20)
    // Exact observed value: 0.9374693230084501
    expect(ratio).toBeCloseTo(0.9374693230084501, 8);
  });

  it("skin A list-a-2 ratio is stable across port", async () => {
    resetKnnCache();
    const result = await batchInputValueRatios(pool, listings);
    const ratio = result.get("list-a-2")!;
    // listing 3000 at float 0.35; nearest FT obs: 0.26 (dist=0.09 > 0.04), none within window
    // → condition-median fallback: median of {5000,4800,4600,4400,4200} = 4600
    // → ratio = 3000/4600 ≈ 0.6522
    // Exact observed value: 0.6521739130434783
    expect(ratio).toBeCloseTo(0.6521739130434783, 8);
  });

  it("skin B list-b-1 ratio is stable across port", async () => {
    resetKnnCache();
    const result = await batchInputValueRatios(pool, listings);
    const ratio = result.get("list-b-1")!;
    // listing 80000; 3 FN obs around 0.01-0.03, all within ±0.04 of 0.02
    // predicted Gaussian-weighted; ratio = 80000/predicted
    // Exact observed value: 0.9445839715221565
    expect(ratio).toBeCloseTo(0.9445839715221565, 8);
  });

  it("skin C list-c-1 ratio (condition-median path) is stable across port", async () => {
    resetKnnCache();
    const result = await batchInputValueRatios(pool, listings);
    const ratio = result.get("list-c-1")!;
    // listing 50000; 2 MW obs (0.09 and 0.13); target 0.10
    // Both obs within ±0.04 window → 2 nearby obs (meets minimum)
    // Gaussian-weighted predicted price; ratio = 50000/predicted
    // Exact observed value: 0.4368519961166087
    expect(ratio).toBeCloseTo(0.4368519961166087, 8);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Step 1 additional: window logic unit-style tests via DB
// ──────────────────────────────────────────────────────────────────────────────

describe("Step 1 — window edge cases", () => {
  const EDGE_SKIN = "P90 | Asiimov";

  beforeAll(async () => {
    resetKnnCache();
    // Obs exactly at ±0.04 boundaries relative to target 0.25 (FT: 0.15–0.38)
    // target = 0.25; min window = 0.21; max window = 0.29
    const edgeObs = [
      // Exactly at lower boundary (dist = 0.04 — should be included per filter: dist <= 0.04)
      makeObservation({ skinName: EDGE_SKIN, float: 0.21, price: 3000, source: "sale", ageDays: 2 }),
      // Just inside lower boundary
      makeObservation({ skinName: EDGE_SKIN, float: 0.22, price: 3100, source: "sale", ageDays: 3 }),
      // At target
      makeObservation({ skinName: EDGE_SKIN, float: 0.25, price: 3200, source: "sale", ageDays: 1 }),
      // Just inside upper boundary
      makeObservation({ skinName: EDGE_SKIN, float: 0.28, price: 3050, source: "sale", ageDays: 4 }),
      // Exactly at upper boundary (dist = 0.04 — should be included)
      makeObservation({ skinName: EDGE_SKIN, float: 0.29, price: 2900, source: "sale", ageDays: 5 }),
      // Just outside boundaries — should NOT be in window
      makeObservation({ skinName: EDGE_SKIN, float: 0.20, price: 9999, source: "sale", ageDays: 1 }),
      makeObservation({ skinName: EDGE_SKIN, float: 0.30, price: 9999, source: "sale", ageDays: 1 }),
    ];
    for (const obs of edgeObs) await insertObservation(pool, obs);
  });

  it("boundary floats exactly ±0.04 are included in window", async () => {
    resetKnnCache();
    const listing = { id: "edge-1", skin_name: EDGE_SKIN, float_value: 0.25, price_cents: 3200 };
    const result = await batchInputValueRatios(pool, [listing]);
    const ratio = result.get("edge-1")!;
    // 5 obs in window: 0.21(3000), 0.22(3100), 0.25(3200), 0.28(3050), 0.29(2900)
    // Boundary-inclusive window approved as a deviation from the pre-port behavior
    // (plan 016 review): old code excluded exact ±0.04 boundaries via FP rounding;
    // new lowerBoundFloat window includes them, matching the documented ±0.04 intent.
    // Exact observed value (vs. pre-port snapshot 1.0229722119310771): 1.0264204920550151
    expect(ratio).toBeCloseTo(1.0264204920550151, 8);
  });

  it("obs at 0.20 (outside -0.04 boundary) does not pollute ratio", async () => {
    // If 0.20 (price 9999) was included, the ratio would be much higher
    // We verify that the result is sensible (close to 1.0 since we list at ~predicted)
    resetKnnCache();
    const listing = { id: "edge-2", skin_name: EDGE_SKIN, float_value: 0.25, price_cents: 3200 };
    const result = await batchInputValueRatios(pool, [listing]);
    const ratio = result.get("edge-2")!;
    // If 9999-priced outlier was included, predicted price would be much higher → ratio << 1
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(2.0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Step 1 additional: explicit boundary-inclusion pin
// Verifies that observations EXACTLY ±0.04 away from a listing's float are
// included in the window (new binary-search behavior, approved deviation from
// pre-port FP-rounding exclusion).
// ──────────────────────────────────────────────────────────────────────────────

describe("Step 1 — boundary-inclusive window pin (plan 016 approved deviation)", () => {
  const PIN_SKIN = "USP-S | Kill Confirmed";

  beforeAll(async () => {
    resetKnnCache();
    // FT listing at 0.20; plant observations at EXACTLY the ±0.04 boundaries
    // (0.16 and 0.24) plus interior (0.18 and 0.20) for KNN trigger.
    // Asymmetric prices ensure computed ratio is unambiguously ≠ 1.0.
    const pinObs = [
      // Exactly at lower boundary: dist = |0.16 - 0.20| = 0.04 (must be INCLUDED)
      makeObservation({ skinName: PIN_SKIN, float: 0.16, price: 6000, source: "sale", ageDays: 2 }),
      makeObservation({ skinName: PIN_SKIN, float: 0.18, price: 5500, source: "sale", ageDays: 3 }),
      makeObservation({ skinName: PIN_SKIN, float: 0.20, price: 5000, source: "sale", ageDays: 1 }),
      // Exactly at upper boundary: dist = |0.24 - 0.20| = 0.04 (must be INCLUDED)
      makeObservation({ skinName: PIN_SKIN, float: 0.24, price: 4000, source: "sale", ageDays: 4 }),
    ];
    for (const obs of pinObs) await insertObservation(pool, obs);
  });

  it("boundary-inclusive: obs at exactly ±0.04 are used in Gaussian weight", async () => {
    // Boundary-inclusive window approved as a deviation from the pre-port behavior
    // (plan 016 review): old code excluded exact ±0.04 boundaries via FP rounding;
    // new lowerBoundFloat window includes them, matching the documented ±0.04 intent.
    // All 4 observations (0.16, 0.18, 0.20, 0.24) participate in the Gaussian-weighted
    // predicted price; their inclusion is proven by the specific ratio value below
    // (if boundary obs were excluded, only 0.18 and 0.20 would be present → different ratio).
    resetKnnCache();
    const listing = { id: "pin-boundary", skin_name: PIN_SKIN, float_value: 0.20, price_cents: 5000 };
    const result = await batchInputValueRatios(pool, [listing]);
    const ratio = result.get("pin-boundary")!;
    // Exact observed value anchored against current production code: 0.9692507959857792
    expect(ratio).toBeCloseTo(0.9692507959857792, 8);
  });
});

describe("Step 1 — empty condition pool", () => {
  it("returns 1.0 when all obs are different condition than listing", async () => {
    resetKnnCache();
    const CROSS_SKIN = "Desert Eagle | Cobalt Disruption";
    // Seed FT obs only (0.15–0.38)
    await insertObservation(pool,
      makeObservation({ skinName: CROSS_SKIN, float: 0.20, price: 2000, source: "sale", ageDays: 1 }),
    );
    // Ask for MW listing (0.07–0.15) — no same-condition obs → neutral
    const listing = { id: "cross-1", skin_name: CROSS_SKIN, float_value: 0.10, price_cents: 3000 };
    const result = await batchInputValueRatios(pool, [listing]);
    expect(result.get("cross-1")).toBe(1.0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Step 3: Chunking test — >1 chunk (2,100 distinct skin/condition pairs)
// ──────────────────────────────────────────────────────────────────────────────

describe("Step 3 — chunking: 2100 distinct skin/condition pairs", () => {
  // We need 2,100 unique (skin, condition-range) pairs.
  // Each synthetic skin gets one listing in FT (Field-Tested: 0.15–0.38).
  // We seed TWO observations per synthetic skin at intentionally LOW prices
  // (both 800 cents) so the computed Gaussian-weighted predicted price is 800,
  // giving ratio = listing_price(1000) / predicted(800) = 1.25.
  // This is unambiguously ≠ 1.0, so if any chunk is dropped (losing its
  // observations), those listings fall back to the neutral 1.0 path and are
  // detectable by asserting zero ratios === 1.0.
  const SYNTHETIC_COUNT = 2100;
  const syntheticListings: { id: string; skin_name: string; float_value: number; price_cents: number }[] = [];

  beforeAll(async () => {
    resetKnnCache();
    // Build listings for 2,100 unique skins
    for (let i = 0; i < SYNTHETIC_COUNT; i++) {
      const skinName = `Synthetic Skin ${i.toString().padStart(5, "0")}`;
      const float = 0.20; // all FT
      syntheticListings.push({ id: `syn-${i}`, skin_name: skinName, float_value: float, price_cents: 1000 });
      // Seed 2 obs per skin at 800 cents (below the 1000-cent listing price)
      // so the computed ratio ≈ 1000/800 = 1.25, not 1.0.
      await insertObservation(pool,
        makeObservation({ skinName, float: 0.19, price: 800, source: "sale", ageDays: 2 }),
      );
      await insertObservation(pool,
        makeObservation({ skinName, float: 0.21, price: 800, source: "sale", ageDays: 3 }),
      );
    }
  }, 60000); // 60s timeout — inserting 4200 rows

  it("returns a ratio for all 2100 listings (chunking fires without data loss)", async () => {
    resetKnnCache();
    const result = await batchInputValueRatios(pool, syntheticListings);
    expect(result.size).toBe(SYNTHETIC_COUNT);
    // All ratios should be numbers > 0 (not undefined, not NaN)
    let missingOrInvalid = 0;
    for (let i = 0; i < SYNTHETIC_COUNT; i++) {
      const ratio = result.get(`syn-${i}`);
      if (ratio === undefined || typeof ratio !== "number" || isNaN(ratio) || ratio <= 0) {
        missingOrInvalid++;
      }
    }
    expect(missingOrInvalid).toBe(0);
  }, 60000);

  it("no neutral fallbacks across all 2100 pairs (dropped-chunk detection)", async () => {
    // Approach: assert 0 pairs returned the data-less neutral fallback (ratio === 1.0).
    // Each synthetic skin has 2 observations at price 800, so every correctly-loaded
    // pair computes a ratio ≈ 1.25 (listing 1000 / predicted ~800) — never exactly 1.0.
    // If the chunk loop drops any chunk (silently losing observations), those skins
    // get no data → neutral 1.0. This assertion would then fail, catching the sabotage.
    // (Row-count comparison via a second loadInputKnnObservationRows call is not
    // feasible because that function is not exported; this no-neutral-fallback
    // assertion across all 2100 pairs is the accepted substitute per plan 016 review.)
    resetKnnCache();
    const result = await batchInputValueRatios(pool, syntheticListings);
    let neutralCount = 0;
    for (let i = 0; i < SYNTHETIC_COUNT; i++) {
      const ratio = result.get(`syn-${i}`);
      if (ratio === 1.0) neutralCount++;
    }
    expect(neutralCount).toBe(0);
  }, 60000);

  it("spot-check: ratios match unchunked control for first AND last chunks", async () => {
    // Pick 5 skins from the FIRST chunk (indexes 0–4) and 5 from the LAST chunk
    // (indexes 2000–2099, well into chunk 2). Verify their ratios are identical
    // whether fetched via the full 2100-listing call or a dedicated subset call
    // (both scoped). If a later chunk is silently dropped the last-chunk subset
    // would return data-driven ratios while the full-call would return neutral 1.0,
    // causing this assertion to fail.
    resetKnnCache();
    const firstChunkSubset = syntheticListings.slice(0, 5);
    const lastChunkSubset = syntheticListings.slice(2000, 2005);
    const combinedSubset = [...firstChunkSubset, ...lastChunkSubset];
    const subsetResult = await batchInputValueRatios(pool, combinedSubset);

    resetKnnCache();
    const fullResult = await batchInputValueRatios(pool, syntheticListings);

    for (const l of combinedSubset) {
      expect(fullResult.get(l.id), `chunk spot-check mismatch for ${l.id}`)
        .toBeCloseTo(subsetResult.get(l.id)!, 10);
    }
  }, 60000);
});

// ──────────────────────────────────────────────────────────────────────────────
// Plan 020: Regression — large single-chunk result must not crash with
// RangeError: Maximum call stack size exceeded (spread-push over unbounded rows)
// ──────────────────────────────────────────────────────────────────────────────

describe("large single-chunk result (regression: spread-push RangeError)", () => {
  const OVERFLOW_SKIN = "★ Stress Knife | Overflow";

  beforeAll(async () => {
    resetKnnCache();
    // Seed 200,000 observations for a single FT (Field-Tested: 0.15–0.38) pair
    // via a server-side INSERT/generate_series — fast (~1-2s), no client round-trips.
    // Floats stay inside FT bounds; prices vary 1000–1499.
    await pool.query(`
      INSERT INTO price_observations (skin_name, float_value, price_cents, source, observed_at)
      SELECT
        $1,
        0.15 + (random() * 0.23),
        1000 + (g % 500),
        'sale',
        NOW() - (random() * INTERVAL '170 days')
      FROM generate_series(1, 200000) g
    `, [OVERFLOW_SKIN]);
  }, 60000);

  afterAll(async () => {
    await pool.query(
      `DELETE FROM price_observations WHERE skin_name = $1`,
      [OVERFLOW_SKIN],
    );
  });

  it("resolves with a finite ratio for a single FT listing (200K obs, no RangeError)", async () => {
    resetKnnCache();
    const listing = {
      id: "overflow-1",
      skin_name: OVERFLOW_SKIN,
      float_value: 0.20,
      price_cents: 1200,
    };
    const result = await batchInputValueRatios(pool, [listing]);
    expect(result.size).toBe(1);
    const ratio = result.get("overflow-1");
    expect(typeof ratio).toBe("number");
    expect(Number.isFinite(ratio)).toBe(true);
    expect(ratio).toBeGreaterThan(0);
  }, 60000);
});
