import { describe, expect, it, vi } from "vitest";
import { ensureStripeCustomerIdUniqueIndex, STRIPE_CUSTOMER_INDEX, type IndexQuery } from "../../server/stripe-customer-index.js";

function scripted(steps: { rows: Record<string, unknown>[] }[], failSql?: string): { query: IndexQuery; sql: string[]; params: unknown[][] } {
  const sql: string[] = [];
  const params: unknown[][] = [];
  const query: IndexQuery = async (text, values) => {
    sql.push(text);
    params.push(values ?? []);
    if (text.startsWith("CREATE") || text.startsWith("DROP")) {
      if (failSql && text.includes(failSql)) throw new Error("index failed");
      return { rows: [] };
    }
    const next = steps.shift();
    return { rows: next?.rows ?? [] };
  };
  return { query, sql, params };
}

describe("stripe_customer_id unique index", () => {
  it("leaves a valid index alone", async () => {
    const log = vi.fn();
    const { query, sql, params } = scripted([{ rows: [{ valid: true }] }]);
    await ensureStripeCustomerIdUniqueIndex(query, log);
    expect(sql).toHaveLength(1);
    expect(params[0]).toEqual([STRIPE_CUSTOMER_INDEX]);
    expect(sql.join("\n")).not.toContain("CREATE UNIQUE INDEX");
    expect(log).not.toHaveBeenCalled();
  });

  it("creates the index concurrently when none exists and rows are unique", async () => {
    const log = vi.fn();
    const { query, sql } = scripted([
      { rows: [] },
      { rows: [] },
      { rows: [{ valid: true }] },
    ]);
    await ensureStripeCustomerIdUniqueIndex(query, log);
    const create = sql.find((statement) => statement.startsWith("CREATE UNIQUE INDEX"));
    expect(create).toBe(`CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ${STRIPE_CUSTOMER_INDEX} ON users (stripe_customer_id)`);
    expect(sql.join("\n")).not.toMatch(/\bBEGIN\b/);
    expect(log).not.toHaveBeenCalled();
  });

  it("skips the build when more than one user shares a customer id", async () => {
    const log = vi.fn();
    const { query, sql } = scripted([
      { rows: [] },
      { rows: [{ n: 1 }] },
    ]);
    await ensureStripeCustomerIdUniqueIndex(query, log);
    expect(sql.some((statement) => statement.startsWith("CREATE"))).toBe(false);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toContain("duplicates");
  });

  it("drops an invalid index and does not throw when the build fails", async () => {
    const log = vi.fn();
    const { query, sql } = scripted([{ rows: [{ valid: false }] }, { rows: [] }], "CREATE UNIQUE INDEX");
    await expect(ensureStripeCustomerIdUniqueIndex(query, log)).resolves.toBeUndefined();
    const drops = sql.filter((statement) => statement.startsWith("DROP INDEX CONCURRENTLY"));
    expect(drops).toEqual([
      `DROP INDEX CONCURRENTLY IF EXISTS ${STRIPE_CUSTOMER_INDEX}`,
      `DROP INDEX CONCURRENTLY IF EXISTS ${STRIPE_CUSTOMER_INDEX}`,
    ]);
    expect(log).toHaveBeenCalled();
  });

  it("drops the index when the build leaves it invalid", async () => {
    const log = vi.fn();
    const { query, sql } = scripted([
      { rows: [] },
      { rows: [] },
      { rows: [{ valid: false }] },
    ]);
    await ensureStripeCustomerIdUniqueIndex(query, log);
    expect(sql.filter((statement) => statement.startsWith("DROP INDEX CONCURRENTLY"))).toEqual([
      `DROP INDEX CONCURRENTLY IF EXISTS ${STRIPE_CUSTOMER_INDEX}`,
    ]);
    expect(String(log.mock.calls[0][0])).toContain("unique index skipped");
  });
});
