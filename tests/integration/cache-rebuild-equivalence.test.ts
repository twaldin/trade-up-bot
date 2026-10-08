/**
 * The float ceiling, price cache, and KNN rebuild must match the pre-cursor SQL.
 * The ceiling walk is one server-side cursor. The batch size is lowered so
 * 1,000+ rows cross several FETCH boundaries; production still fetches 5,000.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { floatToCondition } from "../../shared/types.js";
import { setReadOnlyCursorSqlForTests } from "../../server/engine/rebuild-io.js";
import {
  FLOAT_CEILING_FETCH_BATCH,
  assemblePriceCache,
  resetPriceCacheForTests,
  setFloatCeilingFetchBatchForTests,
} from "../../server/engine/pricing.js";
import {
  clearKnnCache,
  knnCachedObservationsForTests,
  warmKnnCache,
} from "../../server/engine/knn-pricing.js";

const { Pool } = pg;

const connectionString =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgresql://tradeupbot:tradeupbot_pg_2026@localhost:5432/tradeupbot_test";

const SKIN = "AK-47 | Redline";
const BATCH = 400;
const PER_SOURCE = 450;

const OLD_CEILING_SQL = `
  SELECT skin_name, float_value, price_cents, source FROM (
    SELECT s.name as skin_name, l.float_value, l.price_cents, 'csfloat' as source
    FROM listings l JOIN skins s ON l.skin_id = s.id
    WHERE (l.source = 'csfloat' OR l.source IS NULL) AND l.stattrak = false
      AND l.float_value > 0 AND l.price_cents > 0
      AND (l.listing_type = 'buy_now' OR l.listing_type IS NULL)
    UNION ALL
    SELECT s.name, l.float_value, CAST(ROUND(l.price_cents * 1.025) AS INTEGER), 'dmarket'
    FROM listings l JOIN skins s ON l.skin_id = s.id
    WHERE l.source = 'dmarket' AND l.stattrak = false
      AND l.float_value > 0 AND l.price_cents > 0
    UNION ALL
    SELECT s.name, l.float_value, l.price_cents, 'buff'
    FROM listings l JOIN skins s ON l.skin_id = s.id
    WHERE l.source = 'buff' AND l.stattrak = false
      AND l.float_value > 0 AND l.price_cents > 0
  ) combined
`;

let pool: pg.Pool;
let schema: string;
const fetchSql: string[] = [];

function bag(rows: readonly { float: number; price: number }[], skin = SKIN): string[] {
  return rows.map((row) => `${skin}\t${row.float}\t${row.price}`).sort();
}

function keepCeilingRow(
  row: { skin_name: string; float_value: number; price_cents: number; source: string },
  refs: Map<string, number>,
): boolean {
  const price = Number(row.price_cents);
  if (row.source === "buff" || row.source === "dmarket") {
    const ref = refs.get(`${row.skin_name}:${floatToCondition(Number(row.float_value))}`);
    if (row.source === "buff") {
      if (!ref || price > ref * 5) return false;
    } else if (ref && price > ref * 5) {
      return false;
    }
  }
  return true;
}

beforeAll(async () => {
  schema = `test_ceil_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const boot = new Pool({ connectionString, max: 1 });
  await boot.query(`CREATE SCHEMA "${schema}"`);
  await boot.query(`SET search_path TO "${schema}"`);
  await boot.query(`
    CREATE TABLE skins (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      weapon TEXT NOT NULL,
      min_float DOUBLE PRECISION NOT NULL DEFAULT 0,
      max_float DOUBLE PRECISION NOT NULL DEFAULT 1,
      rarity TEXT NOT NULL,
      stattrak BOOLEAN NOT NULL DEFAULT false,
      souvenir BOOLEAN NOT NULL DEFAULT false
    );
    CREATE TABLE listings (
      id TEXT PRIMARY KEY,
      skin_id TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      float_value DOUBLE PRECISION NOT NULL,
      stattrak BOOLEAN NOT NULL DEFAULT false,
      source TEXT,
      listing_type TEXT
    );
    CREATE TABLE price_data (
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
    CREATE TABLE price_observations (
      id SERIAL PRIMARY KEY,
      skin_name TEXT NOT NULL,
      float_value DOUBLE PRECISION NOT NULL,
      price_cents INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'listing',
      observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await boot.query(
    `INSERT INTO skins (id, name, weapon, rarity) VALUES
      ('skin-ak', $1, 'AK-47', 'Classified'),
      ('skin-st', 'StatTrak Skin', 'AK-47', 'Classified')`,
    [SKIN],
  );
  await boot.query(
    `INSERT INTO price_data (skin_name, condition, min_price_cents, median_price_cents, volume, source) VALUES
      ($1, 'Field-Tested', 4000, 5000, 10, 'csfloat_ref'),
      ($1, 'Factory New', 0, 9000, 4, 'csfloat_sales'),
      ('AWP | Asiimov', 'Minimal Wear', 1000, 1000, 2, 'csfloat_ref')`,
    [SKIN],
  );
  await boot.query(`
    INSERT INTO listings (id, skin_id, price_cents, float_value, stattrak, source, listing_type)
    SELECT lpad(i::text, 8, '0'), 'skin-ak',
      CASE WHEN i = 400 THEN 4646 ELSE 2000 + (i % 50) END,
      CASE WHEN i % 17 = 0 THEN 0.21 ELSE 0.20 END,
      false, 'csfloat', 'buy_now'
    FROM generate_series(1, ${PER_SOURCE}) i
  `);
  await boot.query(`
    INSERT INTO listings (id, skin_id, price_cents, float_value, stattrak, source, listing_type)
    SELECT 'M' || lpad(i::text, 10, '0'), 'skin-ak',
      CASE WHEN i = 350 THEN 4848 ELSE 1100 + (i % 40) END,
      CASE WHEN i % 17 = 0 THEN 0.21 ELSE 0.20 END,
      false, 'buff', 'buy_now'
    FROM generate_series(1, ${PER_SOURCE}) i
  `);
  await boot.query(`
    INSERT INTO listings (id, skin_id, price_cents, float_value, stattrak, source, listing_type)
    SELECT 'dmarket:' || lpad(i::text, 8, '0'), 'skin-ak',
      CASE WHEN i = 300 THEN 4900 ELSE 1200 + (i % 30) END,
      CASE WHEN i % 17 = 0 THEN 0.21 ELSE 0.20 END,
      false, 'dmarket', 'buy_now'
    FROM generate_series(1, ${PER_SOURCE}) i
  `);
  await boot.query(`
    INSERT INTO listings (id, skin_id, price_cents, float_value, stattrak, source, listing_type) VALUES
      ('z-null-source', 'skin-ak', 7777, 0.22, false, NULL, NULL),
      ('dmarket:zzzzzzzz', 'skin-ak', 3333, 0.19, false, 'dmarket', 'auction'),
      ('z-buff-outlier', 'skin-ak', 1000000, 0.20, false, 'buff', 'buy_now'),
      ('z-dm-outlier', 'skin-ak', 1000000, 0.20, false, 'dmarket', 'buy_now'),
      ('auction-csfloat', 'skin-ak', 1500, 0.20, false, 'csfloat', 'auction'),
      ('stattrak-1', 'skin-st', 100, 0.20, true, 'csfloat', 'buy_now'),
      ('skinport:1', 'skin-ak', 100, 0.20, false, 'skinport', 'buy_now'),
      ('zero-price', 'skin-ak', 0, 0.20, false, 'csfloat', 'auction'),
      ('zero-float', 'skin-ak', 100, 0, false, 'skinport', 'buy_now')
  `);
  await boot.query(
    `INSERT INTO price_observations (skin_name, float_value, price_cents, source, observed_at)
     SELECT $1,
       CASE WHEN i BETWEEN 10 AND 14 THEN 0.25 ELSE (i % 100) / 1000.0 + 0.15 END,
       CASE
         WHEN i = 400 THEN 1400400
         WHEN i = 800 THEN 1800800
         WHEN i = 10 THEN 5010
         WHEN i = 11 THEN 5011
         WHEN i = 12 THEN 5001
         WHEN i = 13 THEN 5099
         WHEN i = 14 THEN 5020
         ELSE 2000 + i
       END,
       'sale',
       NOW()
     FROM generate_series(1, 1200) i`,
    [SKIN],
  );
  await boot.query(
    `INSERT INTO price_observations (skin_name, float_value, price_cents, source, observed_at) VALUES
      ($1, 0.2, 9, 'listing', NOW()),
      ($1, 0.2, 8, 'sale', NOW() - INTERVAL '200 days')`,
    [SKIN],
  );
  await boot.end();

  const sep = connectionString.includes("?") ? "&" : "?";
  pool = new Pool({
    connectionString: `${connectionString}${sep}options=-c%20search_path%3D${schema}`,
    max: 4,
  });
  setReadOnlyCursorSqlForTests((sql) => {
    if (sql.startsWith("FETCH ")) fetchSql.push(sql);
  });
});

afterAll(async () => {
  setReadOnlyCursorSqlForTests(null);
  resetPriceCacheForTests();
  clearKnnCache();
  if (pool) {
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  }
});

describe("cache rebuild matches the old SQL", () => {
  it("pages the ceiling cursor across batch boundaries and keeps KNN float-then-id order", async () => {
    expect(FLOAT_CEILING_FETCH_BATCH).toBe(5_000);
    resetPriceCacheForTests();
    clearKnnCache();
    setFloatCeilingFetchBatchForTests(BATCH);
    fetchSql.length = 0;

    const assembled = await assemblePriceCache(pool);
    const fetches = fetchSql.filter((sql) => sql.startsWith(`FETCH ${BATCH} FROM float_ceiling`));
    expect(fetches.length).toBeGreaterThanOrEqual(4);

    const { rows: oldRows } = await pool.query<{
      skin_name: string;
      float_value: number;
      price_cents: number;
      source: string;
    }>(OLD_CEILING_SQL);
    const expected = oldRows
      .filter((row) => keepCeilingRow(row, assembled.maps.ref))
      .map((row) => ({ float: Number(row.float_value), price: Number(row.price_cents) }));
    const actual = [...assembled.ceiling.entries()].flatMap(([skin, rows]) =>
      rows.map((row) => ({ skin, ...row })),
    );
    expect(actual.length).toBeGreaterThanOrEqual(1_000);
    expect(bag(actual.map((row) => ({ float: row.float, price: row.price })), SKIN)).toEqual(bag(expected));
    expect(expected.some((row) => row.price === 4646)).toBe(true);
    expect(expected.some((row) => row.price === 4848)).toBe(true);
    expect(expected.some((row) => row.price === 5023)).toBe(true);
    expect(expected.some((row) => row.price === 7777)).toBe(true);
    expect(expected.some((row) => row.price === 1_000_000)).toBe(false);
    const tied = expected.filter((row) => row.float === 0.21);
    expect(tied.length).toBeGreaterThan(1);

    const { rows: refRows } = await pool.query<{ price: number }>(
      `SELECT CASE WHEN median_price_cents > 0 THEN median_price_cents ELSE min_price_cents END AS price
       FROM price_data WHERE source = 'csfloat_ref' AND volume >= 3 AND skin_name = $1 AND condition = 'Field-Tested'`,
      [SKIN],
    );
    const { rows: floorRows } = await pool.query<{ lowest: number }>(
      `SELECT MIN(l.price_cents) AS lowest
       FROM listings l JOIN skins s ON l.skin_id = s.id
       WHERE l.float_value >= 0.15 AND l.float_value < 0.38
         AND l.source = 'csfloat'
         AND (l.listing_type = 'buy_now' OR l.listing_type IS NULL)
         AND s.name = $1`,
      [SKIN],
    );
    const { rows: salesRows } = await pool.query<{ price: number }>(
      `SELECT median_price_cents AS price FROM price_data
       WHERE source = 'csfloat_sales' AND volume >= 2 AND median_price_cents > 0
         AND skin_name = $1 AND condition = 'Factory New'`,
      [SKIN],
    );
    const refPrice = Number(refRows[0]?.price);
    const floor = Number(floorRows[0]?.lowest);
    expect(floor).toBeLessThan(refPrice);
    expect(assembled.maps.prices.get(`${SKIN}:Field-Tested`)).toBe(floor);
    expect(assembled.maps.prices.get(`${SKIN}:Factory New`)).toBe(Number(salesRows[0]?.price));
    expect(assembled.maps.prices.has("AWP | Asiimov:Minimal Wear")).toBe(false);
    expect(assembled.maps.prices.size).toBe(2);

    await warmKnnCache(pool);
    const cached = knnCachedObservationsForTests(SKIN);
    const { rows: obs } = await pool.query<{ float_value: number; price_cents: number; id: number }>(
      `SELECT id, float_value, price_cents
       FROM price_observations
       WHERE observed_at >= NOW() - (180 * INTERVAL '1 day')
         AND source IN ('sale', 'skinport_sale', 'buff_sale')
         AND skin_name = $1
       ORDER BY float_value, id`,
      [SKIN],
    );
    expect(obs.length).toBeGreaterThanOrEqual(1_000);
    expect(cached.map((row) => `${row.float}\t${row.price}`)).toEqual(
      obs.map((row) => `${Number(row.float_value)}\t${Number(row.price_cents)}`),
    );
    const tieIds = obs.filter((row) => Number(row.float_value) === 0.25);
    expect(tieIds.map((row) => Number(row.price_cents))).toEqual([5010, 5011, 5001, 5099, 5020]);
    expect(cached.filter((row) => row.float === 0.25).map((row) => row.price)).toEqual([5010, 5011, 5001, 5099, 5020]);
    expect(cached.some((row) => row.price === 1_400_400)).toBe(true);
    expect(cached.some((row) => row.price === 1_800_800)).toBe(true);
    expect(cached.some((row) => row.price === 8 || row.price === 9)).toBe(false);
  }, 60_000);
});
