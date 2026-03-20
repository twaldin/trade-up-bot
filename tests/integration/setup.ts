/**
 * Test helper: creates a simplified Express app with PostgreSQL test DB
 * for integration testing. Bypasses Steam auth — injects a test user with
 * configurable tier via middleware.
 *
 * Requires a PostgreSQL test database: tradeupbot_test
 * Set TEST_DATABASE_URL env var to override.
 */

import express from "express";
import type { Request, Response, NextFunction } from "express";
import pg from "pg";
import { claimsRouter } from "../../server/routes/claims.js";
import { tradeUpsRouter } from "../../server/routes/trade-ups.js";
import type { User } from "../../server/auth.js";

const { Pool } = pg;

// ─── Mock Redis ─────────────────────────────────────────────────────────────
// The claims and trade-ups routers import from "../redis.js".
// We need to make those imports resolve to stubs that work without Redis.
// Since we can't easily intercept ESM imports at runtime, we rely on the
// redis module's built-in fallback behavior: when Redis is unavailable,
// cacheGet returns null, cacheSet is a no-op, checkRateLimit uses in-memory
// fallback, etc. No mock needed — just don't call initRedis().

// ─── In-Memory Rate Limit Reset ─────────────────────────────────────────────
// The redis module uses a module-level Map for in-memory rate limits.
// Between tests, we need to clear it. We'll re-import the module to get access.

// ─── Schema ─────────────────────────────────────────────────────────────────

