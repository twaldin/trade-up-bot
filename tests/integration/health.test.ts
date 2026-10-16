import express from "express";
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { healthRouter, pingDatabase } from "../../server/routes/health.js";

const connectionString = process.env.TEST_DATABASE_URL
  || process.env.DATABASE_URL
  || "postgresql://tradeupbot:tradeupbot_pg_2026@localhost:5432/tradeupbot_test";

let pool: pg.Pool;

beforeAll(() => {
  pool = new pg.Pool({ connectionString, max: 2 });
});

afterAll(async () => {
  await pool.end();
});

describe("GET /api/health", () => {
  it("returns 200 {ok:true} when SELECT 1 succeeds", async () => {
    const app = express();
    app.use(healthRouter(pool));
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(res.headers["cache-control"]).toBe("no-store");

    expect(await pingDatabase(pool)).toBe(true);
    const client = await pool.connect();
    try {
      const { rows } = await client.query<{ statement_timeout: string }>("SHOW statement_timeout");
      expect(rows[0]?.statement_timeout).toBe("0");
    } finally {
      client.release();
    }
  });
});
