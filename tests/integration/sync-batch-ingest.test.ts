/**
 * Integration test: batch sale ingest equivalence.
 *
 * Verifies that batchInsertSaleHistory + batchInsertObservations produce
 * exactly the same DB contents as the previous per-row semantics would,
 * specifically:
 *   - Duplicate rows (same id / same unique observation tuple) are ignored
 *   - Unique rows land correctly
 *   - Chunking loop fires correctly for >SALE_BATCH_SIZE (200) rows
 *
 * Uses an isolated schema on tradeupbot_test — no side-effects.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import pg from "pg";
import { batchInsertSaleHistory, batchInsertObservations } from "../../server/sync/sales.js";

const { Pool } = pg;

const CONNECTION =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgresql://tradeupbot:tradeupbot_pg_2026@localhost:5432/tradeupbot_test";

async function createIsolatedSchema(pool: pg.Pool): Promise<string> {
  const schema = `test_batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "${schema}".sale_history (
      id TEXT PRIMARY KEY,
      skin_name TEXT NOT NULL,
      condition TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      float_value DOUBLE PRECISION NOT NULL,
      sold_at TIMESTAMPTZ NOT NULL,
      source TEXT NOT NULL DEFAULT 'csfloat'
    );
    CREATE TABLE IF NOT EXISTS "${schema}".price_observations (
      id SERIAL PRIMARY KEY,
      skin_name TEXT NOT NULL,
      float_value DOUBLE PRECISION NOT NULL,
      price_cents INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'listing',
      observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX "${schema}_idx_price_obs_dedup"
      ON "${schema}".price_observations(skin_name, float_value, price_cents, source);
  `);
  return schema;
}

/** Check out a client from the pool and set search_path to the isolated schema. */
async function clientFor(pool: pg.Pool, schema: string): Promise<pg.PoolClient> {
  const client = await pool.connect();
  await client.query(`SET search_path TO "${schema}"`);
  return client;
}

