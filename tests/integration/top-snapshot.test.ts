/**
 * Daily top-1000 snapshot: one INSERT … SELECT of active trade-ups by score,
 * then batched deletes of rows older than 14 days.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import {
  INSERT_TOP_SNAPSHOT_SQL,
  PURGE_TOP_SNAPSHOT_SQL,
  TOP_SNAPSHOT_PURGE_BATCH,
  TRADE_UP_TOP_SNAPSHOTS_DDL,
  purgeOldTopSnapshots,
  snapshotTopTradeUps,
} from "../../server/top-snapshot.js";

const { Pool } = pg;

const base =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgresql://tradeupbot:tradeupbot_pg_2026@localhost:5432/tradeupbot_test";

const schema = `test_top_snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

let pool: pg.Pool;

beforeAll(async () => {
  const boot = new Pool({ connectionString: base, max: 1 });
  await boot.query(`CREATE SCHEMA "${schema}"`);
  await boot.end();

  const sep = base.includes("?") ? "&" : "?";
  pool = new Pool({
    connectionString: `${base}${sep}options=-c%20search_path%3D${schema}`,
    max: 4,
  });

  const { rows } = await pool.query<{ current_schema: string }>("SELECT current_schema()");
  expect(rows[0]?.current_schema).toBe(schema);

  await pool.query(`
    CREATE TABLE trade_ups (
      id SERIAL PRIMARY KEY,
      total_cost_cents INTEGER NOT NULL,
      expected_value_cents INTEGER NOT NULL,
      profit_cents INTEGER NOT NULL,
      roi_percentage DOUBLE PRECISION NOT NULL,
      listing_status TEXT NOT NULL DEFAULT 'active',
      is_theoretical BOOLEAN NOT NULL DEFAULT false,
      trade_up_score INTEGER,
      input_sources TEXT[] NOT NULL DEFAULT '{}',
      collection_names TEXT[] NOT NULL DEFAULT '{}'
    )
  `);
  await pool.query(TRADE_UP_TOP_SNAPSHOTS_DDL);
  await pool.query(TRADE_UP_TOP_SNAPSHOTS_DDL);
});

beforeEach(async () => {
  await pool.query("TRUNCATE trade_up_top_snapshots, trade_ups RESTART IDENTITY");
});

afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await pool.end();
});

async function seedActiveRange(): Promise<void> {
  await pool.query(`
    INSERT INTO trade_ups (
      total_cost_cents, expected_value_cents, profit_cents, roi_percentage,
      listing_status, is_theoretical, trade_up_score, input_sources, collection_names
    )
    SELECT
      1000 + i,
      2000 + i,
      3000 + i,
      i::float8,
      'active',
      false,
      i,
      ARRAY['csfloat', 'src' || i::text],
      ARRAY['Col', 'N' || i::text]
    FROM generate_series(1, 1005) AS i
  `);
  await pool.query(`
    INSERT INTO trade_ups (
      total_cost_cents, expected_value_cents, profit_cents, roi_percentage,
      listing_status, is_theoretical, trade_up_score, input_sources, collection_names
    ) VALUES
      (10, 20, 5, 1, 'stale', false, 50000, ARRAY['csfloat'], ARRAY['Stale']),
      (10, 20, 5, 1, 'partial', false, 40000, ARRAY['dmarket'], ARRAY['Partial']),
      (10, 20, 5, 1, 'active', true, 999999, ARRAY['csfloat'], ARRAY['Theory']),
      (10, 20, 5, 1, 'active', false, NULL, ARRAY['buff'], ARRAY['Unscored'])
  `);
}

describe("snapshotTopTradeUps", () => {
  it("keeps the top 1000 active trade-ups in score order", async () => {
    await seedActiveRange();

    const result = await snapshotTopTradeUps(pool);
    expect(result.gaveUp).toBe(false);
    expect(result.inserted).toBe(1000);

    const { rows } = await pool.query<{ score: number }>(
      "SELECT score FROM trade_up_top_snapshots ORDER BY score DESC",
    );
    expect(rows.map((row) => row.score)).toEqual(
      Array.from({ length: 1000 }, (_, i) => 1005 - i),
    );

    const { rows: inactive } = await pool.query(
      `SELECT s.trade_up_id
       FROM trade_up_top_snapshots s
       JOIN trade_ups t ON t.id = s.trade_up_id
       WHERE t.listing_status <> 'active' OR t.is_theoretical = true`,
    );
    expect(inactive).toEqual([]);

    const { rows: [src] } = await pool.query<{
      id: number;
      profit_cents: number;
      total_cost_cents: number;
      expected_value_cents: number;
      roi_percentage: number;
      input_sources: string[];
      collection_names: string[];
    }>(
      `SELECT id, profit_cents, total_cost_cents, expected_value_cents, roi_percentage,
              input_sources, collection_names
       FROM trade_ups WHERE trade_up_score = 1005`,
    );
    const { rows: [snap] } = await pool.query<{
      score: number;
      profit: number;
      cost: number;
      ev: number;
      roi: number;
      input_sources: string[];
      collection: string[];
    }>(
      `SELECT score, profit, cost, ev, roi, input_sources, collection
       FROM trade_up_top_snapshots WHERE trade_up_id = $1`,
      [src.id],
    );
    expect(snap).toEqual({
      score: 1005,
      profit: src.profit_cents,
      cost: src.total_cost_cents,
      ev: src.expected_value_cents,
      roi: src.roi_percentage,
      input_sources: src.input_sources,
      collection: src.collection_names,
    });
  });

  it("keeps every active row when fewer than 1000 qualify, highest score first", async () => {
    await pool.query(`
      INSERT INTO trade_ups (
        total_cost_cents, expected_value_cents, profit_cents, roi_percentage,
        listing_status, is_theoretical, trade_up_score, input_sources, collection_names
      ) VALUES
        (100, 150, 50, 0.5, 'active', false, 10, ARRAY['csfloat'], ARRAY['A']),
        (100, 180, 80, 0.8, 'active', false, 20, ARRAY['skinport'], ARRAY['B']),
        (100, 110, 10, 0.1, 'active', false, NULL, ARRAY['buff'], ARRAY['C']),
        (100, 900, 800, 8, 'stale', false, 500, ARRAY['csfloat'], ARRAY['D'])
    `);

    const result = await snapshotTopTradeUps(pool);
    expect(result).toEqual({ inserted: 3, gaveUp: false });

    const { rows } = await pool.query<{ score: number | null }>(
      "SELECT score FROM trade_up_top_snapshots ORDER BY score DESC NULLS LAST",
    );
    expect(rows.map((row) => row.score)).toEqual([20, 10, null]);
  });

  it("gives up instead of waiting when trade_ups is locked", async () => {
    await pool.query(`
      INSERT INTO trade_ups (
        total_cost_cents, expected_value_cents, profit_cents, roi_percentage,
        listing_status, trade_up_score
      ) VALUES (100, 150, 50, 0.5, 'active', 10)
    `);
    const blocker = await pool.connect();
    await blocker.query("BEGIN");
    await blocker.query("LOCK TABLE trade_ups IN ACCESS EXCLUSIVE MODE");
    try {
      const started = Date.now();
      const result = await snapshotTopTradeUps(pool, {
        lockTimeout: "200ms",
        statementTimeout: "30s",
      });
      expect(Date.now() - started).toBeLessThan(2000);
      expect(result).toEqual({ inserted: 0, gaveUp: true });
      const { rows } = await pool.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM trade_up_top_snapshots",
      );
      expect(rows[0]?.n).toBe(0);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
  }, 8_000);
});

describe("purgeOldTopSnapshots", () => {
  it("removes rows older than 14 days, including across batches, and keeps newer rows", async () => {
    await pool.query(
      `INSERT INTO trade_up_top_snapshots (
         snapshot_at, trade_up_id, score, profit, cost, ev, roi, input_sources, collection
       )
       SELECT NOW() - INTERVAL '15 days', i, 1, 1, 1, 1, 0.1, '{}', '{}'
       FROM generate_series(1, $1::int) AS i`,
      [TOP_SNAPSHOT_PURGE_BATCH + 1],
    );
    await pool.query(`
      INSERT INTO trade_up_top_snapshots (
        snapshot_at, trade_up_id, score, profit, cost, ev, roi, input_sources, collection
      ) VALUES
        (NOW() - INTERVAL '14 days' - INTERVAL '1 minute', 90001, 1, 1, 1, 1, 0.1, '{}', '{}'),
        (NOW() - INTERVAL '14 days' + INTERVAL '1 minute', 90002, 2, 2, 2, 2, 0.2, ARRAY['csfloat'], ARRAY['Keep']),
        (NOW() - INTERVAL '1 day', 90003, 3, 3, 3, 3, 0.3, ARRAY['dmarket'], ARRAY['Fresh'])
    `);

    const result = await purgeOldTopSnapshots(pool);
    expect(result).toEqual({
      purged: TOP_SNAPSHOT_PURGE_BATCH + 2,
      gaveUp: false,
    });

    const { rows } = await pool.query<{ trade_up_id: number }>(
      "SELECT trade_up_id FROM trade_up_top_snapshots ORDER BY trade_up_id",
    );
    expect(rows.map((row) => row.trade_up_id)).toEqual([90002, 90003]);
  });

  it("plans the delete as an index range on snapshot_at", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL enable_seqscan = off");
      const { rows } = await client.query<{ "QUERY PLAN": string }>(
        `EXPLAIN ${PURGE_TOP_SNAPSHOT_SQL}`,
        [TOP_SNAPSHOT_PURGE_BATCH],
      );
      await client.query("ROLLBACK");
      const plan = rows.map((row) => row["QUERY PLAN"]).join("\n");
      expect(plan).toMatch(/Index (Only )?Scan|Bitmap Index Scan/);
      expect(plan).not.toMatch(/Seq Scan/);
    } finally {
      client.release();
    }
  });
});

describe("snapshot statement shape", () => {
  it("is a single insert", () => {
    const statements = INSERT_TOP_SNAPSHOT_SQL.split(";").map((part) => part.trim()).filter(Boolean);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^INSERT INTO trade_up_top_snapshots/i);
  });
});
