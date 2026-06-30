/**
 * E4 — bounded 3-collection discovery step (integration smoke).
 *
 * Seeds THREE Classified collections with profitable Covert outputs and asserts
 * that the structured discovery path produces at least one trade-up whose inputs
 * span exactly 3 distinct collections. Step 1 (single) and Step 2 (pairs) can
 * only ever produce 1- or 2-collection combos, so a 3-collection result proves
 * the new Step 3 fired. Also asserts determinism (run1 == run2) and that the
 * deadline-less call does NOT emit 3-collection combos (Step 3 is deadline-gated).
 *
 * Integration (not unit) because findProfitableTradeUps needs a pg.Pool for the
 * price cache + evaluateTradeUp output pricing.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { findProfitableTradeUps } from "../../server/engine/discovery.js";
import { CONDITION_BOUNDS } from "../../server/engine/types.js";

const { Pool } = pg;

async function createSchema(pool: pg.Pool): Promise<string> {
  const schema = `test_disc_tri_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
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
    CREATE TABLE float_price_data (
      skin_name TEXT NOT NULL, float_min DOUBLE PRECISION NOT NULL,
      float_max DOUBLE PRECISION NOT NULL,
      avg_price_cents INTEGER NOT NULL DEFAULT 0,
      listing_count INTEGER NOT NULL DEFAULT 0,
      last_checked TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (skin_name, float_min, float_max)
    );
    CREATE INDEX idx_skin_collections_skin ON skin_collections(skin_id);
    CREATE INDEX idx_listings_skin_stattrak ON listings(skin_id, stattrak);
  `);

  return schema;
}

// Three Classified collections, each with one Classified input skin (30 listings
// across all conditions) and one profitable Covert output skin.
async function seedFixtures(pool: pg.Pool) {
  const cols = [
    { id: "col-a", name: "Collection Alpha", inSkin: "skin-class-a", inName: "AK-47 | Alpha Skin", weaponIn: "AK-47", outSkin: "skin-covert-a", outName: "AWP | Fire Serpent", weaponOut: "AWP" },
    { id: "col-b", name: "Collection Beta", inSkin: "skin-class-b", inName: "M4A4 | Beta Skin", weaponIn: "M4A4", outSkin: "skin-covert-b", outName: "AK-47 | Wild Lotus", weaponOut: "AK-47" },
    { id: "col-c", name: "Collection Gamma", inSkin: "skin-class-c", inName: "M4A1-S | Gamma Skin", weaponIn: "M4A1-S", outSkin: "skin-covert-c", outName: "M4A4 | Howl", weaponOut: "M4A4" },
  ];

  for (const c of cols) {
    await pool.query(`INSERT INTO collections (id, name) VALUES ($1, $2)`, [c.id, c.name]);
    await pool.query(
      `INSERT INTO skins (id, name, weapon, rarity, min_float, max_float) VALUES ($1,$2,$3,'Classified',0.0,1.0)`,
      [c.inSkin, c.inName, c.weaponIn]
    );
    await pool.query(
      `INSERT INTO skins (id, name, weapon, rarity, min_float, max_float) VALUES ($1,$2,$3,'Covert',0.0,1.0)`,
      [c.outSkin, c.outName, c.weaponOut]
    );
    await pool.query(`INSERT INTO skin_collections (skin_id, collection_id) VALUES ($1,$2),($3,$2)`,
      [c.inSkin, c.id, c.outSkin]);
  }

  const conditionRanges = [
    { floats: [0.01, 0.02, 0.03, 0.04, 0.05, 0.06] },
    { floats: [0.08, 0.09, 0.10, 0.11, 0.12, 0.13] },
    { floats: [0.16, 0.20, 0.25, 0.30, 0.35, 0.37] },
    { floats: [0.39, 0.40, 0.41, 0.42, 0.43, 0.44] },
    { floats: [0.46, 0.55, 0.65, 0.75, 0.85, 0.95] },
  ];

  let seq = 0;
  for (const c of cols) {
    for (const { floats } of conditionRanges) {
      for (const f of floats) {
        const id = `lst-${c.id}-${seq++}`;
        const priceCents = Math.round(1000 + f * 1000);
        await pool.query(
          `INSERT INTO listings (id, skin_id, price_cents, float_value, source) VALUES ($1,$2,$3,$4,'csfloat')`,
          [id, c.inSkin, priceCents, f]
        );
      }
    }
  }

  for (const c of cols) {
    for (const { name: cond } of CONDITION_BOUNDS) {
      await pool.query(`
        INSERT INTO price_data (skin_name, condition, avg_price_cents, median_price_cents, min_price_cents, volume, source)
        VALUES ($1, $2, 20000, 20000, 18000, 10, 'csfloat_ref')
      `, [c.outName, cond]);
    }
  }
}

const distinctCollections = (tu: { inputs: { collection_name: string }[] }) =>
  new Set(tu.inputs.map(i => i.collection_name)).size;

describe("discovery 3-collection step (E4, integration)", () => {
  let pool: pg.Pool;
  let schema: string;
  let bootstrapPool: pg.Pool;

  beforeAll(async () => {
    const connectionString =
      process.env.TEST_DATABASE_URL ||
      process.env.DATABASE_URL ||
      "postgresql://tradeupbot:tradeupbot_pg_2026@localhost:5432/tradeupbot_test";

    bootstrapPool = new Pool({ connectionString, max: 1 });
    schema = await createSchema(bootstrapPool);
    await bootstrapPool.end();

    const sep = connectionString.includes("?") ? "&" : "?";
    const poolUrl = `${connectionString}${sep}options=-c%20search_path%3D${schema}`;
    pool = new Pool({ connectionString: poolUrl, max: 5 });

    await seedFixtures(pool);
  });

  afterAll(async () => {
    // Guard against beforeAll failing before pool/schema were assigned, so a
    // setup error (e.g. DB unreachable) surfaces instead of a teardown TypeError.
    if (pool && schema) await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    if (pool) await pool.end();
  });

  it("produces at least one trade-up spanning 3 distinct collections (Step 3 fired)", async () => {
    const results = await findProfitableTradeUps(pool, {
      rarities: ["Classified"],
      deadlineMs: Date.now() + 60_000,
      limit: 10000,
    });
    expect(results.length).toBeGreaterThan(0);
    const triCombos = results.filter(tu => distinctCollections(tu) === 3);
    expect(triCombos.length).toBeGreaterThan(0);
    // Each 3-collection combo still has exactly 10 inputs.
    for (const tu of triCombos) expect(tu.inputs).toHaveLength(10);
  }, 120_000);

  it("is deterministic across runs (3-collection step included)", async () => {
    const run = async () =>
      (await findProfitableTradeUps(pool, {
        rarities: ["Classified"],
        deadlineMs: Date.now() + 60_000,
        limit: 10000,
      }))
        .map(tu => tu.inputs.map(i => i.listing_id).slice().sort().join(","))
        .sort();
    const a = await run();
    const b = await run();
    expect(b).toEqual(a);
  }, 120_000);

  it("does NOT emit 3-collection combos without a deadline (Step 3 is deadline-gated)", async () => {
    const results = await findProfitableTradeUps(pool, {
      rarities: ["Classified"],
      limit: 10000,
      // no deadlineMs → Step 3 must be skipped (unbounded-safety gate)
    });
    expect(results.length).toBeGreaterThan(0); // Steps 1-2 still run
    expect(results.every(tu => distinctCollections(tu) <= 2)).toBe(true);
  }, 120_000);
});
