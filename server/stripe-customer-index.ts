// Unique stripe_customer_id for nonempty values. CREATE INDEX CONCURRENTLY
// cannot run inside a transaction, so callers must use an autocommit connection
// that is not waiting on, or holding, the migration advisory lock.
export const STRIPE_CUSTOMER_INDEX = "users_stripe_customer_id_uidx";

/** Rows this index covers. The duplicate pre-check uses the same predicate. */
export const STRIPE_CUSTOMER_NONEMPTY = "stripe_customer_id IS NOT NULL AND stripe_customer_id <> ''";

const CREATE_INDEX_SQL = `CREATE UNIQUE INDEX CONCURRENTLY ${STRIPE_CUSTOMER_INDEX} ON users (stripe_customer_id) WHERE ${STRIPE_CUSTOMER_NONEMPTY}`;
const DROP_INDEX_SQL = `DROP INDEX CONCURRENTLY IF EXISTS ${STRIPE_CUSTOMER_INDEX}`;
const DUPLICATE_SQL = `SELECT 1 FROM users WHERE ${STRIPE_CUSTOMER_NONEMPTY} GROUP BY stripe_customer_id HAVING COUNT(*) > 1 LIMIT 1`;
const LOOKUP_SQL = `SELECT i.indisvalid AS valid,
       i.indisunique AS is_unique,
       i.indnkeyatts AS key_count,
       pg_get_indexdef(i.indexrelid, 1, true) AS key_definition,
       pg_get_expr(i.indpred, i.indrelid) AS predicate
       FROM pg_class c
       JOIN pg_index i ON i.indexrelid = c.oid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relname = $1 AND n.nspname = current_schema()`;

export type IndexFailureReason = "duplicates" | "lock" | "timeout" | "other";

export type IndexEnsureResult =
  | { ok: true }
  | { ok: false; reason: IndexFailureReason; message: string };

export interface IndexQuery {
  (sql: string, params?: unknown[]): Promise<{ rows: readonly Record<string, unknown>[] }>;
}

function skipped(reason: IndexFailureReason, detail: string): { ok: false; reason: IndexFailureReason; message: string } {
  return {
    ok: false,
    reason,
    message: `[tracking] stripe_customer_id unique index skipped: ${reason} (${detail})`,
  };
}

function errorCode(err: unknown): string | null {
  if (typeof err !== "object" || err === null || !("code" in err)) return null;
  return typeof err.code === "string" ? err.code : null;
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "unknown error";
}

/** Classify a Postgres failure without echoing a duplicate key value. */
export function classifyIndexError(err: unknown): { ok: false; reason: IndexFailureReason; message: string } {
  const code = errorCode(err);
  const message = errorText(err);
  if (code === "23505" || /duplicate key value|could not create unique index/i.test(message)) {
    return skipped("duplicates", code ?? "23505");
  }
  if (code === "55P03" || code === "40P01" || /lock timeout|deadlock detected/i.test(message)) {
    return skipped("lock", code ?? "lock timeout");
  }
  if (code === "57014" || /statement timeout|canceling statement due to statement timeout/i.test(message)) {
    return skipped("timeout", code ?? "57014");
  }
  const detail = `${code ? `${code}: ` : ""}${message}`.replace(/\s+/g, " ").slice(0, 180);
  return skipped("other", detail);
}

function predicateMatches(predicate: unknown): boolean {
  if (typeof predicate !== "string") return false;
  const normalized = predicate.toLowerCase().replace(/::text/g, "").replace(/\s+/g, " ");
  return normalized.includes("stripe_customer_id is not null") && normalized.includes("stripe_customer_id <> ''");
}

function isReadyIndex(row: Record<string, unknown> | undefined): boolean {
  return !!row
    && row.valid === true
    && row.is_unique === true
    && row.key_count === 1
    && row.key_definition === "stripe_customer_id"
    && predicateMatches(row.predicate);
}

async function lookupIndex(query: IndexQuery): Promise<Record<string, unknown> | undefined> {
  const existing = await query(LOOKUP_SQL, [STRIPE_CUSTOMER_INDEX]);
  return existing.rows[0];
}

async function dropIndex(query: IndexQuery): Promise<void> {
  await query(DROP_INDEX_SQL);
}

let loggedDuplicateCustomerIds = false;

/** Tests call this so each case sees a fresh process. */
export function resetStripeCustomerIndexWarningsForTests(): void {
  loggedDuplicateCustomerIds = false;
}

function warn(
  log: (message: string) => void,
  failure: { ok: false; reason: IndexFailureReason; message: string },
): { ok: false; reason: IndexFailureReason; message: string } {
  if (failure.reason === "duplicates") {
    if (loggedDuplicateCustomerIds) return failure;
    loggedDuplicateCustomerIds = true;
  }
  try { log(failure.message); } catch { /* ignore */ }
  return failure;
}

/** Build or repair the partial unique index. Never throws. Startup continues either way. */
export async function ensureStripeCustomerIdUniqueIndex(
  query: IndexQuery,
  log: (message: string) => void = () => {},
): Promise<IndexEnsureResult> {
  try {
    const current = await lookupIndex(query);
    if (isReadyIndex(current)) return { ok: true };
    if (current) {
      try {
        await dropIndex(query);
      } catch (err) {
        return warn(log, classifyIndexError(err));
      }
      const still = await lookupIndex(query);
      if (still) return warn(log, skipped("other", "invalid index remains"));
    }

    const dupes = await query(DUPLICATE_SQL);
    if (dupes.rows.length > 0) return warn(log, skipped("duplicates", "nonempty stripe_customer_id"));

    try {
      await query(CREATE_INDEX_SQL);
    } catch (err) {
      try { await dropIndex(query); } catch { /* the create error is the cause */ }
      return warn(log, classifyIndexError(err));
    }

    const after = await lookupIndex(query);
    if (!isReadyIndex(after)) {
      try { await dropIndex(query); } catch { /* logged below */ }
      return warn(log, skipped("other", "index left invalid"));
    }
    return { ok: true };
  } catch (err) {
    return warn(log, classifyIndexError(err));
  }
}
