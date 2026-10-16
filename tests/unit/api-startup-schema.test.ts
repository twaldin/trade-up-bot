import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertSchemaCurrent, MigrationLockTimeoutError, SCHEMA_VERSION } from "../../server/db.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function startupSource(): { boot: string; auth: string } {
  const index = readFileSync(join(root, "server/index.ts"), "utf8");
  const bootStart = index.indexOf("const pool: pg.Pool = initDb()");
  const bootEnd = index.indexOf("initRedis()");
  const auth = readFileSync(join(root, "server/auth.ts"), "utf8");
  const authStart = auth.indexOf("export async function setupAuth");
  const authEnd = auth.indexOf("const store = new SqliteSessionStore");
  return {
    boot: index.slice(bootStart, bootEnd),
    auth: auth.slice(authStart, authEnd),
  };
}

describe("api startup schema", () => {
  it("api startup no longer runs ALTER statements", async () => {
    const seen: string[] = [];
    await assertSchemaCurrent({
      async query(sql) {
        seen.push(sql);
        return { rows: [{ value: SCHEMA_VERSION }] };
      },
    });
    expect(seen).toEqual(["SELECT value FROM sync_meta WHERE key = $1"]);
    expect(seen.join("\n")).not.toMatch(/\bALTER\b/i);
    expect(seen.join("\n")).not.toMatch(/\b(CREATE|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b/i);

    const stale: string[] = [];
    await expect(assertSchemaCurrent({
      async query(sql) {
        stale.push(sql);
        return { rows: [{ value: "0" }] };
      },
    })).rejects.toThrow(/npm run migrate/);
    expect(stale.join("\n")).not.toMatch(/\bALTER\b/i);
    expect(stale.every((sql) => /^\s*SELECT\b/i.test(sql))).toBe(true);

    const missing: string[] = [];
    await expect(assertSchemaCurrent({
      async query(sql) {
        missing.push(sql);
        throw new Error("relation sync_meta does not exist");
      },
    })).rejects.toThrow(/Schema is not current/);
    expect(missing.join("\n")).not.toMatch(/\bALTER\b/i);

    const { boot, auth } = startupSource();
    expect(boot).toContain("assertSchemaCurrent");
    expect(boot).not.toContain("createTables");
    expect(boot).not.toMatch(/\bALTER\b/);
    expect(boot).not.toMatch(/\bCREATE\b/);
    expect(auth).not.toMatch(/ALTER TABLE/);
    expect(auth).not.toMatch(/CREATE TABLE/);
  });

  it("names a blocked statement and the 55P03 lock timeout", () => {
    const err = new MigrationLockTimeoutError(
      "ALTER TABLE trade_ups ADD COLUMN IF NOT EXISTS input_sources TEXT[] NOT NULL DEFAULT '{}'",
    );
    expect(err.message).toContain("55P03");
    expect(err.message).toContain("lock timeout");
    expect(err.message).toContain("ALTER TABLE trade_ups ADD COLUMN IF NOT EXISTS input_sources");
    expect(err.statement).toContain("input_sources");
  });
});
