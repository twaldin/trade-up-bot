import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTables, SCHEMA_VERSION, setSyncMeta } from "../../server/db.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const tsx = join(root, "node_modules/.bin/tsx");
const adminUrl = process.env.TEST_DATABASE_URL
  || process.env.DATABASE_URL
  || "postgresql://tradeupbot:tradeupbot_pg_2026@localhost:5432/tradeupbot_test";

const dbName = `tub_miglock_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;

function databaseUrl(name: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

function runMigrate(databaseUrlValue: string): Promise<{ code: number; stdout: string; stderr: string; elapsed: number }> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(tsx, [join(root, "scripts/migrate.ts")], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: databaseUrlValue },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 18_000);
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr, elapsed: Date.now() - started });
    });
  });
}

let admin: pg.Pool;

beforeAll(async () => {
  if (!/^[a-z0-9_]+$/.test(dbName)) throw new Error(`unsafe database name ${dbName}`);
  admin = new pg.Pool({ connectionString: adminUrl, max: 1 });
  await admin.query(`CREATE DATABASE ${dbName}`);
  const pool = new pg.Pool({ connectionString: databaseUrl(dbName), max: 2 });
  try {
    await createTables(pool);
    await setSyncMeta(pool, "schema_version", "0");
  } finally {
    await pool.end();
  }
}, 60_000);

afterAll(async () => {
  await admin.query(
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
    [dbName],
  );
  await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
  await admin.end();
});

describe("scripts/migrate.ts lock timeout", () => {
  it("fails within about 5s with a 55P03 error naming the blocked statement", async () => {
    const pkg = readFileSync(join(root, "package.json"), "utf8");
    expect(pkg).toContain('"migrate": "tsx scripts/migrate.ts"');
    expect(readFileSync(join(root, "scripts/migrate.ts"), "utf8")).toContain("SET lock_timeout = '5s'");

    const pool = new pg.Pool({ connectionString: databaseUrl(dbName), max: 2 });
    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query("LOCK TABLE trade_ups IN ACCESS SHARE MODE");
      const result = await runMigrate(databaseUrl(dbName));
      expect(result.code).not.toBe(0);
      expect(result.elapsed).toBeGreaterThan(4_000);
      expect(result.elapsed).toBeLessThan(12_000);
      const output = `${result.stdout}\n${result.stderr}`;
      expect(output).toContain("55P03");
      expect(output).toMatch(/lock timeout/i);
      expect(output).toContain("ALTER TABLE trade_ups");
      expect(output).toContain("input_sources");
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      holder.release();
      await pool.end();
    }
  }, 20_000);

  it("exits 0 when the schema is already current", async () => {
    const pool = new pg.Pool({ connectionString: databaseUrl(dbName), max: 1 });
    try {
      await setSyncMeta(pool, "schema_version", SCHEMA_VERSION);
    } finally {
      await pool.end();
    }
    const result = await runMigrate(databaseUrl(dbName));
    expect(result.code).toBe(0);
    expect(result.elapsed).toBeLessThan(8_000);
    expect(`${result.stdout}\n${result.stderr}`).not.toContain("55P03");
  }, 15_000);
});
