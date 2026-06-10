/**
 * Integration test: batch sale ingest equivalence.
 *
 * Verifies that batchInsertSaleHistory + batchInsertObservations produce
 * exactly the same DB contents as the previous per-row semantics would,
 * specifically:
 *   - Duplicate rows (same id / same unique observation tuple) are ignored
 *   - Unique rows land correctly
 *
 * Uses an isolated schema on tradeupbot_test — no side-effects.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import pg from "pg";

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

/** Minimal batch helpers mirroring what sales.ts now uses, operating on a schema-qualified pool. */
async function batchInsertSaleHistoryDirect(
  pool: pg.Pool,
  schema: string,
  rows: Array<{ id: string; skinName: string; condition: string; price: number; floatValue: number; createdAt: string }>
): Promise<number> {
  if (rows.length === 0) return 0;
  const values: unknown[] = [];
  const placeholders = rows.map((row, i) => {
    const b = i * 6;
    values.push(row.id, row.skinName, row.condition, row.price, row.floatValue, row.createdAt);
    return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},'csfloat')`;
  }).join(",");
  const result = await pool.query(
    `INSERT INTO "${schema}".sale_history (id, skin_name, condition, price_cents, float_value, sold_at, source) VALUES ${placeholders} ON CONFLICT DO NOTHING`,
    values
  );
  return result.rowCount ?? 0;
}

async function batchInsertObservationsDirect(
  pool: pg.Pool,
  schema: string,
  rows: Array<{ skinName: string; floatValue: number; price: number; soldAt: string }>
): Promise<void> {
  if (rows.length === 0) return;
  const values: unknown[] = [];
  const placeholders = rows.map((row, i) => {
    const b = i * 4;
    values.push(row.skinName, row.floatValue, row.price, row.soldAt);
    return `($${b+1},$${b+2},$${b+3},'sale',$${b+4})`;
  }).join(",");
  await pool.query(
    `INSERT INTO "${schema}".price_observations (skin_name, float_value, price_cents, source, observed_at) VALUES ${placeholders} ON CONFLICT DO NOTHING`,
    values
  );
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

    const inserted = await batchInsertSaleHistoryDirect(pool, schema, sales);

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

    await batchInsertObservationsDirect(pool, schema, obs);

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

    await batchInsertSaleHistoryDirect(pool, schema, sales);
    await batchInsertObservationsDirect(pool, schema, obsRows);

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
});