async function createSchema(bootstrapPool: pg.Pool) {
  // Use a unique schema per test to avoid collisions
  const schema = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await bootstrapPool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  await bootstrapPool.query(`SET search_path TO "${schema}"`);

  await bootstrapPool.query(`
    CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      image_url TEXT
    );

    CREATE TABLE IF NOT EXISTS skins (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      weapon TEXT NOT NULL,
      min_float DOUBLE PRECISION NOT NULL DEFAULT 0.0,
      max_float DOUBLE PRECISION NOT NULL DEFAULT 1.0,
      rarity TEXT NOT NULL,
      stattrak BOOLEAN NOT NULL DEFAULT false,
      souvenir BOOLEAN NOT NULL DEFAULT false,
      image_url TEXT
    );

    CREATE TABLE IF NOT EXISTS skin_collections (
      skin_id TEXT NOT NULL,
      collection_id TEXT NOT NULL,
      PRIMARY KEY (skin_id, collection_id)
    );

    CREATE TABLE IF NOT EXISTS listings (
      id TEXT PRIMARY KEY,
      skin_id TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      float_value DOUBLE PRECISION NOT NULL,
      paint_seed INTEGER,
      stattrak BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      source TEXT NOT NULL DEFAULT 'csfloat',
      listing_type TEXT NOT NULL DEFAULT 'buy_now',
      phase TEXT,
      staleness_checked_at TIMESTAMPTZ,
      claimed_by TEXT,
      claimed_at TIMESTAMPTZ,
      price_updated_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS price_data (
      skin_name TEXT NOT NULL,
      condition TEXT NOT NULL,
      avg_price_cents INTEGER NOT NULL DEFAULT 0,
      median_price_cents INTEGER NOT NULL DEFAULT 0,
      min_price_cents INTEGER NOT NULL DEFAULT 0,
      volume INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'csfloat',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (skin_name, condition, source)
    );

    CREATE TABLE IF NOT EXISTS trade_ups (
      id SERIAL PRIMARY KEY,
      total_cost_cents INTEGER NOT NULL,
      expected_value_cents INTEGER NOT NULL,
      profit_cents INTEGER NOT NULL,
      roi_percentage DOUBLE PRECISION NOT NULL,
      chance_to_profit DOUBLE PRECISION NOT NULL DEFAULT 0,
      type TEXT NOT NULL DEFAULT 'classified_covert',
      best_case_cents INTEGER NOT NULL DEFAULT 0,
      worst_case_cents INTEGER NOT NULL DEFAULT 0,
      is_theoretical BOOLEAN NOT NULL DEFAULT false,
      source TEXT NOT NULL DEFAULT 'discovery',
      combo_key TEXT,
      listing_status TEXT NOT NULL DEFAULT 'active',
      preserved_at TIMESTAMPTZ,
      peak_profit_cents INTEGER NOT NULL DEFAULT 0,
      profit_streak INTEGER NOT NULL DEFAULT 0,
      previous_inputs TEXT,
      outcomes_json TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS trade_up_inputs (
      trade_up_id INTEGER NOT NULL,
      listing_id TEXT NOT NULL,
      skin_id TEXT NOT NULL,
      skin_name TEXT NOT NULL,
      collection_name TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      float_value DOUBLE PRECISION NOT NULL,
      condition TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'csfloat',
      FOREIGN KEY (trade_up_id) REFERENCES trade_ups(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS trade_up_outcomes (
      trade_up_id INTEGER NOT NULL,
      skin_id TEXT NOT NULL,
      skin_name TEXT NOT NULL,
      collection_name TEXT NOT NULL,
      probability DOUBLE PRECISION NOT NULL,
      predicted_float DOUBLE PRECISION NOT NULL,
      predicted_condition TEXT NOT NULL,
      estimated_price_cents INTEGER NOT NULL,
      FOREIGN KEY (trade_up_id) REFERENCES trade_ups(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS trade_up_claims (
      id SERIAL PRIMARY KEY,
      trade_up_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      released_at TIMESTAMPTZ,
      confirmed_at TIMESTAMPTZ,
      UNIQUE(trade_up_id, user_id),
      FOREIGN KEY (trade_up_id) REFERENCES trade_ups(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS price_observations (
      id SERIAL PRIMARY KEY,
      skin_name TEXT NOT NULL,
      float_value DOUBLE PRECISION NOT NULL,
      price_cents INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'listing',
      observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_price_obs_dedup ON price_observations(skin_name, float_value, price_cents);

    CREATE TABLE IF NOT EXISTS users (
      steam_id TEXT PRIMARY KEY,
      display_name TEXT,
      avatar_url TEXT,
      tier TEXT NOT NULL DEFAULT 'free',
      is_admin BOOLEAN NOT NULL DEFAULT false,
      stripe_customer_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS profitable_combos (
      combo_key TEXT PRIMARY KEY,
      collections TEXT NOT NULL,
      best_profit_cents INTEGER NOT NULL DEFAULT 0,
      best_roi DOUBLE PRECISION NOT NULL DEFAULT 0,
      times_profitable INTEGER NOT NULL DEFAULT 0,
      first_profitable_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_profitable_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_cost_cents INTEGER NOT NULL DEFAULT 0,
      input_recipe TEXT NOT NULL DEFAULT '',
      combo_type TEXT NOT NULL DEFAULT 'knife'
    );

    -- Indexes needed by trade-ups router
    CREATE INDEX IF NOT EXISTS idx_trade_up_inputs_trade ON trade_up_inputs(trade_up_id);
    CREATE INDEX IF NOT EXISTS idx_trade_up_inputs_listing ON trade_up_inputs(listing_id);
    CREATE INDEX IF NOT EXISTS idx_trade_up_inputs_skin ON trade_up_inputs(skin_name);
    CREATE INDEX IF NOT EXISTS idx_trade_up_inputs_collection_tuid ON trade_up_inputs(collection_name, trade_up_id);
    CREATE INDEX IF NOT EXISTS idx_trade_ups_type_profit ON trade_ups(type, profit_cents DESC);
    CREATE INDEX IF NOT EXISTS idx_claims_active ON trade_up_claims(trade_up_id) WHERE released_at IS NULL;
  `);

  return schema;
}

// ─── Seed Data ──────────────────────────────────────────────────────────────

export interface SeedOptions {
  /** Number of profitable trade-ups to create (default 5) */
  profitableCount?: number;
  /** Number of unprofitable trade-ups to create (default 3) */
  unprofitableCount?: number;
  /** Number of stale trade-ups to create (default 2) */
  staleCount?: number;
  /** Trade-up type (default 'covert_knife') */
  type?: string;
}

