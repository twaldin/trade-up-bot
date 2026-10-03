import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { redirectAfterSteamLogin } from "../../server/auth.js";
import { consumeStoredLoginNonce, issueStoredLoginNonce, pruneExpiredLoginNonces, startLoginNoncePrune } from "../../server/auth-login-nonce.js";
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

function saveSession(db: Database.Database, sid: string, sess: unknown): void {
  db.prepare("INSERT OR REPLACE INTO sessions (sid, sess, expired) VALUES (?, ?, ?)").run(
    sid,
    JSON.stringify(sess),
    Date.now() + 86_400_000,
  );
}

function nonceCount(db: Database.Database, nonce: string = NONCE): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM login_nonces WHERE nonce = ?").get(nonce) as { n: number };
  return row.n;
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
  it("accepts a fresh nonce once and ignores the session blob", () => {
    const db = openMemory();
    const issuedAt = 1_700_000_000_000;
    issueStoredLoginNonce(db, "sid", NONCE, issuedAt);
    saveSession(db, "sid", { passport: { user: "76561198000000000" }, pendingLogin: { nonce: NONCE, issuedAt } });
    expect(consumeStoredLoginNonce(db, "sid", NONCE, issuedAt + 1_000)).toBe(true);
    expect(consumeStoredLoginNonce(db, "sid", NONCE, issuedAt + 1_000)).toBe(false);
    expect(nonceCount(db)).toBe(0);
  });

  it("rejects a mismatched, cross-session, or expired nonce", () => {
    const db = openMemory();
    const issuedAt = 1_700_000_000_000;
    issueStoredLoginNonce(db, "sid", NONCE, issuedAt);
    issueStoredLoginNonce(db, "other", "cd".repeat(16), issuedAt);
    expect(consumeStoredLoginNonce(db, "sid", "cd".repeat(16), issuedAt + 1_000)).toBe(false);
    expect(consumeStoredLoginNonce(db, "other", NONCE, issuedAt + 1_000)).toBe(false);
    expect(nonceCount(db)).toBe(1);
    expect(consumeStoredLoginNonce(db, "sid", NONCE, issuedAt + LOGIN_NONCE_TTL_MS)).toBe(false);
    expect(nonceCount(db)).toBe(1);
    expect(consumeStoredLoginNonce(db, "missing", NONCE, issuedAt)).toBe(false);
  });

  it("does not resurrect a consumed nonce when a stale session is saved", () => {
    const db = openMemory();
    const issuedAt = 1_700_000_000_000;
    issueStoredLoginNonce(db, "sid", NONCE, issuedAt);
    saveSession(db, "sid", { returnTo: "/pricing", pendingLogin: { nonce: NONCE, issuedAt } });
    expect(consumeStoredLoginNonce(db, "sid", NONCE, issuedAt + 1_000)).toBe(true);
    saveSession(db, "sid", { returnTo: "/trade-ups", pendingLogin: { nonce: NONCE, issuedAt } });
    expect(consumeStoredLoginNonce(db, "sid", NONCE, issuedAt + 2_000)).toBe(false);
    expect(nonceCount(db)).toBe(0);
    const saved = db.prepare("SELECT sess FROM sessions WHERE sid = ?").get("sid") as { sess: string };
    expect(saved.sess).toContain("returnTo");
  });

  it("accepts the nonce from only one of two processes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "login-nonce-db-"));
    temps.push(dir);
    const dbFile = join(dir, "sessions.db");
    const db = new Database(dbFile);
    db.pragma("journal_mode = WAL");
    const issuedAt = Date.now();
    issueStoredLoginNonce(db, "sid", NONCE, issuedAt);
    db.close();

    const [first, second] = await Promise.all([
      consumeInProcess(dbFile, "sid", NONCE, issuedAt + 1_000),
      consumeInProcess(dbFile, "sid", NONCE, issuedAt + 1_000),
    ]);
    expect([first, second].sort()).toEqual(["no", "yes"]);

    const check = new Database(dbFile);
    expect(consumeStoredLoginNonce(check, "sid", NONCE, issuedAt + 1_000)).toBe(false);
    expect(nonceCount(check)).toBe(0);
    check.close();
  }, 20_000);

  it("does not store the nonce on the session from the login or consume routes", () => {
    const source = readFileSync(fileURLToPath(new URL("../../server/auth.ts", import.meta.url)), "utf8");
    expect(source).not.toContain("pendingLogin");
    const start = source.indexOf('app.post("/api/auth/login-nonce"');
    const end = source.indexOf('app.get("/api/auth/me"');
    expect(source.slice(start, end)).toContain("consumeLoginNonce");
  });

  it("drops expired nonces when a new one is issued", () => {
    const db = openMemory();
    const issuedAt = 1_700_000_000_000;
    issueStoredLoginNonce(db, "old", NONCE, issuedAt);
    issueStoredLoginNonce(db, "sid", "cd".repeat(16), issuedAt + LOGIN_NONCE_TTL_MS);
    expect(nonceCount(db)).toBe(0);
    expect(nonceCount(db, "cd".repeat(16))).toBe(1);
  });

  it("keeps issuing when expired-nonce cleanup fails", () => {
    const db = openMemory();
    const issuedAt = 1_700_000_000_000;
    issueStoredLoginNonce(db, "old", NONCE, issuedAt - LOGIN_NONCE_TTL_MS);
    const realPrepare = db.prepare.bind(db);
    vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
      if (sql.includes("expires_at <=")) {
        const statement = realPrepare(sql);
        vi.spyOn(statement, "run").mockImplementation(() => {
          throw new Error("database is locked");
        });
        return statement;
      }
      return realPrepare(sql);
    });
    expect(() => issueStoredLoginNonce(db, "sid", "cd".repeat(16), issuedAt)).not.toThrow();
    expect(nonceCount(db, "cd".repeat(16))).toBe(1);
    expect(() => pruneExpiredLoginNonces(db, issuedAt)).not.toThrow();
  });

  it("drops expired nonces on a timer", () => {
    vi.useFakeTimers();
    const issuedAt = 1_700_000_000_000;
    vi.setSystemTime(issuedAt);
    const db = openMemory();
    issueStoredLoginNonce(db, "sid", NONCE, issuedAt);
    const stop = startLoginNoncePrune(db, 50);
    try {
      vi.advanceTimersByTime(50);
      expect(nonceCount(db)).toBe(1);
      vi.setSystemTime(issuedAt + LOGIN_NONCE_TTL_MS);
      vi.advanceTimersByTime(50);
      expect(nonceCount(db)).toBe(0);
    } finally {
      stop();
      vi.useRealTimers();
    }
  });

  it("redirects without lid when issuing the nonce throws", () => {
    const warn = vi.fn();
    const returned = redirectAfterSteamLogin({
      returnTo: "/trade-ups",
      created: false,
      env: { META_PIXEL_ID: "123456789012345", GA4_MEASUREMENT_ID: "G-NEWPROP123" },
      sessionId: "sid",
      loginNonce: NONCE,
      issueNonce: () => { throw new Error("database is locked"); },
      warn,
    });
    expect(returned.nonce).toBeNull();
    expect(returned.location).toBe("/trade-ups?auth=return");
    expect(returned.location).not.toContain("lid");
    expect(warn).toHaveBeenCalledWith("[tracking] login nonce issue failed (database is locked)");
  });
});
