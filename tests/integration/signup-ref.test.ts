/**
 * Integration test: signup_ref attribution column + first-write-wins persistence.
 *
 * Mirrors the UPDATE the Steam callback runs (auth.ts) — `WHERE signup_ref IS NULL`
 * so a creator ref attributes a user exactly once and a later visit can't overwrite it.
 * Uses the tradeupbot_test public schema (createTables provisions the column).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { createTables } from "../../server/db.js";

const { Pool } = pg;

const base =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgresql://tradeupbot:tradeupbot_pg_2026@localhost:5432/tradeupbot_test";
const sep = base.includes("?") ? "&" : "?";
const connectionString = `${base}${sep}options=-c%20search_path%3Dpublic`;

const STEAM_ID = "test_signup_ref_user";
let pool: pg.Pool;

beforeAll(async () => {
  pool = new Pool({ connectionString, max: 5 });
  await createTables(pool);
  // Run the idempotent migration directly (mirrors the ALTER auth.ts runs on every boot).
  // Done here rather than relying on createTables' schema_version gate, which races with
  // schema-version-gate.test.ts over the shared public schema.
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_ref TEXT");
  await pool.query("DELETE FROM users WHERE steam_id = $1", [STEAM_ID]);
}, 60_000);

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE steam_id = $1", [STEAM_ID]).catch(() => {});
  await pool.end();
});

const persistRef = (ref: string) =>
  pool.query(
    "UPDATE users SET signup_ref = $1 WHERE steam_id = $2 AND signup_ref IS NULL",
    [ref, STEAM_ID]
  );

describe("users.signup_ref", () => {
  it("column exists on the users table", async () => {
    const { rows } = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'signup_ref'"
    );
    expect(rows.length).toBe(1);
  });

  it("first ref wins and a later ref does not overwrite it", async () => {
    await pool.query(
      "INSERT INTO users (steam_id, display_name, tier) VALUES ($1, 'Ref Tester', 'free')",
      [STEAM_ID]
    );

    // New user has no attribution yet.
    let { rows } = await pool.query("SELECT signup_ref FROM users WHERE steam_id = $1", [STEAM_ID]);
    expect(rows[0].signup_ref).toBeNull();

    // First ref-bearing login attributes the user.
    await persistRef("creator_a");
    ({ rows } = await pool.query("SELECT signup_ref FROM users WHERE steam_id = $1", [STEAM_ID]));
    expect(rows[0].signup_ref).toBe("creator_a");

    // A later visit via a different creator link must NOT overwrite.
    await persistRef("creator_b");
    ({ rows } = await pool.query("SELECT signup_ref FROM users WHERE steam_id = $1", [STEAM_ID]));
    expect(rows[0].signup_ref).toBe("creator_a");
  });
});
