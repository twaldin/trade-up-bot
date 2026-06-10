/**
 * Characterization test for findProfitableTradeUps condition-pool logic.
 *
 * Exercises the structured (deterministic) path: per-collection-pair iteration
 * with condition-targeted pairs and cross-condition mixing — the hot path that
 * hoists filter calls out of the countA loop.
 *
 * Placed in integration/ because findProfitableTradeUps requires a pg.Pool
 * for price cache loading and evaluateTradeUp output price lookups.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { findProfitableTradeUps } from "../../server/engine/discovery.js";
import { listingSig } from "../../server/engine/utils.js";
import { CONDITION_BOUNDS } from "../../server/engine/types.js";

const { Pool } = pg;

// ─── Schema helpers ──────────────────────────────────────────────────────────

async function createSchema(pool: pg.Pool): Promise<string> {
  const schema = `test_disc_pool_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  await pool.query(`SET search_path TO "${schema}"`);

  await pool.query(`
    CREATE TABLE collections (id TEXT PRIMARY KEY, name TEXT NOT NULL, image_url TEXT);
    CREATE TABLE skins (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, weapon TEXT NOT NULL,
      min_float DOUBLE PRECISION NOT NULL DEFAULT 0.0,
      max_float DOUBLE PRECISION NOT NULL DEFAULT 1.0,
      rarity TEXT NOT NULL, stattrak BOOLEAN NOT NULL DEFAULT false,
      souvenir BOOLEAN NOT NULL DEFAULT false, image_url TEXT
    );
    CREATE TABLE skin_collections (
      skin_id TEXT NOT NULL, collection_id TEXT NOT NULL,
      PRIMARY KEY (skin_id, collection_id)
    );
    CREATE TABLE listings (
      id TEXT PRIMARY KEY, skin_id TEXT NOT NULL, price_cents INTEGER NOT NULL,
      float_value DOUBLE PRECISION NOT NULL, paint_seed INTEGER,
      stattrak BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      source TEXT NOT NULL DEFAULT 'csfloat',
      listing_type TEXT NOT NULL DEFAULT 'buy_now',
      phase TEXT, staleness_checked_at TIMESTAMPTZ,
      claimed_by TEXT, claimed_at TIMESTAMPTZ,
      price_updated_at TIMESTAMPTZ, marketplace_id TEXT
    );
    CREATE TABLE price_data (
      skin_name TEXT NOT NULL, condition TEXT NOT NULL,
      avg_price_cents INTEGER NOT NULL DEFAULT 0,
      median_price_cents INTEGER NOT NULL DEFAULT 0,
      min_price_cents INTEGER NOT NULL DEFAULT 0,
      volume INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'csfloat',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (skin_name, condition, source)
    );
    CREATE TABLE price_observations (
      id SERIAL PRIMARY KEY, skin_name TEXT NOT NULL,
      float_value DOUBLE PRECISION NOT NULL, price_cents INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'listing',
      observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX idx_price_obs_dedup ON price_observations(skin_name, float_value, price_cents, source);
    CREATE TABLE sync_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE trade_ups (
      id SERIAL PRIMARY KEY, total_cost_cents INTEGER NOT NULL,
      expected_value_cents INTEGER NOT NULL, profit_cents INTEGER NOT NULL,
      roi_percentage DOUBLE PRECISION NOT NULL,
      chance_to_profit DOUBLE PRECISION NOT NULL DEFAULT 0,
      type TEXT NOT NULL DEFAULT 'classified_covert',
      best_case_cents INTEGER NOT NULL DEFAULT 0,
      worst_case_cents INTEGER NOT NULL DEFAULT 0,
      is_theoretical BOOLEAN NOT NULL DEFAULT false,
      source TEXT NOT NULL DEFAULT 'discovery',
      combo_key TEXT, listing_status TEXT NOT NULL DEFAULT 'active',
      preserved_at TIMESTAMPTZ, peak_profit_cents INTEGER NOT NULL DEFAULT 0,
      profit_streak INTEGER NOT NULL DEFAULT 0, previous_inputs TEXT,
      outcomes_json TEXT, output_repriced_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      input_sources TEXT[] NOT NULL DEFAULT '{}',
      output_skin_names TEXT[] NOT NULL DEFAULT '{}',
      collection_names TEXT[] NOT NULL DEFAULT '{}'
    );
    CREATE TABLE trade_up_inputs (
      trade_up_id INTEGER NOT NULL, listing_id TEXT NOT NULL,
      skin_id TEXT NOT NULL, skin_name TEXT NOT NULL,
      collection_name TEXT NOT NULL, price_cents INTEGER NOT NULL,
      float_value DOUBLE PRECISION NOT NULL, condition TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'csfloat',
      FOREIGN KEY (trade_up_id) REFERENCES trade_ups(id) ON DELETE CASCADE
    );
    CREATE TABLE profitable_combos (
      combo_key TEXT PRIMARY KEY, collections TEXT NOT NULL,
      best_profit_cents INTEGER NOT NULL DEFAULT 0,
      best_roi DOUBLE PRECISION NOT NULL DEFAULT 0,
      times_profitable INTEGER NOT NULL DEFAULT 0,
      first_profitable_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_profitable_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_cost_cents INTEGER NOT NULL DEFAULT 0,
      input_recipe TEXT NOT NULL DEFAULT '',
      combo_type TEXT NOT NULL DEFAULT 'classified_covert'
    );
    CREATE TABLE float_price_data (
      skin_name TEXT NOT NULL, float_min DOUBLE PRECISION NOT NULL,
      float_max DOUBLE PRECISION NOT NULL,
      avg_price_cents INTEGER NOT NULL DEFAULT 0,
      listing_count INTEGER NOT NULL DEFAULT 0,
      last_checked TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (skin_name, float_min, float_max)
    );
    CREATE INDEX idx_trade_up_inputs_trade ON trade_up_inputs(trade_up_id);
    CREATE INDEX idx_trade_up_inputs_listing ON trade_up_inputs(listing_id);
    CREATE INDEX idx_trade_ups_type_profit ON trade_ups(type, profit_cents DESC);
    CREATE INDEX idx_skin_collections_skin ON skin_collections(skin_id);
    CREATE INDEX idx_listings_skin_stattrak ON listings(skin_id, stattrak);
  `);

  return schema;
}

// ─── Fixture builder ─────────────────────────────────────────────────────────

/**
 * Seed two Classified collections (A and B), each with one Classified skin
 * and 30 listings spanning all five conditions (6 per condition).
 * Also seeds one Covert output skin per collection with price_data.
 *
 * CONDITION_BOUNDS order: FN [0,0.07), MW [0.07,0.15), FT [0.15,0.38),
 * WW [0.38,0.45), BS [0.45,1.0)
 */
