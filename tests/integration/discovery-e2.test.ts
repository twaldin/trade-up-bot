/**
 * E2 — reverse output-targeting (integration).
 *
 * Seeds a Classified collection whose Covert output has a steep FN/MW price
 * cliff plus input listings capable of landing under the FN boundary, and
 * asserts that findProfitableTradeUps produces e2:*-tagged results (the
 * reverse-targeting pass fired), that the pass runs only on the deadline
 * (worker) path, and that results are deterministic.
 *
 * Integration (not unit) because findProfitableTradeUps needs a pg.Pool for
 * the price cache + evaluateTradeUp output pricing.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { findProfitableTradeUps } from "../../server/engine/discovery.js";
import { CONDITION_BOUNDS } from "../../server/engine/types.js";

const { Pool } = pg;

async function createSchema(pool: pg.Pool): Promise<string> {
  const schema = `test_disc_e2_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
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
      collection_names TEXT[] NOT NULL DEFAULT '{}',
      discovered_via TEXT
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

// One Classified collection: input skin with LOW-float listings (can land the
// output under the FN boundary) and a Covert output with a steep FN premium.
async function seedFixtures(pool: pg.Pool) {
  await pool.query(`INSERT INTO collections (id, name) VALUES ('col-e2', 'E2 Collection')`);
  await pool.query(
    `INSERT INTO skins (id, name, weapon, rarity, min_float, max_float) VALUES ('skin-in', 'AK-47 | Input', 'AK-47', 'Classified', 0.0, 1.0)`
  );
  await pool.query(
    `INSERT INTO skins (id, name, weapon, rarity, min_float, max_float) VALUES ('skin-out', 'AWP | Cliff', 'AWP', 'Covert', 0.0, 0.8)`
  );
  await pool.query(
    `INSERT INTO skin_collections (skin_id, collection_id) VALUES ('skin-in','col-e2'),('skin-out','col-e2')`
  );

  // 30 listings; the cheapest 10 by low-float sit well under adjusted 0.0855
  // (0.07/0.8 - 0.002), so the FN target is feasible.
  let seq = 0;
  const floats = [
    0.01, 0.02, 0.03, 0.04, 0.05, 0.055, 0.06, 0.065, 0.07, 0.075,
    0.10, 0.12, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50,
    0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90, 0.93, 0.95,
  ];
  for (const f of floats) {
    await pool.query(
      `INSERT INTO listings (id, skin_id, price_cents, float_value, source) VALUES ($1,'skin-in',$2,$3,'csfloat')`,
      [`lst-${seq++}`, Math.round(800 + f * 1000), f]
    );
  }

  // Steep FN cliff: FN $500, everything else $30.
  for (const { name: cond } of CONDITION_BOUNDS) {
    const price = cond === "Factory New" ? 50000 : 3000;
    await pool.query(
      `INSERT INTO price_data (skin_name, condition, avg_price_cents, median_price_cents, min_price_cents, volume, source)
       VALUES ('AWP | Cliff', $1, $2, $2, $2, 10, 'csfloat_ref')`,
      [cond, price]
    );
  }
}

describe("discovery E2 reverse output-targeting (integration)", () => {
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
    if (pool && schema) await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    if (pool) await pool.end();
  });

  it("produces e2-tagged results on the deadline (worker) path", async () => {
    const results = await findProfitableTradeUps(pool, {
      rarities: ["Classified"],
      deadlineMs: Date.now() + 60_000,
      limit: 10000,
    });
    expect(results.length).toBeGreaterThan(0);
    const e2 = results.filter(tu => tu.discovered_via?.startsWith("e2:"));
    expect(e2.length).toBeGreaterThan(0);
    // The e2 picks target the FN boundary: avg adjusted float must sit under
    // the adjusted FN target for the output skin (0.07/0.8 - 0.002 = 0.0855).
    for (const tu of e2) {
      const avg = tu.inputs.reduce((s, i) => s + i.float_value, 0) / tu.inputs.length;
      expect(avg).toBeLessThanOrEqual(0.0855 + 1e-9); // inputs span 0..1 => adjusted == raw
      expect(tu.inputs).toHaveLength(10);
    }
  }, 120_000);

  it("does NOT run E2 without a deadline (inline fallback unchanged)", async () => {
    const results = await findProfitableTradeUps(pool, {
      rarities: ["Classified"],
      limit: 10000,
    });
    expect(results.length).toBeGreaterThan(0); // Steps 1-2 still run
    expect(results.every(tu => !tu.discovered_via?.startsWith("e2:"))).toBe(true);
  }, 120_000);

  it("is deterministic across runs", async () => {
    const run = async () =>
      (await findProfitableTradeUps(pool, {
        rarities: ["Classified"],
        deadlineMs: Date.now() + 60_000,
        limit: 10000,
      }))
        .filter(tu => tu.discovered_via?.startsWith("e2:"))
        .map(tu => tu.inputs.map(i => i.listing_id).slice().sort().join(","))
        .sort();
    const a = await run();
    const b = await run();
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
  }, 120_000);
});
