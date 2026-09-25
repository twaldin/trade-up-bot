/**
 * The Steam login upsert reports a brand-new row with RETURNING (xmax = 0).
 * Same single statement as server/auth.ts. A repeat login updates in place.
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

const STEAM_ID = "test_xmax_inserted_user";
let pool: pg.Pool;

const upsert = () => pool.query<{ inserted: boolean }>(`
  INSERT INTO users (steam_id, display_name, avatar_url, is_admin, last_login_at)
  VALUES ($1, $2, $3, $4, NOW())
  ON CONFLICT(steam_id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    avatar_url = EXCLUDED.avatar_url,
    is_admin = GREATEST(users.is_admin, EXCLUDED.is_admin),
    last_login_at = NOW()
  RETURNING (xmax = 0) AS inserted
`, [STEAM_ID, "Xmax Tester", "", false]);

beforeAll(async () => {
  pool = new Pool({ connectionString, max: 5 });
  await createTables(pool);
  await pool.query("DELETE FROM users WHERE steam_id = $1", [STEAM_ID]);
}, 60_000);

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE steam_id = $1", [STEAM_ID]).catch(() => {});
  await pool.end();
});

describe("users upsert inserted flag", () => {
  it("is true on the first login and false on a repeat login", async () => {
    const first = await upsert();
    expect(first.rows[0].inserted).toBe(true);
    const again = await upsert();
    expect(again.rows[0].inserted).toBe(false);
  });
});
