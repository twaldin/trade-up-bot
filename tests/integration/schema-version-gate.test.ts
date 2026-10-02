/**
 * Integration test: schema version gate in createTables.
 *
 * Verifies that:
 * 1. After createTables runs, sync_meta 'schema_version' === SCHEMA_VERSION.
 * 2. A second call to createTables short-circuits in < 500ms.
 * 3. If schema_version is reset to '0', createTables re-runs the full body and
 *    restores the correct version value.
 *
 * Uses the tradeupbot_test database's public schema.
 * Calls createTables directly — acceptable per drift notes (creates production
 * tables in the test DB's public schema; idempotent / IF NOT EXISTS throughout).
 * Appends `options=-c search_path=public` to the connection string so the
 * information_schema checks in createTables see the public schema only, not
 * the isolated per-test schemas left by other integration tests.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { createTables, SCHEMA_VERSION, getSyncMeta, setSyncMeta } from "../../server/db.js";

const { Pool } = pg;

const base =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgresql://tradeupbot:tradeupbot_pg_2026@localhost:5432/tradeupbot_test";

// Force search_path=public so the information_schema.tables queries inside
// createTables don't see tables from isolated test_* schemas.
const sep = base.includes("?") ? "&" : "?";
const connectionString = `${base}${sep}options=-c%20search_path%3Dpublic`;

let pool: pg.Pool;

beforeAll(async () => {
  pool = new Pool({ connectionString, max: 5 });
  // Start with a clean slate: delete the version key (if sync_meta already
  // exists from a prior run) so createTables executes the full migration body.
  await pool.query("DELETE FROM sync_meta WHERE key = 'schema_version'").catch(() => {
    // sync_meta doesn't exist yet on a fresh DB — that's fine.
    // The first createTables call will create it.
  });
  // Run createTables once to ensure all tables exist for the sub-tests.
  await createTables(pool);
}, 60_000);

afterAll(async () => {
  await pool.end();
});

describe("schema version gate", () => {
  it("exports SCHEMA_VERSION as a non-empty string", () => {
    expect(typeof SCHEMA_VERSION).toBe("string");
    expect(SCHEMA_VERSION.length).toBeGreaterThan(0);
  });

  it("leaves a valid unique index on users.stripe_customer_id", async () => {
    const { rows } = await pool.query<{ valid: boolean }>(
      `SELECT i.indisvalid AS valid
       FROM pg_class c
       JOIN pg_index i ON i.indexrelid = c.oid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relname = 'users_stripe_customer_id_uidx' AND n.nspname = current_schema()`,
    );
    expect(rows).toEqual([{ valid: true }]);
  });

  it("createTables writes schema_version into sync_meta", async () => {
    // Force fresh run by deleting the version key
    await pool.query("DELETE FROM sync_meta WHERE key = 'schema_version'");

    await createTables(pool);

    const stored = await getSyncMeta(pool, "schema_version");
    expect(stored).toBe(SCHEMA_VERSION);
  });

  it("second createTables call completes in < 500ms (gate short-circuits)", async () => {
    // Ensure schema_version is set to the current value
    await setSyncMeta(pool, "schema_version", SCHEMA_VERSION);

    const t0 = Date.now();
    await createTables(pool);
    const elapsed = Date.now() - t0;

    expect(elapsed).toBeLessThan(500);
  });

  it("resets schema_version to '0' → full run and restores correct version", async () => {
    // Set version to stale value to force full re-run
    await setSyncMeta(pool, "schema_version", "0");

    const before = await getSyncMeta(pool, "schema_version");
    expect(before).toBe("0");

    await createTables(pool);

    const after = await getSyncMeta(pool, "schema_version");
    expect(after).toBe(SCHEMA_VERSION);
  });

  it("skips the migration when schema_version matches after the advisory lock", async () => {
    await setSyncMeta(pool, "schema_version", "0");
    const holder = await pool.connect();
    try {
      await holder.query("SET lock_timeout = '15s'");
      await holder.query("SELECT pg_advisory_lock(1)");
      const pending = createTables(pool);
      const deadline = Date.now() + 4000;
      let waiting = false;
      while (Date.now() < deadline) {
        const { rows } = await pool.query(
          `SELECT 1 FROM pg_stat_activity
           WHERE datname = current_database()
             AND pid <> pg_backend_pid()
             AND wait_event_type = 'Lock'
             AND query = 'SELECT pg_advisory_lock(1)'`,
        );
        if (rows.length > 0) {
          waiting = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      expect(waiting).toBe(true);
      await holder.query(
        "UPDATE sync_meta SET value = $1 WHERE key = 'schema_version'",
        [SCHEMA_VERSION],
      );
      const started = Date.now();
      await holder.query("SELECT pg_advisory_unlock(1)");
      await pending;
      expect(Date.now() - started).toBeLessThan(2000);
      expect(await getSyncMeta(pool, "schema_version")).toBe(SCHEMA_VERSION);
    } finally {
      await holder.query("SELECT pg_advisory_unlock(1)").catch(() => undefined);
      holder.release();
    }
  });
});