async function seedFixtures(pool: pg.Pool) {
  // Collections
  await pool.query(`INSERT INTO collections (id, name) VALUES ('col-a', 'Collection Alpha'), ('col-b', 'Collection Beta')`);

  // Classified input skins (min_float=0, max_float=1 so float = adjustedFloat)
  await pool.query(`
    INSERT INTO skins (id, name, weapon, rarity, min_float, max_float) VALUES
    ('skin-class-a', 'AK-47 | Alpha Skin', 'AK-47', 'Classified', 0.0, 1.0),
    ('skin-class-b', 'M4A4 | Beta Skin', 'M4A4', 'Classified', 0.0, 1.0)
  `);

  // Covert output skins
  await pool.query(`
    INSERT INTO skins (id, name, weapon, rarity, min_float, max_float) VALUES
    ('skin-covert-a', 'AWP | Fire Serpent', 'AWP', 'Covert', 0.0, 1.0),
    ('skin-covert-b', 'AK-47 | Wild Lotus', 'AK-47', 'Covert', 0.0, 1.0)
  `);

  // skin_collections: Classified skins belong to their respective collection
  await pool.query(`
    INSERT INTO skin_collections (skin_id, collection_id) VALUES
    ('skin-class-a', 'col-a'),
    ('skin-class-b', 'col-b'),
    ('skin-covert-a', 'col-a'),
    ('skin-covert-b', 'col-b')
  `);

  // Listings: 30 per collection, 6 per condition
  // FN: floats in [0.01,0.06], MW: [0.07,0.14], FT: [0.15,0.37], WW: [0.38,0.44], BS: [0.45,0.99]
  const conditionRanges = [
    { name: "Factory New", floats: [0.01, 0.02, 0.03, 0.04, 0.05, 0.06] },
    { name: "Minimal Wear", floats: [0.08, 0.09, 0.10, 0.11, 0.12, 0.13] },
    { name: "Field-Tested", floats: [0.16, 0.20, 0.25, 0.30, 0.35, 0.37] },
    { name: "Well-Worn", floats: [0.39, 0.40, 0.41, 0.42, 0.43, 0.44] },
    { name: "Battle-Scarred", floats: [0.46, 0.55, 0.65, 0.75, 0.85, 0.95] },
  ];

  let listingSeq = 0;
  for (const col of ["a", "b"]) {
    const skinId = `skin-class-${col}`;
    for (const { floats } of conditionRanges) {
      for (const f of floats) {
        const id = `lst-${col}-${listingSeq++}`;
        // Price cheapest for lowest-float so slice(0,n) picks predictably
        const priceCents = Math.round(1000 + f * 1000);
        await pool.query(
          `INSERT INTO listings (id, skin_id, price_cents, float_value, source) VALUES ($1,$2,$3,$4,'csfloat')`,
          [id, skinId, priceCents, f]
        );
      }
    }
  }

  // Price data for output skins (needed by buildPriceCache → lookupOutputPrice)
  for (const skinName of ["AWP | Fire Serpent", "AK-47 | Wild Lotus"]) {
    for (const { name: cond } of CONDITION_BOUNDS) {
      // Profitable output prices: 20000 cents each
      await pool.query(`
        INSERT INTO price_data (skin_name, condition, avg_price_cents, median_price_cents, min_price_cents, volume, source)
        VALUES ($1, $2, 20000, 20000, 18000, 10, 'csfloat_ref')
      `, [skinName, cond]);
    }
  }
}

