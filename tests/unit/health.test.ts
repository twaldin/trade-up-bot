import express from "express";
import pg from "pg";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { healthRouter } from "../../server/routes/health.js";

describe("GET /api/health", () => {
  it("returns 503 when the database ping fails", async () => {
    const pool = new pg.Pool({
      host: "127.0.0.1",
      port: 1,
      connectionTimeoutMillis: 300,
      max: 1,
    });
    const app = express();
    app.use(healthRouter(pool));
    try {
      const res = await request(app).get("/api/health");
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ ok: false });
      expect(res.headers["cache-control"]).toBe("no-store");
    } finally {
      await pool.end();
    }
  });
});
