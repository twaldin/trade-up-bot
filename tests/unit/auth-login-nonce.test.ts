import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { consumeStoredLoginNonce, SESSION_SAVE_SQL } from "../../server/auth-login-nonce.js";
import { LOGIN_NONCE_TTL_MS } from "../../server/tracking/registration.js";

const NONCE = "ab".repeat(16);
const root = fileURLToPath(new URL("../..", import.meta.url));
const moduleUrl = pathToFileURL(fileURLToPath(new URL("../../server/auth-login-nonce.ts", import.meta.url))).href;
const temps: string[] = [];

afterEach(() => {
  while (temps.length) {
    const path = temps.pop();
    if (path) rmSync(path, { recursive: true, force: true });
  }
});

function openMemory(): Database.Database {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE sessions (sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expired INTEGER NOT NULL)");
  return db;
}

function insert(db: Database.Database, sid: string, issuedAt: number, nonce: string = NONCE): void {
  db.prepare("INSERT INTO sessions (sid, sess, expired) VALUES (?, ?, ?)").run(
    sid,
    JSON.stringify({ cookie: { path: "/" }, passport: { user: "76561198000000000" }, pendingLogin: { nonce, issuedAt } }),
    issuedAt + 86_400_000,
  );
}

function pending(db: Database.Database, sid: string): string | null {
  const row = db.prepare("SELECT sess FROM sessions WHERE sid = ?").get(sid) as { sess: string };
  const parsed = JSON.parse(row.sess) as { pendingLogin?: { nonce: string }; passport?: { user: string } };
  expect(parsed.passport?.user).toBe("76561198000000000");
  return parsed.pendingLogin?.nonce ?? null;
}

function consumeInProcess(dbFile: string, sid: string, lid: string, nowMs: number): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "login-nonce-"));
  temps.push(dir);
  const script = join(dir, "consume.mts");
  writeFileSync(script, `import { createRequire } from "node:module";
import { consumeStoredLoginNonce } from ${JSON.stringify(moduleUrl)};
const Database = createRequire(${JSON.stringify(join(root, "package.json"))})("better-sqlite3");
const db = new Database(process.argv[2]);
const ok = consumeStoredLoginNonce(db, process.argv[3], process.argv[4], Number(process.argv[5]));
db.close();
process.stdout.write(ok ? "yes" : "no");
`);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", script, dbFile, sid, lid, String(nowMs)], { cwd: root });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => { out += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { err += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(err || `consume exited ${code}`));
      else resolve(out);
    });
  });
}

describe("login nonce consume", () => {
  it("accepts a fresh nonce once and leaves the rest of the session", () => {
    const db = openMemory();
    const issuedAt = 1_700_000_000_000;
    insert(db, "sid", issuedAt);
    expect(consumeStoredLoginNonce(db, "sid", NONCE, issuedAt + 1_000)).toBe(true);
    expect(consumeStoredLoginNonce(db, "sid", NONCE, issuedAt + 1_000)).toBe(false);
    expect(pending(db, "sid")).toBeNull();
  });

  it("rejects a mismatched or expired nonce", () => {
    const db = openMemory();
    const issuedAt = 1_700_000_000_000;
    insert(db, "wrong", issuedAt);
    insert(db, "expired", issuedAt);
    expect(consumeStoredLoginNonce(db, "wrong", "cd".repeat(16), issuedAt + 1_000)).toBe(false);
    expect(pending(db, "wrong")).toBe(NONCE);
    expect(consumeStoredLoginNonce(db, "expired", NONCE, issuedAt + LOGIN_NONCE_TTL_MS)).toBe(false);
    expect(pending(db, "expired")).toBeNull();
    expect(consumeStoredLoginNonce(db, "missing", NONCE, issuedAt)).toBe(false);
  });

  it("accepts the nonce from only one of two processes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "login-nonce-db-"));
    temps.push(dir);
    const dbFile = join(dir, "sessions.db");
    const db = new Database(dbFile);
    db.pragma("journal_mode = WAL");
    db.exec("CREATE TABLE sessions (sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expired INTEGER NOT NULL)");
    const issuedAt = Date.now();
    insert(db, "sid", issuedAt);
    db.close();

    const [first, second] = await Promise.all([
      consumeInProcess(dbFile, "sid", NONCE, issuedAt + 1_000),
      consumeInProcess(dbFile, "sid", NONCE, issuedAt + 1_000),
    ]);
    expect([first, second].sort()).toEqual(["no", "yes"]);

    const check = new Database(dbFile);
    expect(pending(check, "sid")).toBeNull();
    expect(consumeStoredLoginNonce(check, "sid", NONCE, issuedAt + 1_000)).toBe(false);
    check.close();
  }, 20_000);

  it("does not let a later session save restore a consumed nonce", () => {
    const db = openMemory();
    const issuedAt = 1_700_000_000_000;
    insert(db, "sid", issuedAt);
    const before = db.prepare("SELECT sess FROM sessions WHERE sid = ?").get("sid") as { sess: string };
    expect(consumeStoredLoginNonce(db, "sid", NONCE, issuedAt + 1_000)).toBe(true);
    db.prepare(SESSION_SAVE_SQL).run("sid", before.sess, issuedAt + 86_400_000);
    expect(pending(db, "sid")).toBeNull();
    const fresh = "cd".repeat(16);
    db.prepare(SESSION_SAVE_SQL).run(
      "sid",
      JSON.stringify({ cookie: { path: "/" }, passport: { user: "76561198000000000" }, pendingLogin: { nonce: fresh, issuedAt } }),
      issuedAt + 86_400_000,
    );
    expect(pending(db, "sid")).toBe(fresh);
  });

  it("does not write the session blob from the login-nonce route", () => {
    const source = readSource();
    const start = source.indexOf('app.post("/api/auth/login-nonce"');
    const end = source.indexOf('app.get("/api/auth/me"');
    const handler = source.slice(start, end);
    expect(handler).toContain("consumeLoginNonce");
    expect(handler).not.toContain("pendingLogin");
  });
});

function readSource(): string {
  return readFileSync(fileURLToPath(new URL("../../server/auth.ts", import.meta.url)), "utf8");
}