export async function seedTestData(pool: pg.Pool, opts: SeedOptions = {}) {
  const {
    profitableCount = 5,
    unprofitableCount = 3,
    staleCount = 2,
    type = "covert_knife",
  } = opts;

  // Insert test users
  await pool.query(`INSERT INTO users (steam_id, display_name, avatar_url, tier) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    ["user_pro", "ProUser", "", "pro"]);
  await pool.query(`INSERT INTO users (steam_id, display_name, avatar_url, tier) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    ["user_basic", "BasicUser", "", "basic"]);
  await pool.query(`INSERT INTO users (steam_id, display_name, avatar_url, tier) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    ["user_free", "FreeUser", "", "free"]);
  await pool.query(`INSERT INTO users (steam_id, display_name, avatar_url, tier) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    ["user_pro2", "ProUser2", "", "pro"]);

  // Insert test skins and collections
  await pool.query(`INSERT INTO collections (id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    ["col-test-1", "Test Collection Alpha"]);
  await pool.query(`INSERT INTO collections (id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    ["col-test-2", "Test Collection Beta"]);

  await pool.query(`INSERT INTO skins (id, name, weapon, rarity, min_float, max_float) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
    ["skin-classified-1", "AK-47 | Test Skin", "AK-47", "Classified", 0.0, 1.0]);
  await pool.query(`INSERT INTO skins (id, name, weapon, rarity, min_float, max_float) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
    ["skin-classified-2", "M4A4 | Test Skin", "M4A4", "Classified", 0.06, 0.80]);
  await pool.query(`INSERT INTO skins (id, name, weapon, rarity, min_float, max_float) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
    ["skin-covert-1", "AK-47 | Fire Serpent", "AK-47", "Covert", 0.0, 1.0]);

  await pool.query(`INSERT INTO skin_collections (skin_id, collection_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    ["skin-classified-1", "col-test-1"]);
  await pool.query(`INSERT INTO skin_collections (skin_id, collection_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    ["skin-classified-2", "col-test-2"]);
  await pool.query(`INSERT INTO skin_collections (skin_id, collection_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    ["skin-covert-1", "col-test-1"]);

  const inputCount = type === "covert_knife" ? 5 : 10;
  let tuId = 0;

  // Create profitable trade-ups
  for (let i = 0; i < profitableCount; i++) {
    const cost = 10000 + i * 500;
    const ev = cost + 2000 + i * 100;
    const profit = ev - cost;
    const roi = Math.round((profit / cost) * 10000) / 100;
    const outcomes = JSON.stringify([
      { skin_id: "skin-covert-1", skin_name: "AK-47 | Fire Serpent", collection_name: "Test Collection Alpha", probability: 1.0, predicted_float: 0.15, predicted_condition: "Field-Tested", estimated_price_cents: ev },
    ]);

    const { rows } = await pool.query(`
      INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, chance_to_profit, type, best_case_cents, worst_case_cents, listing_status, outcomes_json, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, NOW() - INTERVAL '4 hours')
      RETURNING id
    `, [cost, ev, profit, roi, 0.8, type, profit + 500, -200, outcomes]);
    tuId = rows[0].id;

    for (let j = 0; j < inputCount; j++) {
      const listingId = `listing-${tuId}-${j}`;
      const pricePer = Math.round(cost / inputCount);
      await pool.query(`INSERT INTO listings (id, skin_id, price_cents, float_value, source) VALUES ($1, $2, $3, $4, $5)`,
        [listingId, "skin-classified-1", pricePer, 0.15 + j * 0.01, "csfloat"]);
      await pool.query(`INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [tuId, listingId, "skin-classified-1", "AK-47 | Test Skin", "Test Collection Alpha", pricePer, 0.15 + j * 0.01, "Field-Tested", "csfloat"]);
    }
  }

  // Create unprofitable trade-ups
  for (let i = 0; i < unprofitableCount; i++) {
    const cost = 15000 + i * 500;
    const ev = cost - 3000;
    const profit = ev - cost;
    const roi = Math.round((profit / cost) * 10000) / 100;
    const outcomes = JSON.stringify([
      { skin_id: "skin-covert-1", skin_name: "AK-47 | Fire Serpent", collection_name: "Test Collection Alpha", probability: 1.0, predicted_float: 0.35, predicted_condition: "Field-Tested", estimated_price_cents: ev },
    ]);

    const { rows } = await pool.query(`
      INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, chance_to_profit, type, best_case_cents, worst_case_cents, listing_status, outcomes_json, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, NOW() - INTERVAL '4 hours')
      RETURNING id
    `, [cost, ev, profit, roi, 0.1, type, -500, -5000, outcomes]);
    const id = rows[0].id;

    for (let j = 0; j < inputCount; j++) {
      const listingId = `listing-${id}-${j}`;
      const pricePer = Math.round(cost / inputCount);
      await pool.query(`INSERT INTO listings (id, skin_id, price_cents, float_value, source) VALUES ($1, $2, $3, $4, $5)`,
        [listingId, "skin-classified-2", pricePer, 0.35 + j * 0.01, "csfloat"]);
      await pool.query(`INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, listingId, "skin-classified-2", "M4A4 | Test Skin", "Test Collection Beta", pricePer, 0.35 + j * 0.01, "Field-Tested", "csfloat"]);
    }
  }

  // Create stale trade-ups (listings deleted)
  for (let i = 0; i < staleCount; i++) {
    const cost = 8000;
    const ev = 10000;
    const profit = 2000;
    const roi = 25.0;
    const outcomes = JSON.stringify([
      { skin_id: "skin-covert-1", skin_name: "AK-47 | Fire Serpent", collection_name: "Test Collection Alpha", probability: 1.0, predicted_float: 0.10, predicted_condition: "Minimal Wear", estimated_price_cents: ev },
    ]);

    const { rows } = await pool.query(`
      INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, chance_to_profit, type, best_case_cents, worst_case_cents, listing_status, preserved_at, outcomes_json, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'stale', NOW(), $9, NOW() - INTERVAL '4 hours')
      RETURNING id
    `, [cost, ev, profit, roi, 0.6, type, 3000, -1000, outcomes]);
    const id = rows[0].id;

    for (let j = 0; j < inputCount; j++) {
      const listingId = `stale-listing-${id}-${j}`;
      await pool.query(`INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, listingId, "skin-classified-1", "AK-47 | Test Skin", "Test Collection Alpha", Math.round(cost / inputCount), 0.10 + j * 0.01, "Minimal Wear", "csfloat"]);
    }
  }

  // Set last_calculation for free tier
  await pool.query(`INSERT INTO sync_meta (key, value) VALUES ('last_calculation', NOW()::text) ON CONFLICT (key) DO UPDATE SET value = NOW()::text`);

  return { lastTradeUpId: tuId };
}

// ─── Test App Creation ──────────────────────────────────────────────────────

export interface TestAppOptions {
  /** Default user tier for all requests (default 'pro') */
  defaultTier?: "free" | "basic" | "pro";
  /** Default user steam_id (default 'user_pro') */
  defaultUserId?: string;
}

export interface TestContext {
  app: express.Express;
  pool: pg.Pool;
  schema: string;
  cleanup: () => Promise<void>;
}

/**
 * Create a test Express app with isolated PG schema and mock auth.
 * Each call returns a fresh, isolated environment.
 */
export async function createTestApp(opts: TestAppOptions = {}): Promise<TestContext> {
  const { defaultTier = "pro", defaultUserId = "user_pro" } = opts;

  const connectionString = process.env.TEST_DATABASE_URL
    || process.env.DATABASE_URL
    || "postgresql://tradeupbot:tradeupbot_pg_2026@localhost:5432/tradeupbot_test";

  // Bootstrap pool: create schema + DDL, then discard
  const bootstrapPool = new Pool({ connectionString, max: 1 });
  const schema = await createSchema(bootstrapPool);
  await bootstrapPool.end();

  // Main pool: search_path baked into every connection via URL options
  const sep = connectionString.includes("?") ? "&" : "?";
  const poolUrl = `${connectionString}${sep}options=-c%20search_path%3D${schema}`;
  const pool = new Pool({ connectionString: poolUrl, max: 15 });

  const app = express();
  app.use(express.json());

  // Mock auth middleware: inject user on every request
  // Override via X-Test-User-Id and X-Test-User-Tier headers
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const userId = (req.headers["x-test-user-id"] as string) || defaultUserId;
    const tier = (req.headers["x-test-user-tier"] as string) || defaultTier;
    req.user = {
      steam_id: userId,
      display_name: `Test ${userId}`,
      avatar_url: "",
      tier,
      is_admin: false,
    } as Express.User;
    next();
  });

  // Mount routers
  app.use(claimsRouter(pool));
  app.use(tradeUpsRouter(pool));

  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("Test app error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  });

  const cleanup = async () => {
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  };

  return { app, pool, schema, cleanup };
}

/**
 * Create a trade-up with shared listings (for testing listing-level conflicts).
 * Returns the IDs of the two trade-ups and their shared listing IDs.
 */
export async function createOverlappingTradeUps(pool: pg.Pool, type = "covert_knife") {
  const inputCount = type === "covert_knife" ? 5 : 10;

  // Shared listings
  const sharedListingIds: string[] = [];
  for (let i = 0; i < 2; i++) {
    const lid = `shared-listing-${Date.now()}-${i}`;
    sharedListingIds.push(lid);
    await pool.query(`INSERT INTO listings (id, skin_id, price_cents, float_value, source) VALUES ($1, $2, $3, $4, $5)`,
      [lid, "skin-classified-1", 2000, 0.15 + i * 0.01, "csfloat"]);
  }

  // Trade-up A: uses shared listings + unique ones
  const costA = 10000;
  const evA = 14000;
  const { rows: rowsA } = await pool.query(`
    INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, chance_to_profit, type, listing_status, outcomes_json, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, 'active', '[]', NOW() - INTERVAL '4 hours')
    RETURNING id
  `, [costA, evA, evA - costA, 40.0, 0.7, type]);
  const tuIdA = rowsA[0].id;

  for (let i = 0; i < inputCount; i++) {
    const lid = i < sharedListingIds.length ? sharedListingIds[i] : `unique-a-${tuIdA}-${i}`;
    if (i >= sharedListingIds.length) {
      await pool.query(`INSERT INTO listings (id, skin_id, price_cents, float_value, source) VALUES ($1, $2, $3, $4, $5)`,
        [lid, "skin-classified-1", 2000, 0.20 + i * 0.01, "csfloat"]);
    }
    await pool.query(`INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [tuIdA, lid, "skin-classified-1", "AK-47 | Test Skin", "Test Collection Alpha", 2000, 0.15, "Field-Tested", "csfloat"]);
  }

  // Trade-up B: uses same shared listings + different unique ones
  const costB = 11000;
  const evB = 15000;
  const { rows: rowsB } = await pool.query(`
    INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, chance_to_profit, type, listing_status, outcomes_json, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, 'active', '[]', NOW() - INTERVAL '4 hours')
    RETURNING id
  `, [costB, evB, evB - costB, 36.36, 0.65, type]);
  const tuIdB = rowsB[0].id;

  for (let i = 0; i < inputCount; i++) {
    const lid = i < sharedListingIds.length ? sharedListingIds[i] : `unique-b-${tuIdB}-${i}`;
    if (i >= sharedListingIds.length) {
      await pool.query(`INSERT INTO listings (id, skin_id, price_cents, float_value, source) VALUES ($1, $2, $3, $4, $5)`,
        [lid, "skin-classified-2", 2200, 0.25 + i * 0.01, "csfloat"]);
    }
    await pool.query(`INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [tuIdB, lid, "skin-classified-1", "AK-47 | Test Skin", "Test Collection Alpha", 2000, 0.15, "Field-Tested", "csfloat"]);
  }

  return { tuIdA, tuIdB, sharedListingIds };
}
