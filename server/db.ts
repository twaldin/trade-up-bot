import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DB_PATH = path.join(__dirname, "..", "data", "tradeup.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    throw new Error("Use initDb() first");
  }
  return _db;
}

export function initDb(): Database.Database {
  if (_db) return _db;

  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  _db.pragma("busy_timeout = 30000"); // Wait up to 30s for concurrent writers

  createTables(_db);
  return _db;
}

function createTables(db: Database.Database) {
  db.exec(`
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
      min_float REAL NOT NULL DEFAULT 0.0,
      max_float REAL NOT NULL DEFAULT 1.0,
      rarity TEXT NOT NULL,
      stattrak INTEGER NOT NULL DEFAULT 0,
      souvenir INTEGER NOT NULL DEFAULT 0,
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
      float_value REAL NOT NULL,
      paint_seed INTEGER,
      stattrak INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      source TEXT NOT NULL DEFAULT 'csfloat',
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
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (skin_name, condition, source)
    );

    -- Calculated trade-ups
    CREATE TABLE IF NOT EXISTS trade_ups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      total_cost_cents INTEGER NOT NULL,
      expected_value_cents INTEGER NOT NULL,
      profit_cents INTEGER NOT NULL,
      roi_percentage REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS trade_up_inputs (
      trade_up_id INTEGER NOT NULL,
      listing_id TEXT NOT NULL,
      skin_id TEXT NOT NULL,
      skin_name TEXT NOT NULL,
      collection_name TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      float_value REAL NOT NULL,
      condition TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (trade_up_id) REFERENCES trade_ups(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS trade_up_outcomes (
      trade_up_id INTEGER NOT NULL,
      skin_id TEXT NOT NULL,
      skin_name TEXT NOT NULL,
      collection_name TEXT NOT NULL,
      probability REAL NOT NULL,
      predicted_float REAL NOT NULL,
      predicted_condition TEXT NOT NULL,
      estimated_price_cents INTEGER NOT NULL,
      FOREIGN KEY (trade_up_id) REFERENCES trade_ups(id) ON DELETE CASCADE
    );

    -- Migrations
    -- Add chance_to_profit column if missing
  `);

  // Safe column migrations
  const tuCols = db.pragma("table_info(trade_ups)") as { name: string }[];

  // Listing status tracking: 'active' | 'partial' | 'stale'
  if (!tuCols.some((c) => c.name === "listing_status")) {
    db.exec("ALTER TABLE trade_ups ADD COLUMN listing_status TEXT NOT NULL DEFAULT 'active'");
  }
  if (!tuCols.some((c) => c.name === "preserved_at")) {
    db.exec("ALTER TABLE trade_ups ADD COLUMN preserved_at TEXT");
  }
  if (!tuCols.some((c) => c.name === "peak_profit_cents")) {
    db.exec("ALTER TABLE trade_ups ADD COLUMN peak_profit_cents INTEGER NOT NULL DEFAULT 0");
    db.exec("UPDATE trade_ups SET peak_profit_cents = MAX(profit_cents, 0)");
  }
  if (!tuCols.some((c) => c.name === "chance_to_profit")) {
    db.exec("ALTER TABLE trade_ups ADD COLUMN chance_to_profit REAL NOT NULL DEFAULT 0");
  }
  if (!tuCols.some((c) => c.name === "previous_inputs")) {
    db.exec("ALTER TABLE trade_ups ADD COLUMN previous_inputs TEXT"); // JSON: old inputs before revival
  }

  const listingCols = db.pragma("table_info(listings)") as { name: string }[];
  if (!listingCols.some((c) => c.name === "listing_type")) {
    db.exec("ALTER TABLE listings ADD COLUMN listing_type TEXT NOT NULL DEFAULT 'buy_now'");
  }
  if (!listingCols.some((c) => c.name === "phase")) {
    db.exec("ALTER TABLE listings ADD COLUMN phase TEXT");
  }

  // Add trade-up type column (classified_covert vs covert_knife)
  if (!tuCols.some((c) => c.name === "type")) {
    db.exec("ALTER TABLE trade_ups ADD COLUMN type TEXT NOT NULL DEFAULT 'classified_covert'");
  }

  // Theoretical flag: 1 = computed from ref prices only, no real listings
  if (!tuCols.some((c) => c.name === "is_theoretical")) {
    db.exec("ALTER TABLE trade_ups ADD COLUMN is_theoretical INTEGER NOT NULL DEFAULT 0");
  }

  // Source column: 'discovery' (default), 'materialized', 'reverse_lookup', etc.
  if (!tuCols.some((c) => c.name === "source")) {
    db.exec("ALTER TABLE trade_ups ADD COLUMN source TEXT NOT NULL DEFAULT 'discovery'");
  }

  // Combo key: identifies the collection+split combo for theory tracking
  if (!tuCols.some((c) => c.name === "combo_key")) {
    db.exec("ALTER TABLE trade_ups ADD COLUMN combo_key TEXT");
  }

  // Pre-computed best/worst case columns (avoids expensive correlated subqueries)
  if (!tuCols.some((c) => c.name === "best_case_cents")) {
    db.exec("ALTER TABLE trade_ups ADD COLUMN best_case_cents INTEGER NOT NULL DEFAULT 0");
    db.exec("ALTER TABLE trade_ups ADD COLUMN worst_case_cents INTEGER NOT NULL DEFAULT 0");
    // Backfill from existing outcomes
    db.exec(`
      UPDATE trade_ups SET
        best_case_cents = COALESCE((SELECT MAX(estimated_price_cents) FROM trade_up_outcomes WHERE trade_up_id = trade_ups.id), 0) - total_cost_cents,
        worst_case_cents = COALESCE((SELECT MIN(estimated_price_cents) FROM trade_up_outcomes WHERE trade_up_id = trade_ups.id), 0) - total_cost_cents
    `);
  }

  // Legacy theory migrations removed — tables still created for backward compat but unused.

  // Add combo_type to profitable_combos (knife vs classified)
  const pcCols = db.pragma("table_info(profitable_combos)") as { name: string }[];
  if (!pcCols.some((c) => c.name === "combo_type")) {
    db.exec("ALTER TABLE profitable_combos ADD COLUMN combo_type TEXT NOT NULL DEFAULT 'knife'");
  }

  // Add source to trade_up_inputs (for multi-marketplace link routing)
  const tiCols = db.pragma("table_info(trade_up_inputs)") as { name: string }[];
  if (!tiCols.some((c) => c.name === "source")) {
    db.exec("ALTER TABLE trade_up_inputs ADD COLUMN source TEXT NOT NULL DEFAULT 'csfloat'");
  }

  // Profit streak: consecutive cycles a trade-up has been profitable
  if (!tuCols.some((c) => c.name === "profit_streak")) {
    db.exec("ALTER TABLE trade_ups ADD COLUMN profit_streak INTEGER NOT NULL DEFAULT 0");
  }

  // outcomes_json: denormalized JSON blob replaces trade_up_outcomes table
  if (!tuCols.some((c) => c.name === "outcomes_json")) {
    db.exec("ALTER TABLE trade_ups ADD COLUMN outcomes_json TEXT");
    // Backfill from existing trade_up_outcomes rows
    const allTuIds = db.prepare("SELECT DISTINCT trade_up_id FROM trade_up_outcomes").all() as { trade_up_id: number }[];
    if (allTuIds.length > 0) {
      const getOutcomes = db.prepare("SELECT skin_id, skin_name, collection_name, probability, predicted_float, predicted_condition, estimated_price_cents, sell_marketplace FROM trade_up_outcomes WHERE trade_up_id = ?");
      const setJson = db.prepare("UPDATE trade_ups SET outcomes_json = ? WHERE id = ?");
      const backfill = db.transaction(() => {
        for (const row of allTuIds) {
          const outcomes = getOutcomes.all(row.trade_up_id);
          setJson.run(JSON.stringify(outcomes), row.trade_up_id);
        }
      });
      backfill();
      console.log(`  Backfilled outcomes_json for ${allTuIds.length} trade-ups`);
    }
  }

  db.exec(`
    -- Indexes for performance
    CREATE INDEX IF NOT EXISTS idx_skins_rarity ON skins(rarity);
    CREATE INDEX IF NOT EXISTS idx_listings_skin_id ON listings(skin_id);
    CREATE INDEX IF NOT EXISTS idx_listings_source ON listings(source);
    CREATE INDEX IF NOT EXISTS idx_skin_collections_collection ON skin_collections(collection_id);
    CREATE INDEX IF NOT EXISTS idx_trade_ups_profit ON trade_ups(profit_cents DESC);
    CREATE INDEX IF NOT EXISTS idx_trade_ups_roi ON trade_ups(roi_percentage DESC);
    CREATE INDEX IF NOT EXISTS idx_trade_up_inputs_trade ON trade_up_inputs(trade_up_id);
    CREATE INDEX IF NOT EXISTS idx_trade_up_outcomes_trade ON trade_up_outcomes(trade_up_id);

    -- Theoretical flag index
    CREATE INDEX IF NOT EXISTS idx_trade_ups_theoretical ON trade_ups(is_theoretical, type, profit_cents DESC);

    -- Composite indexes for type-filtered sorting (avoids full table scan)
    CREATE INDEX IF NOT EXISTS idx_trade_ups_type_profit ON trade_ups(type, profit_cents DESC);
    CREATE INDEX IF NOT EXISTS idx_trade_ups_type_roi ON trade_ups(type, roi_percentage DESC);
    CREATE INDEX IF NOT EXISTS idx_trade_ups_type_cost ON trade_ups(type, total_cost_cents);
    CREATE INDEX IF NOT EXISTS idx_trade_ups_type_ev ON trade_ups(type, expected_value_cents DESC);
    CREATE INDEX IF NOT EXISTS idx_trade_ups_type_chance ON trade_ups(type, chance_to_profit DESC);
    CREATE INDEX IF NOT EXISTS idx_trade_ups_type_best ON trade_ups(type, best_case_cents DESC);
    CREATE INDEX IF NOT EXISTS idx_trade_ups_type_worst ON trade_ups(type, worst_case_cents DESC);

    -- Sale history (from CSFloat sold listings)
    CREATE TABLE IF NOT EXISTS sale_history (
      id TEXT PRIMARY KEY,
      skin_name TEXT NOT NULL,
      condition TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      float_value REAL NOT NULL,
      sold_at TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'csfloat'
    );

    CREATE INDEX IF NOT EXISTS idx_sale_history_skin ON sale_history(skin_name, condition);
    CREATE INDEX IF NOT EXISTS idx_sale_history_sold ON sale_history(sold_at);

    -- Track persistent sale fetch errors (403s) to avoid wasting budget
    CREATE TABLE IF NOT EXISTS sale_fetch_errors (
      market_hash_name TEXT PRIMARY KEY,
      error_code INTEGER NOT NULL,
      error_count INTEGER NOT NULL DEFAULT 1,
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Collection profitability scores (updated after each calculation)
    CREATE TABLE IF NOT EXISTS collection_scores (
      collection_id TEXT PRIMARY KEY,
      collection_name TEXT NOT NULL,
      profitable_count INTEGER NOT NULL DEFAULT 0,
      avg_profit_cents INTEGER NOT NULL DEFAULT 0,
      max_profit_cents INTEGER NOT NULL DEFAULT 0,
      avg_roi REAL NOT NULL DEFAULT 0,
      total_tradeups INTEGER NOT NULL DEFAULT 0,
      priority_score REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (collection_id) REFERENCES collections(id)
    );

    -- Sync metadata
    CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Float-range-specific pricing learned from validation
    CREATE TABLE IF NOT EXISTS float_price_data (
      skin_name TEXT NOT NULL,
      float_min REAL NOT NULL,
      float_max REAL NOT NULL,
      avg_price_cents INTEGER NOT NULL,
      listing_count INTEGER NOT NULL DEFAULT 0,
      last_checked TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (skin_name, float_min, float_max)
    );

    -- Theory validation tracking
    CREATE TABLE IF NOT EXISTS theory_validations (
      trade_up_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      checked_at TEXT NOT NULL DEFAULT (datetime('now')),
      price_deviation REAL NOT NULL DEFAULT 0,
      notes TEXT,
      PRIMARY KEY (trade_up_id),
      FOREIGN KEY (trade_up_id) REFERENCES trade_ups(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_theory_validations_status ON theory_validations(status);

    -- Theory tracking: persists materialization results across daemon cycles
    CREATE TABLE IF NOT EXISTS theory_tracking (
      combo_key TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      theory_profit_cents INTEGER NOT NULL DEFAULT 0,
      real_profit_cents INTEGER,
      gap_cents INTEGER NOT NULL DEFAULT 0,
      cost_gap_cents INTEGER NOT NULL DEFAULT 0,
      ev_gap_cents INTEGER NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 1,
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_checked_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_profitable_at TEXT,
      cooldown_until TEXT,
      notes TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_theory_tracking_status ON theory_tracking(status);
    CREATE INDEX IF NOT EXISTS idx_theory_tracking_cooldown ON theory_tracking(cooldown_until);

    -- Persisted near-miss data (survives daemon restarts)
    CREATE TABLE IF NOT EXISTS near_misses (
      combo_key TEXT PRIMARY KEY,
      gap_cents INTEGER NOT NULL,
      theory_profit_cents INTEGER NOT NULL,
      real_profit_cents INTEGER NOT NULL,
      collections TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Price observations: individual (float, price) data points per skin.
    CREATE TABLE IF NOT EXISTS price_observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      skin_name TEXT NOT NULL,
      float_value REAL NOT NULL,
      price_cents INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'listing',
      observed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_price_obs_skin_float ON price_observations(skin_name, float_value);
    CREATE INDEX IF NOT EXISTS idx_price_obs_skin ON price_observations(skin_name);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_price_obs_dedup ON price_observations(skin_name, float_value, price_cents);

    -- Performance indexes
    CREATE INDEX IF NOT EXISTS idx_skins_name_stattrak ON skins(name, stattrak);
    CREATE INDEX IF NOT EXISTS idx_skins_weapon_stattrak ON skins(weapon, stattrak);
    CREATE INDEX IF NOT EXISTS idx_price_data_source ON price_data(source);
    CREATE INDEX IF NOT EXISTS idx_trade_up_outcomes_skin_cond ON trade_up_outcomes(skin_name, predicted_condition);
    CREATE INDEX IF NOT EXISTS idx_trade_up_inputs_skin ON trade_up_inputs(skin_name);
    CREATE INDEX IF NOT EXISTS idx_listings_stattrak_type_price ON listings(stattrak, listing_type, price_cents);
    CREATE INDEX IF NOT EXISTS idx_listings_float_stattrak ON listings(float_value, stattrak);
    CREATE INDEX IF NOT EXISTS idx_float_price_data_listing_count ON float_price_data(listing_count);

    CREATE INDEX IF NOT EXISTS idx_trade_ups_listing_status ON trade_ups(listing_status, preserved_at);
    CREATE INDEX IF NOT EXISTS idx_trade_ups_peak_profit ON trade_ups(peak_profit_cents DESC);

    -- Profitable combo history: tracks combos that have been profitable, with their recipe
    CREATE TABLE IF NOT EXISTS profitable_combos (
      combo_key TEXT PRIMARY KEY,
      collections TEXT NOT NULL,
      best_profit_cents INTEGER NOT NULL DEFAULT 0,
      best_roi REAL NOT NULL DEFAULT 0,
      times_profitable INTEGER NOT NULL DEFAULT 0,
      first_profitable_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_profitable_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_cost_cents INTEGER NOT NULL DEFAULT 0,
      input_recipe TEXT NOT NULL DEFAULT '',
      notes TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_profitable_combos_profit ON profitable_combos(best_profit_cents DESC);

    -- Daemon event feed (ring buffer, purged every 6h)
    CREATE TABLE IF NOT EXISTS daemon_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_daemon_events_created ON daemon_events(created_at);

    -- Market snapshots: periodic aggregate stats for historical analysis
    CREATE TABLE IF NOT EXISTS market_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_at TEXT NOT NULL DEFAULT (datetime('now')),
      cycle INTEGER,
      type TEXT NOT NULL DEFAULT 'covert_knife',
      total_tradeups INTEGER NOT NULL DEFAULT 0,
      profitable_count INTEGER NOT NULL DEFAULT 0,
      best_profit_cents INTEGER NOT NULL DEFAULT 0,
      avg_profit_cents INTEGER NOT NULL DEFAULT 0,
      best_roi REAL NOT NULL DEFAULT 0,
      avg_cost_cents INTEGER NOT NULL DEFAULT 0,
      avg_chance REAL NOT NULL DEFAULT 0,
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
    CREATE INDEX IF NOT EXISTS idx_snapshots_at ON market_snapshots(snapshot_at);
    CREATE INDEX IF NOT EXISTS idx_snapshots_type ON market_snapshots(type, snapshot_at);

    -- Snapshot top trade-ups: denormalized top N trade-ups at each snapshot
    CREATE TABLE IF NOT EXISTS snapshot_tradeups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id INTEGER NOT NULL,
      rank INTEGER NOT NULL,
      trade_up_id INTEGER NOT NULL,
      profit_cents INTEGER NOT NULL,
      roi_percentage REAL NOT NULL,
      total_cost_cents INTEGER NOT NULL,
      chance_to_profit REAL NOT NULL,
      best_case_cents INTEGER NOT NULL DEFAULT 0,
      worst_case_cents INTEGER NOT NULL DEFAULT 0,
      is_theoretical INTEGER NOT NULL DEFAULT 0,
      source TEXT,
      combo_key TEXT,
      collections TEXT NOT NULL,
      input_skins TEXT NOT NULL,
      output_skins TEXT NOT NULL,
      FOREIGN KEY (snapshot_id) REFERENCES market_snapshots(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_snapshot_tradeups_snapshot ON snapshot_tradeups(snapshot_id);
    CREATE INDEX IF NOT EXISTS idx_snapshot_tradeups_combo ON snapshot_tradeups(combo_key, snapshot_id);

    -- Staircase trade-ups: stage1 feeds into a stage2 trade-up
    CREATE TABLE IF NOT EXISTS staircase_trade_ups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_up_id INTEGER REFERENCES trade_ups(id) ON DELETE CASCADE,
      stage1_trade_up_ids TEXT NOT NULL,
      manufacturing_edge_cents INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_staircase_trade_up ON staircase_trade_ups(trade_up_id);

    -- Trade-up claims: locks a trade-up for a user while they buy listings
    CREATE TABLE IF NOT EXISTS trade_up_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_up_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      claimed_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      released_at TEXT,
      UNIQUE(trade_up_id, user_id),
      FOREIGN KEY (trade_up_id) REFERENCES trade_ups(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_claims_active ON trade_up_claims(trade_up_id) WHERE released_at IS NULL;
  `);
}

export function getSyncMeta(db: Database.Database, key: string): string | null {
  const row = db.prepare("SELECT value FROM sync_meta WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSyncMeta(db: Database.Database, key: string, value: string) {
  db.prepare("INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)").run(key, value);
}

export function emitEvent(db: Database.Database, type: string, summary: string, detail?: string) {
  db.prepare("INSERT INTO daemon_events (event_type, summary, detail) VALUES (?, ?, ?)").run(type, summary, detail ?? null);
}

export function purgeOldEvents(db: Database.Database, maxAgeHours = 6) {
  db.prepare("DELETE FROM daemon_events WHERE julianday('now') - julianday(created_at) > ?").run(maxAgeHours / 24);
}