describe("sync batch ingest equivalence", () => {
  let pool: pg.Pool;
  let schema: string;

  beforeEach(async () => {
    pool = new Pool({ connectionString: CONNECTION, max: 3 });
    schema = await createIsolatedSchema(pool);
  });

  afterEach(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  });

  it("inserts 3 unique sales and ignores 2 duplicate sale_history rows", async () => {
    const soldAt = new Date().toISOString();

    const sales = [
      { id: "sale-1", skinName: "AK-47 | Fire Serpent", condition: "Field-Tested", price: 5000, floatValue: 0.15, createdAt: soldAt },
      { id: "sale-2", skinName: "AK-47 | Fire Serpent", condition: "Field-Tested", price: 5100, floatValue: 0.18, createdAt: soldAt },
      { id: "sale-3", skinName: "AK-47 | Fire Serpent", condition: "Minimal Wear", price: 7000, floatValue: 0.11, createdAt: soldAt },
      // Duplicates of sale-1 and sale-2 (same id = ON CONFLICT DO NOTHING)
      { id: "sale-1", skinName: "AK-47 | Fire Serpent", condition: "Field-Tested", price: 5000, floatValue: 0.15, createdAt: soldAt },
      { id: "sale-2", skinName: "AK-47 | Fire Serpent", condition: "Field-Tested", price: 5100, floatValue: 0.18, createdAt: soldAt },
    ];

    const client = await clientFor(pool, schema);
    let inserted: number;
    try {
      inserted = await batchInsertSaleHistory(client, sales);
    } finally {
      client.release();
    }

    // Sale_history: 3 unique rows (sale-1, sale-2, sale-3); 2 duplicates ignored
    expect(inserted).toBe(3);

    const { rows } = await pool.query(`SELECT id FROM "${schema}".sale_history ORDER BY id`);
    expect(rows.map((r) => r.id)).toEqual(["sale-1", "sale-2", "sale-3"]);
  });

  it("inserts 3 unique observation rows and ignores 2 duplicates", async () => {
    const soldAt = new Date().toISOString();

    const obs = [
      { skinName: "AK-47 | Fire Serpent", floatValue: 0.15, price: 5000, soldAt },
      { skinName: "AK-47 | Fire Serpent", floatValue: 0.18, price: 5100, soldAt },
      { skinName: "AK-47 | Fire Serpent", floatValue: 0.11, price: 7000, soldAt },
      // Duplicates — same (skinName, float_value, price_cents, source) tuple
      { skinName: "AK-47 | Fire Serpent", floatValue: 0.15, price: 5000, soldAt },
      { skinName: "AK-47 | Fire Serpent", floatValue: 0.18, price: 5100, soldAt },
    ];

    const client = await clientFor(pool, schema);
    try {
      await batchInsertObservations(client, obs);
    } finally {
      client.release();
    }

    const { rows } = await pool.query(
      `SELECT skin_name, float_value, price_cents FROM "${schema}".price_observations ORDER BY price_cents`
    );
    expect(rows).toHaveLength(3);
    expect(rows[0].price_cents).toBe(5000);
    expect(rows[1].price_cents).toBe(5100);
    expect(rows[2].price_cents).toBe(7000);
  });

  it("batch produces the same result as N single-row inserts would", async () => {
    const soldAt = new Date().toISOString();

    // Simulate 5 sales from a single page fetch (3 unique, 2 duplicate)
    const sales = [
      { id: "s-a", skinName: "M4A1-S | Hyper Beast", condition: "Factory New", price: 8000, floatValue: 0.04, createdAt: soldAt },
      { id: "s-b", skinName: "M4A1-S | Hyper Beast", condition: "Minimal Wear", price: 6500, floatValue: 0.10, createdAt: soldAt },
      { id: "s-c", skinName: "AK-47 | Redline",      condition: "Field-Tested", price: 1500, floatValue: 0.22, createdAt: soldAt },
      { id: "s-a", skinName: "M4A1-S | Hyper Beast", condition: "Factory New", price: 8000, floatValue: 0.04, createdAt: soldAt }, // dup
      { id: "s-b", skinName: "M4A1-S | Hyper Beast", condition: "Minimal Wear", price: 6500, floatValue: 0.10, createdAt: soldAt }, // dup
    ];
    const obsRows = sales.map((s) => ({ skinName: s.skinName, floatValue: s.floatValue, price: s.price, soldAt }));

    const client = await clientFor(pool, schema);
    try {
      await batchInsertSaleHistory(client, sales);
      await batchInsertObservations(client, obsRows);
    } finally {
      client.release();
    }

    const { rows: shRows } = await pool.query(
      `SELECT id, skin_name, condition FROM "${schema}".sale_history ORDER BY id`
    );
    expect(shRows).toHaveLength(3); // s-a, s-b, s-c — duplicates ignored

    const { rows: obsResult } = await pool.query(
      `SELECT skin_name, price_cents FROM "${schema}".price_observations ORDER BY price_cents`
    );
    expect(obsResult).toHaveLength(3); // unique (name, float, price, source) tuples
    expect(obsResult.map((r) => r.price_cents)).toEqual([1500, 6500, 8000]);

    // All observations have source='sale'
    const { rows: sourceRows } = await pool.query(
      `SELECT DISTINCT source FROM "${schema}".price_observations`
    );
    expect(sourceRows.map((r) => r.source)).toEqual(["sale"]);
  });

  it("correctly inserts 250 sales spanning multiple SALE_BATCH_SIZE=200 chunks", async () => {
    const soldAt = new Date().toISOString();
    const COUNT = 250;

    // 250 unique sale rows — triggers 2 batches (chunk 0: rows 0-199, chunk 1: rows 200-249)
    const sales = Array.from({ length: COUNT }, (_, i) => ({
      id: `bulk-sale-${i}`,
      skinName: "AK-47 | Redline",
      condition: "Field-Tested",
      price: 1000 + i,
      floatValue: 0.15 + (i % 10) * 0.001,
      createdAt: soldAt,
    }));
    const obsRows = sales.map((s) => ({
      skinName: s.skinName,
      floatValue: s.floatValue,
      price: s.price,
      soldAt,
    }));

    const client = await clientFor(pool, schema);
    let inserted: number;
    try {
      inserted = await batchInsertSaleHistory(client, sales);
      await batchInsertObservations(client, obsRows);
    } finally {
      client.release();
    }

    expect(inserted).toBe(COUNT);

    const { rows: shRows } = await pool.query(
      `SELECT COUNT(*) AS cnt FROM "${schema}".sale_history`
    );
    expect(Number(shRows[0].cnt)).toBe(COUNT);

    // Observations: floatValue cycles over 10 distinct values, so 10 unique (float,price) combos per
    // cycle. With 250 rows and price=1000+i, all 250 are distinct (price is unique per row).
    const { rows: obsResult } = await pool.query(
      `SELECT COUNT(*) AS cnt FROM "${schema}".price_observations`
    );
    expect(Number(obsResult[0].cnt)).toBe(COUNT);
  });
});
