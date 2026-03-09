import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", "data", "tradeup.db");

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
  if (!tuCols.some((c) => c.name === "chance_to_profit")) {
    db.exec("ALTER TABLE trade_ups ADD COLUMN chance_to_profit REAL NOT NULL DEFAULT 0");
  }

  const listingCols = db.pragma("table_info(listings)") as { name: string }[];
  if (!listingCols.some((c) => c.name === "listing_type")) {
    db.exec("ALTER TABLE listings ADD COLUMN listing_type TEXT NOT NULL DEFAULT 'buy_now'");
  }

  // Add trade-up type column (classified_covert vs covert_knife)
  if (!tuCols.some((c) => c.name === "type")) {
    db.exec("ALTER TABLE trade_ups ADD COLUMN type TEXT NOT NULL DEFAULT 'classified_covert'");
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
