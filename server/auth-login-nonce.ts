// One-shot login nonce. The compare-and-delete is a single SQLite UPDATE so two
// processes cannot both accept the same lid. express-session saves the whole
// session blob at the end of a request, which would put a consumed nonce back,
// so callers must not write pendingLogin after this returns.
import type Database from "better-sqlite3";
import { isLoginNonce } from "../shared/tracking.js";
import { LOGIN_NONCE_TTL_MS } from "./tracking/registration.js";

const CONSUME_SQL = `UPDATE sessions
  SET sess = json_remove(sess, '$.pendingLogin')
  WHERE sid = ?
    AND json_extract(sess, '$.pendingLogin.nonce') = ?
    AND json_type(sess, '$.pendingLogin.issuedAt') IN ('integer', 'real')
    AND (? - json_extract(sess, '$.pendingLogin.issuedAt')) < ?`;

const CLEAR_EXPIRED_SQL = `UPDATE sessions
  SET sess = json_remove(sess, '$.pendingLogin')
  WHERE sid = ?
    AND json_extract(sess, '$.pendingLogin.nonce') = ?
    AND json_type(sess, '$.pendingLogin.issuedAt') IN ('integer', 'real')
    AND (? - json_extract(sess, '$.pendingLogin.issuedAt')) >= ?`;

/** True only for the first caller that still holds this unexpired nonce. */
export function consumeStoredLoginNonce(
  db: Database.Database,
  sid: string,
  lid: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!sid || !isLoginNonce(lid)) return false;
  db.pragma("busy_timeout = 2000");
  const consume = db.transaction(() => {
    const accepted = db.prepare(CONSUME_SQL).run(sid, lid, nowMs, LOGIN_NONCE_TTL_MS).changes === 1;
    if (!accepted) db.prepare(CLEAR_EXPIRED_SQL).run(sid, lid, nowMs, LOGIN_NONCE_TTL_MS);
    return accepted;
  });
  return consume.immediate();
}
