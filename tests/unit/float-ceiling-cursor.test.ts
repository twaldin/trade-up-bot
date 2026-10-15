import { afterEach, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { PRICE_CACHE_TTL_MS } from "../../server/engine/pricing.js";
import {
  ageFloatCeilingForTests,
  ensureFloatCeilingForTests,
  floatCeilingRowsForTests,
  resetPriceCacheForTests,
  seedFloatCeilingForTests,
} from "../../server/engine/pricing.js";

const SKIN = "AK-47 | Redline";

interface CursorScript {
  failOnFetch: number | null;
  failRollback: boolean;
  empty: boolean;
}

function cursorPool(script: CursorScript): {
  pool: pg.Pool;
  statements: string[];
  releaseCount: () => number;
  releaseError: () => Error | undefined;
} {
  const statements: string[] = [];
  let fetches = 0;
  let releases = 0;
  let releaseErr: Error | undefined;
  const client = {
    query: async (sql: string) => {
      const text = String(sql).trim();
      const head = text.split(/\s+/)[0]?.toUpperCase() ?? "";
      statements.push(head);
      if (head === "DECLARE" && !text.includes("COALESCE(l.source, 'csfloat')")) {
        throw new Error("declare is missing the single-query ceiling select");
      }
      if (head === "DECLARE" && text.includes("UNION")) {
        throw new Error("declare still uses UNION");
      }
      if (head === "FETCH") {
        fetches++;
        if (script.failOnFetch === fetches) throw new Error("cursor walk failed");
        if (!script.empty && fetches === 1) {
          return {
            rows: [{
              skin_name: SKIN,
              float_value: 0.22,
              price_cents: 1100,
              source: "csfloat",
            }],
          };
        }
        return { rows: [] };
      }
      if (head === "ROLLBACK" && script.failRollback) throw new Error("rollback failed");
      return { rows: [] };
    },
    release(err?: Error) {
      releases++;
      releaseErr = err;
    },
  };
  const pool = {
    connect: async () => client,
    query: async (_sql: string) => {
      throw new Error("ceiling walk used pool.query");
    },
  };
  return {
    pool: pool as pg.Pool,
    statements,
    releaseCount: () => releases,
    releaseError: () => releaseErr,
  };
}

function staleSeed(): void {
  seedFloatCeilingForTests(SKIN, 0.2, 1000);
  ageFloatCeilingForTests(PRICE_CACHE_TTL_MS + 1_000);
}

describe("float ceiling cursor cleanup", () => {
  afterEach(() => {
    resetPriceCacheForTests();
    vi.restoreAllMocks();
  });

  it("closes, rolls back, and releases when the walk throws, and keeps the old cache", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    staleSeed();
    const cursor = cursorPool({ failOnFetch: 2, failRollback: false, empty: false });

    await expect(ensureFloatCeilingForTests(cursor.pool)).rejects.toThrow(/cursor walk failed/);

    const closeAt = cursor.statements.indexOf("CLOSE");
    const rollbackAt = cursor.statements.indexOf("ROLLBACK");
    expect(closeAt).toBeGreaterThan(cursor.statements.indexOf("FETCH"));
    expect(rollbackAt).toBeGreaterThan(closeAt);
    expect(cursor.statements).not.toContain("COMMIT");
    expect(cursor.releaseCount()).toBe(1);
    expect(cursor.releaseError()).toBeUndefined();
    expect(floatCeilingRowsForTests(SKIN)).toEqual([{ float: 0.2, price: 1000 }]);
  });

  it("releases the client with the rollback error when ROLLBACK fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    staleSeed();
    const cursor = cursorPool({ failOnFetch: 2, failRollback: true, empty: false });

    await expect(ensureFloatCeilingForTests(cursor.pool)).rejects.toThrow(/cursor walk failed/);

    expect(cursor.statements).toContain("CLOSE");
    expect(cursor.statements).toContain("ROLLBACK");
    expect(cursor.releaseCount()).toBe(1);
    expect(cursor.releaseError()?.message).toBe("rollback failed");
    expect(floatCeilingRowsForTests(SKIN)).toEqual([{ float: 0.2, price: 1000 }]);
  });

  it("keeps the old cache when the cursor returns no rows", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    staleSeed();
    const empty = cursorPool({ failOnFetch: null, failRollback: false, empty: true });

    await expect(ensureFloatCeilingForTests(empty.pool)).rejects.toThrow(/no rows/);
    expect(empty.statements).toContain("COMMIT");
    expect(empty.statements).not.toContain("ROLLBACK");
    expect(empty.releaseCount()).toBe(1);
    expect(empty.releaseError()).toBeUndefined();
    expect(floatCeilingRowsForTests(SKIN)).toEqual([{ float: 0.2, price: 1000 }]);
  });
});
