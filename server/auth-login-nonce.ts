// One-shot login nonce. It lives in its own table, not the session blob, so a
// later session save cannot put it back. Consume is one DELETE ... RETURNING.
import type Database from "better-sqlite3";
import { isLoginNonce } from "../shared/tracking.js";
import { LOGIN_NONCE_TTL_MS } from "./tracking/registration.js";

export const LOGIN_NONCE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS login_nonces (
  nonce TEXT PRIMARY KEY,
  sid TEXT NOT NULL,
  expires_at INTEGER NOT NULL
)`;

const INSERT_SQL = `INSERT INTO login_nonces (nonce, sid, expires_at) VALUES (?, ?, ?)`;

const CONSUME_SQL = `DELETE FROM login_nonces
  WHERE nonce = ? AND sid = ? AND expires_at > ?
  RETURNING nonce`;

export function ensureLoginNonceTable(db: Database.Database): void {
  db.exec(LOGIN_NONCE_TABLE_SQL);
}

/** Bind a fresh nonce to this session. expires_at is issuedAt + 10 minutes. */
export function issueStoredLoginNonce(
  db: Database.Database,
  sid: string,
  nonce: string,
  nowMs: number = Date.now(),
): void {
  if (!sid || !isLoginNonce(nonce)) return;
  ensureLoginNonceTable(db);
  db.prepare(INSERT_SQL).run(nonce, sid, nowMs + LOGIN_NONCE_TTL_MS);
}

/** True only for the first caller that still holds this unexpired nonce on this session. */
export function consumeStoredLoginNonce(
  db: Database.Database,
  sid: string,
  lid: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!sid || !isLoginNonce(lid)) return false;
  ensureLoginNonceTable(db);
  db.pragma("busy_timeout = 2000");
  const row = db.prepare(CONSUME_SQL).get(lid, sid, nowMs) as { nonce: string } | undefined;
  return row?.nonce === lid;
}