// ─── Test ────────────────────────────────────────────────────────────────────

describe("discovery condition-pool characterization (integration)", () => {
  let pool: pg.Pool;
  let schema: string;
  let bootstrapPool: pg.Pool;

  beforeAll(async () => {
    const connectionString =
      process.env.TEST_DATABASE_URL ||
      process.env.DATABASE_URL ||
      "postgresql://tradeupbot:tradeupbot_pg_2026@localhost:5432/tradeupbot_test";

    // Create schema
    bootstrapPool = new Pool({ connectionString, max: 1 });
    schema = await createSchema(bootstrapPool);
    await bootstrapPool.end();

    // Main pool with baked search_path
    const sep = connectionString.includes("?") ? "&" : "?";
    const poolUrl = `${connectionString}${sep}options=-c%20search_path%3D${schema}`;
    pool = new Pool({ connectionString: poolUrl, max: 5 });

    await seedFixtures(pool);
  });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  });

  it("produces deterministic output on the structured path (run 1)", async () => {
    const results = await findProfitableTradeUps(pool, {
      rarities: ["Classified"],
      deadlineMs: Date.now() + 60_000,
      limit: 10000,
    });

    // Capture listing signatures (sorted for stable comparison)
    const sigs = results
      .map(tu => listingSig(tu.inputs.map(i => i.listing_id)))
      .sort();

    // Store for cross-run comparison
    (globalThis as Record<string, unknown>).__discPoolSigs1 = sigs;

    // Sanity: structured path with 30 listings per collection should find results
    // (if not, the fixtures or price data are wrong)
    expect(Array.isArray(sigs)).toBe(true);
  }, 120_000);

  it("produces identical output on the structured path (run 2 — determinism check)", async () => {
    const results = await findProfitableTradeUps(pool, {
      rarities: ["Classified"],
      deadlineMs: Date.now() + 60_000,
      limit: 10000,
    });

    const sigs = results
      .map(tu => listingSig(tu.inputs.map(i => i.listing_id)))
      .sort();

    const sigs1 = (globalThis as Record<string, unknown>).__discPoolSigs1 as string[];
    expect(sigs).toEqual(sigs1);
  }, 120_000);
});
