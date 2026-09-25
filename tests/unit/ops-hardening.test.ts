import express from "express";
import type { NextFunction, Request, Response } from "express";
import pg from "pg";
import request from "supertest";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { statusRouter } from "../../server/routes/status.js";
import { unknownApiJson404 } from "../../server/unknown-api.js";

function user(admin: boolean) {
  return {
    steam_id: admin ? "admin" : "user",
    display_name: admin ? "Admin" : "User",
    avatar_url: "",
    tier: "free",
    is_admin: admin,
  } as Express.User;
}

function appWith(session: "none" | "user" | "admin") {
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (session === "user") req.user = user(false);
    if (session === "admin") req.user = user(true);
    next();
  });
  const pool = new pg.Pool({ host: "127.0.0.1", port: 1, connectionTimeoutMillis: 200, max: 1 });
  app.use(statusRouter(pool));
  return { app, pool };
}

describe("/api/daemon-log admin auth", () => {
  it("returns 403 JSON when there is no session", async () => {
    const { app, pool } = appWith("none");
    const res = await request(app).get("/api/daemon-log");
    expect(res.status).toBe(403);
    expect(res.headers["content-type"]).toMatch(/json/);
    expect(res.body).toEqual({ error: "Admin only" });
    await pool.end();
  });

  it("returns 403 JSON for a signed-in non-admin", async () => {
    const { app, pool } = appWith("user");
    const res = await request(app).get("/api/daemon-log");
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Admin only" });
    await pool.end();
  });

  it("returns the log JSON for an admin", async () => {
    const { app, pool } = appWith("admin");
    const res = await request(app).get("/api/daemon-log");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/json/);
    expect(Array.isArray(res.body.lines)).toBe(true);
    await pool.end();
  });

  it("sends the session cookie from the admin daemon modal", () => {
    const source = readFileSync(new URL("../../src/components/DaemonModal.tsx", import.meta.url), "utf8");
    expect(source).toContain('fetch("/api/daemon-log", { credentials: "include" })');
  });
});

describe("unknown /api paths", () => {
  function app() {
    const server = express();
    server.get("/api/status", (_req, res) => { res.json({ ok: true }); });
    server.use(unknownApiJson404);
    server.get("*", (_req, res) => {
      res.status(200).type("html").send("<html>spa</html>");
    });
    return server;
  }

  it("returns JSON 404 for an unknown /api GET and leaves the SPA for other paths", async () => {
    const server = app();
    const missing = await request(server).get("/api/does-not-exist");
    expect(missing.status).toBe(404);
    expect(missing.headers["content-type"]).toMatch(/json/);
    expect(missing.body).toEqual({ error: "not_found" });
    expect(missing.text).not.toContain("<html>");

    const known = await request(server).get("/api/status");
    expect(known.status).toBe(200);
    expect(known.body).toEqual({ ok: true });

    const spa = await request(server).get("/pricing");
    expect(spa.status).toBe(200);
    expect(spa.text).toContain("<html>spa</html>");
  });

  it("is registered before the SPA catch-all", () => {
    const source = readFileSync(new URL("../../server/index.ts", import.meta.url), "utf8");
    const registered = source.indexOf("app.use(unknownApiJson404)");
    const catchAll = source.lastIndexOf('app.get("*"');
    expect(registered).toBeGreaterThan(0);
    expect(registered).toBeLessThan(catchAll);
  });
});
