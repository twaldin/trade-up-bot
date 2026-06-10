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
});
