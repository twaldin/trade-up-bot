import { describe, expect, it, vi } from "vitest";
import {
  classifyIndexError,
  ensureStripeCustomerIdUniqueIndex,
  STRIPE_CUSTOMER_INDEX,
  STRIPE_CUSTOMER_NONEMPTY,
  type IndexQuery,
} from "../../server/stripe-customer-index.js";

const PARTIAL = "(stripe_customer_id IS NOT NULL) AND (stripe_customer_id <> ''::text)";
const READY = { valid: true, predicate: PARTIAL };

function scripted(steps: { rows: Record<string, unknown>[] }[], fail?: { sql: string; error: unknown }): { query: IndexQuery; sql: string[] } {
  const sql: string[] = [];
  const query: IndexQuery = async (text) => {
    sql.push(text);
    if (fail && (text.startsWith("CREATE") || text.startsWith("DROP")) && text.includes(fail.sql)) throw fail.error;
    if (text.startsWith("CREATE") || text.startsWith("DROP")) return { rows: [] };
    const next = steps.shift();
    return { rows: next?.rows ?? [] };
  };
  return { query, sql };
}

describe("stripe_customer_id unique index", () => {
  it("leaves a valid partial index alone", async () => {
    const log = vi.fn();
    const { query, sql } = scripted([{ rows: [READY] }]);
    const outcome = await ensureStripeCustomerIdUniqueIndex(query, log);
    expect(outcome).toEqual({ ok: true });
    expect(sql).toHaveLength(1);
    expect(sql[0]).toContain("indisvalid");
    expect(sql.join("\n")).not.toContain("CREATE UNIQUE INDEX");
    expect(log).not.toHaveBeenCalled();
  });

  it("creates a partial index concurrently when none exists and rows are unique", async () => {
    const log = vi.fn();
    const { query, sql } = scripted([
      { rows: [] },
      { rows: [] },
      { rows: [READY] },
    ]);
    const outcome = await ensureStripeCustomerIdUniqueIndex(query, log);
    expect(outcome).toEqual({ ok: true });
    const create = sql.find((statement) => statement.startsWith("CREATE UNIQUE INDEX"));
    expect(create).toBe(`CREATE UNIQUE INDEX CONCURRENTLY ${STRIPE_CUSTOMER_INDEX} ON users (stripe_customer_id) WHERE ${STRIPE_CUSTOMER_NONEMPTY}`);
    expect(create).toContain(STRIPE_CUSTOMER_NONEMPTY);
    const dupes = sql.find((statement) => statement.startsWith("SELECT 1 FROM users"));
    expect(dupes).toContain(STRIPE_CUSTOMER_NONEMPTY);
    expect(sql.join("\n")).not.toMatch(/\bBEGIN\b/);
    expect(log).not.toHaveBeenCalled();
  });

  it("drops an invalid index and rebuilds the partial index", async () => {
    const log = vi.fn();
    const { query, sql } = scripted([
      { rows: [{ valid: false, predicate: null }] },
      { rows: [] },
      { rows: [] },
      { rows: [READY] },
    ]);
    const outcome = await ensureStripeCustomerIdUniqueIndex(query, log);
    expect(outcome).toEqual({ ok: true });
    expect(sql.filter((statement) => statement.startsWith("DROP INDEX CONCURRENTLY"))).toEqual([
      `DROP INDEX CONCURRENTLY IF EXISTS ${STRIPE_CUSTOMER_INDEX}`,
    ]);
    expect(sql.some((statement) => statement.startsWith("CREATE UNIQUE INDEX CONCURRENTLY"))).toBe(true);
    expect(log).not.toHaveBeenCalled();
  });

  it("drops a valid index that is not partial and rebuilds it", async () => {
    const log = vi.fn();
    const { query, sql } = scripted([
      { rows: [{ valid: true, predicate: null }] },
      { rows: [] },
      { rows: [] },
      { rows: [READY] },
    ]);
    const outcome = await ensureStripeCustomerIdUniqueIndex(query, log);
    expect(outcome).toEqual({ ok: true });
    expect(sql.some((statement) => statement.startsWith("DROP INDEX CONCURRENTLY"))).toBe(true);
    expect(sql.some((statement) => statement.includes("WHERE " + STRIPE_CUSTOMER_NONEMPTY))).toBe(true);
    expect(log).not.toHaveBeenCalled();
  });

  it("skips the build when more than one user shares a nonempty customer id", async () => {
    const log = vi.fn();
    const { query, sql } = scripted([
      { rows: [] },
      { rows: [{ n: 1 }] },
    ]);
    const outcome = await ensureStripeCustomerIdUniqueIndex(query, log);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("duplicates");
    expect(sql.some((statement) => statement.startsWith("CREATE"))).toBe(false);
    expect(String(log.mock.calls[0][0])).toContain("duplicates");
  });

  it("logs a lock error and does not throw when the build fails", async () => {
    const log = vi.fn();
    const error = Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" });
    const { query, sql } = scripted([
      { rows: [{ valid: false, predicate: null }] },
      { rows: [] },
      { rows: [] },
    ], { sql: "CREATE UNIQUE INDEX", error });
    const outcome = await ensureStripeCustomerIdUniqueIndex(query, log);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("lock");
    expect(sql.filter((statement) => statement.startsWith("DROP INDEX CONCURRENTLY"))).toHaveLength(2);
    expect(String(log.mock.calls[0][0])).toContain("lock");
    expect(String(log.mock.calls[0][0])).not.toContain("cus_");
  });

  it("logs a timeout separately from a lock", () => {
    const outcome = classifyIndexError(Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" }));
    expect(outcome.reason).toBe("timeout");
    expect(outcome.message).toContain("timeout");
  });

  it("logs other errors without treating them as success", async () => {
    const log = vi.fn();
    const { query } = scripted([
      { rows: [] },
      { rows: [] },
    ], { sql: "CREATE UNIQUE INDEX", error: Object.assign(new Error("disk full"), { code: "53100" }) });
    const outcome = await ensureStripeCustomerIdUniqueIndex(query, log);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("other");
    expect(String(log.mock.calls[0][0])).toContain("other");
    expect(String(log.mock.calls[0][0])).toContain("disk full");
  });

  it("names duplicates only when duplicate rows are the cause", () => {
    const duplicates = classifyIndexError(Object.assign(new Error("could not create unique index"), { code: "23505" }));
    expect(duplicates.message).toContain("duplicates");
    expect(duplicates.message).not.toContain("not unique");
    const other = classifyIndexError(Object.assign(new Error("disk full"), { code: "53100" }));
    expect(other.message).not.toContain("not unique");
    expect(other.message).not.toContain("duplicates");
  });

});
