// Unique stripe_customer_id. CREATE INDEX CONCURRENTLY cannot run inside a
// transaction, so callers must use a connection that has not issued BEGIN.
// The migration advisory lock stays on the other session while this runs.
export const STRIPE_CUSTOMER_INDEX = "users_stripe_customer_id_uidx";

const SKIPPED = "[tracking] stripe_customer_id unique index skipped";
const DUPLICATES = "[tracking] stripe_customer_id has duplicates; unique index skipped. Purchase CAPI skips when more than one user matches.";

export interface IndexQuery {
  (sql: string, params?: unknown[]): Promise<{ rows: readonly Record<string, unknown>[] }>;
}

async function dropInvalidIndex(query: IndexQuery, log: (message: string) => void): Promise<void> {
  try {
    await query(`DROP INDEX CONCURRENTLY IF EXISTS ${STRIPE_CUSTOMER_INDEX}`);
  } catch {
    try { log(`${SKIPPED}; invalid index remains`); } catch { /* ignore */ }
  }
}

/** Build or repair the unique index. Never throws. An INVALID index is dropped. */
export async function ensureStripeCustomerIdUniqueIndex(
  query: IndexQuery,
  log: (message: string) => void = () => {},
): Promise<void> {
  try {
    const existing = await query(
      `SELECT i.indisvalid AS valid
       FROM pg_class c
       JOIN pg_index i ON i.indexrelid = c.oid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relname = $1 AND n.nspname = current_schema()`,
      [STRIPE_CUSTOMER_INDEX],
    );
    const current = existing.rows[0];
    if (current && current.valid === true) return;
    if (current) await dropInvalidIndex(query, log);

    const dupes = await query(
      `SELECT 1 FROM users
       WHERE stripe_customer_id IS NOT NULL AND stripe_customer_id <> ''
       GROUP BY stripe_customer_id
       HAVING COUNT(*) > 1
       LIMIT 1`,
    );
    if (dupes.rows.length > 0) {
      try { log(DUPLICATES); } catch { /* ignore */ }
      return;
    }

    try {
      await query(`CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ${STRIPE_CUSTOMER_INDEX} ON users (stripe_customer_id)`);
    } catch {
      await dropInvalidIndex(query, log);
      try { log(SKIPPED); } catch { /* ignore */ }
      return;
    }

    const after = await query(
      `SELECT i.indisvalid AS valid
       FROM pg_class c
       JOIN pg_index i ON i.indexrelid = c.oid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relname = $1 AND n.nspname = current_schema()`,
      [STRIPE_CUSTOMER_INDEX],
    );
    if (after.rows[0]?.valid !== true) {
      await dropInvalidIndex(query, log);
      try { log(SKIPPED); } catch { /* ignore */ }
    }
  } catch {
    try { log(SKIPPED); } catch { /* ignore */ }
  }
}
