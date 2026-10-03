import { describe, expect, it, vi } from "vitest";
import {
  indexAfterMigration,
  runStripeCustomerIndex,
  STRIPE_CUSTOMER_INDEX_LOCK_TIMEOUT,
  type StripeIndexSession,
} from "../../server/db.js";

function session(steps: Array<(sql: string, params?: unknown[]) => { rows: Record<string, unknown>[] } | Promise<{ rows: Record<string, unknown>[] }>>): {
  client: StripeIndexSession;
  sql: string[];
  params: unknown[][];
  released: { err?: Error };
} {
  const sql: string[] = [];
  const params: unknown[][] = [];
  const released: { err?: Error } = {};
  const client: StripeIndexSession = {
    query: async (text, values) => {
      sql.push(text);
      params.push(values ?? []);
      const next = steps.shift();
      if (!next) return { rows: [] };
      return next(text, values);
    },
    release: (err) => { released.err = err; },
  };
  return { client, sql, params, released };
}

describe("stripe customer index boot", () => {
  it("skips the index when migration fails", async () => {
    const index = vi.fn();
    await expect(indexAfterMigration(async () => { throw new Error("lock timeout"); }, index)).rejects.toThrow(/lock timeout/);
    expect(index).not.toHaveBeenCalled();
  });

  it("runs the index after migration succeeds", async () => {
    const index = vi.fn();
    await indexAfterMigration(async () => {}, index);
    expect(index).toHaveBeenCalledOnce();
  });

  it("uses a 5s lock timeout, logs a held try-lock, and resets the timeout", async () => {
    const info = vi.fn();
    const { client, sql, params, released } = session([
      () => ({ rows: [] }),
      () => ({ rows: [{ locked: false }] }),
    ]);
    await runStripeCustomerIndex(async () => client, vi.fn(), info);
    expect(STRIPE_CUSTOMER_INDEX_LOCK_TIMEOUT).toBe("5s");
    const timeout = sql.findIndex((text) => text.includes("set_config('lock_timeout'"));
    expect(params[timeout]).toEqual(["5s"]);
    expect(sql.some((text) => text.includes("RESET lock_timeout"))).toBe(true);
    expect(sql.some((text) => text.includes("pg_advisory_unlock"))).toBe(false);
    expect(info).toHaveBeenCalledWith("[tracking] stripe_customer_id unique index skipped: lock held");
    expect(released.err).toBeUndefined();
  });
});
