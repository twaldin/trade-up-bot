import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const { Pool } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Keep SQLite path reference for session store (sessions stay in SQLite)
export const DB_PATH = path.join(__dirname, "..", "data", "tradeup.db");

let _pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!_pool) {
    throw new Error("Use initDb() first");
  }
  return _pool;
}

/** Initialize PostgreSQL connection pool. */
export function initDb(): pg.Pool {
  if (_pool) return _pool;

  const connectionString = process.env.DATABASE_URL
    || "postgresql://tradeupbot:tradeupbot_pg_2026@localhost:5432/tradeupbot";

  _pool = new Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  _pool.on("error", (err) => {
    console.error("Unexpected PG pool error:", err.message);
  });

  console.log("PostgreSQL pool initialized");
  return _pool;
}

/** Create all tables if they don't exist. Run once at startup.
 *  Skips if tables already exist (fast path for normal restarts). */
export async function createTables(pool: pg.Pool): Promise<void> {
  // Fast check: if trade_ups table exists, schema is already set up — skip CREATE but still run migrations
  const { rows } = await pool.query(
    "SELECT 1 FROM information_schema.tables WHERE table_name = 'trade_ups' LIMIT 1"
  );
  const tablesExist = rows.length > 0;
  if (!tablesExist) {
  await pool.query(`
    -- Static skin/collection data (from ByMykel/CSGO-API)
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
      PRIMARY KEY (skin_id, collection_id),
      FOREIGN KEY (skin_id) REFERENCES skins(id),
      FOREIGN KEY (collection_id) REFERENCES collections(id)
    );

    -- Market data (from CSFloat/pricing APIs)
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
      price_updated_at TIMESTAMPTZ,
      FOREIGN KEY (skin_id) REFERENCES skins(id)
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

    -- Calculated trade-ups
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
      ,input_sources TEXT[] NOT NULL DEFAULT '{}'
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

    -- Sale history (from CSFloat sold listings)
    CREATE TABLE IF NOT EXISTS sale_history (
      id TEXT PRIMARY KEY,
      skin_name TEXT NOT NULL,
      condition TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      float_value DOUBLE PRECISION NOT NULL,
      sold_at TIMESTAMPTZ NOT NULL,
      source TEXT NOT NULL DEFAULT 'csfloat'
    );

    -- Track persistent sale fetch errors (403s) to avoid wasting budget
    CREATE TABLE IF NOT EXISTS sale_fetch_errors (
      market_hash_name TEXT PRIMARY KEY,
      error_code INTEGER NOT NULL,
      error_count INTEGER NOT NULL DEFAULT 1,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Collection profitability scores
    CREATE TABLE IF NOT EXISTS collection_scores (
      collection_id TEXT PRIMARY KEY,
      collection_name TEXT NOT NULL,
      profitable_count INTEGER NOT NULL DEFAULT 0,
      avg_profit_cents INTEGER NOT NULL DEFAULT 0,
      max_profit_cents INTEGER NOT NULL DEFAULT 0,
      avg_roi DOUBLE PRECISION NOT NULL DEFAULT 0,
      total_tradeups INTEGER NOT NULL DEFAULT 0,
      priority_score DOUBLE PRECISION NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      FOREIGN KEY (collection_id) REFERENCES collections(id)
    );

    -- Sync metadata
    CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Float-range-specific pricing
    CREATE TABLE IF NOT EXISTS float_price_data (
      skin_name TEXT NOT NULL,
      float_min DOUBLE PRECISION NOT NULL,
      float_max DOUBLE PRECISION NOT NULL,
      avg_price_cents INTEGER NOT NULL,
      listing_count INTEGER NOT NULL DEFAULT 0,
      last_checked TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (skin_name, float_min, float_max)
    );

    -- Theory validation tracking
    CREATE TABLE IF NOT EXISTS theory_validations (
      trade_up_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      price_deviation DOUBLE PRECISION NOT NULL DEFAULT 0,
      notes TEXT,
      PRIMARY KEY (trade_up_id),
      FOREIGN KEY (trade_up_id) REFERENCES trade_ups(id) ON DELETE CASCADE
    );

    -- Theory tracking
    CREATE TABLE IF NOT EXISTS theory_tracking (
      combo_key TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      theory_profit_cents INTEGER NOT NULL DEFAULT 0,
      real_profit_cents INTEGER,
      gap_cents INTEGER NOT NULL DEFAULT 0,
      cost_gap_cents INTEGER NOT NULL DEFAULT 0,
      ev_gap_cents INTEGER NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 1,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_profitable_at TIMESTAMPTZ,
      cooldown_until TIMESTAMPTZ,
      notes TEXT
    );

    -- Near-miss data
    CREATE TABLE IF NOT EXISTS near_misses (
      combo_key TEXT PRIMARY KEY,
      gap_cents INTEGER NOT NULL,
      theory_profit_cents INTEGER NOT NULL,
      real_profit_cents INTEGER NOT NULL,
      collections TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Price observations
    CREATE TABLE IF NOT EXISTS price_observations (
      id SERIAL PRIMARY KEY,
      skin_name TEXT NOT NULL,
      float_value DOUBLE PRECISION NOT NULL,
      price_cents INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'listing',
      observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Profitable combo history
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
      combo_type TEXT NOT NULL DEFAULT 'knife',
      notes TEXT
    );

    -- Daemon event feed
    CREATE TABLE IF NOT EXISTS daemon_events (
      id SERIAL PRIMARY KEY,
      event_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      detail TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Market snapshots
    CREATE TABLE IF NOT EXISTS market_snapshots (
      id SERIAL PRIMARY KEY,
      snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      cycle INTEGER,
      type TEXT NOT NULL DEFAULT 'covert_knife',
      total_tradeups INTEGER NOT NULL DEFAULT 0,
      profitable_count INTEGER NOT NULL DEFAULT 0,
      best_profit_cents INTEGER NOT NULL DEFAULT 0,
      avg_profit_cents INTEGER NOT NULL DEFAULT 0,
      best_roi DOUBLE PRECISION NOT NULL DEFAULT 0,
      avg_cost_cents INTEGER NOT NULL DEFAULT 0,
      avg_chance DOUBLE PRECISION NOT NULL DEFAULT 0,
      coverage_skins INTEGER NOT NULL DEFAULT 0,
      coverage_listings INTEGER NOT NULL DEFAULT 0,
      theory_count INTEGER NOT NULL DEFAULT 0,
      theory_profitable INTEGER NOT NULL DEFAULT 0,
      near_miss_count INTEGER NOT NULL DEFAULT 0,
      closest_gap_cents INTEGER,
      cooldowns_active INTEGER NOT NULL DEFAULT 0,
      api_listing_remaining INTEGER,
      api_sale_remaining INTEGER,
      api_individual_remaining INTEGER
    );

    -- Snapshot top trade-ups
    CREATE TABLE IF NOT EXISTS snapshot_tradeups (
      id SERIAL PRIMARY KEY,
      snapshot_id INTEGER NOT NULL,
      rank INTEGER NOT NULL,
      trade_up_id INTEGER NOT NULL,
      profit_cents INTEGER NOT NULL,
      roi_percentage DOUBLE PRECISION NOT NULL,
      total_cost_cents INTEGER NOT NULL,
      chance_to_profit DOUBLE PRECISION NOT NULL,
      best_case_cents INTEGER NOT NULL DEFAULT 0,
      worst_case_cents INTEGER NOT NULL DEFAULT 0,
      is_theoretical BOOLEAN NOT NULL DEFAULT false,
      source TEXT,
      combo_key TEXT,
      collections TEXT NOT NULL,
      input_skins TEXT NOT NULL,
      output_skins TEXT NOT NULL,
      FOREIGN KEY (snapshot_id) REFERENCES market_snapshots(id) ON DELETE CASCADE
    );

    -- Staircase trade-ups
    CREATE TABLE IF NOT EXISTS staircase_trade_ups (
      id SERIAL PRIMARY KEY,
      trade_up_id INTEGER REFERENCES trade_ups(id) ON DELETE CASCADE,
      stage1_trade_up_ids TEXT NOT NULL,
      manufacturing_edge_cents INTEGER NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Trade-up claims
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

    -- Users
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

    -- Daemon cycle stats
    CREATE TABLE IF NOT EXISTS daemon_cycle_stats (
      id SERIAL PRIMARY KEY,
      daemon_version TEXT NOT NULL DEFAULT 'knife-v2',
      cycle INTEGER,
      started_at TIMESTAMPTZ,
      duration_ms INTEGER,
      api_calls_used INTEGER,
      api_limit_detected INTEGER,
      api_available INTEGER,
      knife_tradeups_total INTEGER,
      knife_profitable INTEGER,
      theories_generated INTEGER,
      theories_profitable INTEGER,
      gaps_filled INTEGER,
      cooldown_passes INTEGER,
      cooldown_new_found INTEGER,
      cooldown_improved INTEGER,
      top_profit_cents INTEGER,
      avg_profit_cents INTEGER,
      classified_total INTEGER,
      classified_profitable INTEGER,
      classified_theories INTEGER,
      classified_theories_profitable INTEGER
    );
  `);

  } // end if (!tablesExist)

  // Migrations for existing databases
  await pool.query(`
    ALTER TABLE trade_ups ADD COLUMN IF NOT EXISTS input_sources TEXT[] NOT NULL DEFAULT '{}';
  `);

  // User trade-up lifecycle tracking (My Trade-Ups)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_trade_ups (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(steam_id),
      trade_up_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'purchased',
      snapshot_inputs JSONB NOT NULL,
      snapshot_outcomes JSONB NOT NULL,
      total_cost_cents INTEGER NOT NULL,
      expected_value_cents INTEGER NOT NULL,
      roi_percentage DOUBLE PRECISION NOT NULL,
      chance_to_profit DOUBLE PRECISION NOT NULL,
      best_case_cents INTEGER NOT NULL,
      worst_case_cents INTEGER NOT NULL,
      type TEXT NOT NULL,
      purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      executed_at TIMESTAMPTZ,
      sold_at TIMESTAMPTZ,
      outcome_skin_id TEXT,
      outcome_skin_name TEXT,
      outcome_condition TEXT,
      outcome_float DOUBLE PRECISION,
      sold_price_cents INTEGER,
      sold_marketplace TEXT,
      actual_profit_cents INTEGER,
      UNIQUE(user_id, trade_up_id)
    );
  `);

  // Create indexes
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_skins_rarity ON skins(rarity);
    CREATE INDEX IF NOT EXISTS idx_listings_skin_id ON listings(skin_id);
    CREATE INDEX IF NOT EXISTS idx_listings_source ON listings(source);
    CREATE INDEX IF NOT EXISTS idx_skin_collections_collection ON skin_collections(collection_id);
    CREATE INDEX IF NOT EXISTS idx_trade_ups_profit ON trade_ups(profit_cents DESC);
    CREATE INDEX IF NOT EXISTS idx_trade_ups_roi ON trade_ups(roi_percentage DESC);
    CREATE INDEX IF NOT EXISTS idx_trade_up_inputs_trade ON trade_up_inputs(trade_up_id);
    CREATE INDEX IF NOT EXISTS idx_trade_ups_theoretical ON trade_ups(is_theoretical, type, profit_cents DESC);
    CREATE INDEX IF NOT EXISTS idx_trade_ups_type_profit ON trade_ups(type, profit_cents DESC);
    CREATE INDEX IF NOT EXISTS idx_trade_ups_type_roi ON trade_ups(type, roi_percentage DESC);
    CREATE INDEX IF NOT EXISTS idx_trade_ups_type_cost ON trade_ups(type, total_cost_cents);
    CREATE INDEX IF NOT EXISTS idx_trade_ups_type_ev ON trade_ups(type, expected_value_cents DESC);
    CREATE INDEX IF NOT EXISTS idx_trade_ups_type_chance ON trade_ups(type, chance_to_profit DESC);
    CREATE INDEX IF NOT EXISTS idx_trade_ups_type_best ON trade_ups(type, best_case_cents DESC);
    CREATE INDEX IF NOT EXISTS idx_trade_ups_type_worst ON trade_ups(type, worst_case_cents DESC);
    CREATE INDEX IF NOT EXISTS idx_sale_history_skin ON sale_history(skin_name, condition);
    CREATE INDEX IF NOT EXISTS idx_sale_history_sold ON sale_history(sold_at);
    CREATE INDEX IF NOT EXISTS idx_theory_validations_status ON theory_validations(status);
    CREATE INDEX IF NOT EXISTS idx_theory_tracking_status ON theory_tracking(status);
    CREATE INDEX IF NOT EXISTS idx_theory_tracking_cooldown ON theory_tracking(cooldown_until);
    CREATE INDEX IF NOT EXISTS idx_price_obs_skin_float ON price_observations(skin_name, float_value);
    CREATE INDEX IF NOT EXISTS idx_price_obs_skin ON price_observations(skin_name);
    CREATE INDEX IF NOT EXISTS idx_skins_name_stattrak ON skins(name, stattrak);
    CREATE INDEX IF NOT EXISTS idx_trade_up_inputs_listing ON trade_up_inputs(listing_id);
    CREATE INDEX IF NOT EXISTS idx_skins_weapon_stattrak ON skins(weapon, stattrak);
    CREATE INDEX IF NOT EXISTS idx_price_data_source ON price_data(source);
    CREATE INDEX IF NOT EXISTS idx_trade_up_inputs_skin ON trade_up_inputs(skin_name);
    CREATE INDEX IF NOT EXISTS idx_trade_up_inputs_skin_tuid ON trade_up_inputs(skin_name, trade_up_id);
    CREATE INDEX IF NOT EXISTS idx_trade_up_inputs_collection_tuid ON trade_up_inputs(collection_name, trade_up_id);
    CREATE INDEX IF NOT EXISTS idx_trade_up_inputs_listing ON trade_up_inputs(listing_id);
    CREATE INDEX IF NOT EXISTS idx_listings_stattrak_type_price ON listings(stattrak, listing_type, price_cents);
    CREATE INDEX IF NOT EXISTS idx_listings_skin_stattrak_price ON listings(skin_id, stattrak, price_cents);
    CREATE INDEX IF NOT EXISTS idx_listings_float_stattrak ON listings(float_value, stattrak);
    CREATE INDEX IF NOT EXISTS idx_float_price_data_listing_count ON float_price_data(listing_count);
    CREATE INDEX IF NOT EXISTS idx_trade_ups_listing_status ON trade_ups(listing_status, preserved_at);
    CREATE INDEX IF NOT EXISTS idx_trade_ups_peak_profit ON trade_ups(peak_profit_cents DESC);
    CREATE INDEX IF NOT EXISTS idx_profitable_combos_profit ON profitable_combos(best_profit_cents DESC);
    CREATE INDEX IF NOT EXISTS idx_daemon_events_created ON daemon_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_snapshots_at ON market_snapshots(snapshot_at);
    CREATE INDEX IF NOT EXISTS idx_snapshots_type ON market_snapshots(type, snapshot_at);
    CREATE INDEX IF NOT EXISTS idx_snapshot_tradeups_snapshot ON snapshot_tradeups(snapshot_id);
    CREATE INDEX IF NOT EXISTS idx_snapshot_tradeups_combo ON snapshot_tradeups(combo_key, snapshot_id);
    CREATE INDEX IF NOT EXISTS idx_staircase_trade_up ON staircase_trade_ups(trade_up_id);
    CREATE INDEX IF NOT EXISTS idx_claims_active ON trade_up_claims(trade_up_id) WHERE released_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_user_trade_ups_user ON user_trade_ups(user_id, status);
  `);

  // Partial indexes for API hot path (active, non-theoretical trade-ups)
  await pool.query(`
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
    CREATE INDEX IF NOT EXISTS idx_tu_active_sources ON trade_ups USING GIN(input_sources)
      WHERE is_theoretical = false AND listing_status = 'active';
    CREATE INDEX IF NOT EXISTS idx_tui_source ON trade_up_inputs(source);
  `);

  // Unique index for price_observations dedup
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_price_obs_dedup ON price_observations(skin_name, float_value, price_cents, source);
  `);

  // Partial index for listings with price_updated_at
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_listings_price_updated ON listings(price_updated_at) WHERE price_updated_at IS NOT NULL;
  `);

  // Drop unused trade_up_outcomes table (outcomes stored as JSON in trade_ups.outcomes_json)
  await pool.query(`DROP TABLE IF EXISTS trade_up_outcomes;`);

  // Migrate INTEGER boolean columns to BOOLEAN (idempotent — checks column type first)
  // Must drop DEFAULT before ALTER TYPE (PG can't auto-cast DEFAULT 0 to boolean), then set new DEFAULT.
  // Use CASE expression for the cast (PG has no direct integer→boolean cast operator).
  const boolMigrations = [
    { table: "skins", column: "stattrak" },
    { table: "skins", column: "souvenir" },
    { table: "listings", column: "stattrak" },
    { table: "trade_ups", column: "is_theoretical" },
    { table: "snapshot_tradeups", column: "is_theoretical" },
    { table: "users", column: "is_admin" },
  ];
  for (const { table, column } of boolMigrations) {
    const { rows } = await pool.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2 AND data_type='integer'`,
      [table, column]
    );
    if (rows.length > 0) {
      console.log(`  Migrating ${table}.${column} INTEGER → BOOLEAN...`);
      // Drop indexes that reference this column (partial indexes with = 0/1 block ALTER TYPE)
      const { rows: idxRows } = await pool.query(
        `SELECT indexname, indexdef FROM pg_indexes WHERE tablename=$1 AND indexdef LIKE '%' || $2 || '%'`,
        [table, column]
      );
      const droppedIndexes: { name: string; def: string }[] = [];
      for (const idx of idxRows) {
        console.log(`    Dropping index ${idx.indexname} (references ${column})...`);
        await pool.query(`DROP INDEX IF EXISTS ${idx.indexname}`);
        droppedIndexes.push({ name: idx.indexname, def: idx.indexdef });
      }
      await pool.query(`ALTER TABLE ${table} ALTER COLUMN ${column} DROP DEFAULT`);
      await pool.query(`ALTER TABLE ${table} ALTER COLUMN ${column} TYPE BOOLEAN USING CASE WHEN ${column} = 0 THEN false ELSE true END`);
      await pool.query(`ALTER TABLE ${table} ALTER COLUMN ${column} SET DEFAULT false`);
      // Recreate indexes with boolean conditions (= 0 → = false, = 1 → = true)
      for (const idx of droppedIndexes) {
        const newDef = idx.def.replace(/= 0/g, "= false").replace(/= 1/g, "= true");
        console.log(`    Recreating index ${idx.name}...`);
        await pool.query(newDef);
      }
    }
  }
}

export async function getSyncMeta(pool: pg.Pool, key: string): Promise<string | null> {
  const { rows } = await pool.query("SELECT value FROM sync_meta WHERE key = $1", [key]);
  return rows[0]?.value ?? null;
}

export async function setSyncMeta(pool: pg.Pool, key: string, value: string): Promise<void> {
  await pool.query(
    "INSERT INTO sync_meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2",
    [key, value]
  );
}

export async function emitEvent(pool: pg.Pool, type: string, summary: string, detail?: string): Promise<void> {
  await pool.query(
    "INSERT INTO daemon_events (event_type, summary, detail) VALUES ($1, $2, $3)",
    [type, summary, detail ?? null]
  );
}

export async function purgeOldEvents(pool: pg.Pool, maxAgeHours = 6): Promise<void> {
  await pool.query(
    "DELETE FROM daemon_events WHERE created_at < NOW() - $1 * INTERVAL '1 hour'",
    [maxAgeHours]
  );
}
