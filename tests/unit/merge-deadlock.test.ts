/**
 * Merge-update lock conflicts must retry, then leave the daemon looping
 * with that type's re-queue intact. Non-lock errors still reject.
 */

import fs from "fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { mergeTradeUps, skippedShareLockStats } from "../../server/engine/db-save.js";
import { mergeTaskTradeUps } from "../../server/daemon/merge-task.js";
import { makeTradeUp } from "../helpers/fixtures.js";

const LISTING_IDS = ["merge-lock-a", "merge-lock-b"];
const EXIST_ID = 42;

function pgError(code: string, message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

function emptyResult(rows: unknown[] = []): pg.QueryResult {
  return { rows, rowCount: rows.length, command: "", oid: 0, fields: [] };
}

interface ScriptedPool {
  pool: pg.Pool;
  statements: string[];
  types: string[];
  releases: number;
  discarded: number;
}

function scriptedPool(options: {
  onUpdate: () => void;
  onRollback?: () => void;
  onType?: (type: string) => void;
}): ScriptedPool {
  const statements: string[] = [];
  const types: string[] = [];
  const state = { releases: 0, discarded: 0 };
  const client = {
    async query(sql: string): Promise<pg.QueryResult> {
      statements.push(sql.trim());
      if (sql.includes("ROLLBACK")) options.onRollback?.();
      if (sql.includes("UPDATE trade_ups SET")) options.onUpdate();
      return emptyResult();
    },
    release(err?: Error | boolean): void {
      state.releases += 1;
      if (err instanceof Error) state.discarded += 1;
      statements.push(err instanceof Error ? "release:error" : "release");
    },
  };
  const pool = {
    async query(sql: string, params?: unknown[]): Promise<pg.QueryResult> {
      statements.push(sql.trim());
      if (sql.includes("STRING_AGG")) {
        const tradeUpType = String(params?.[0] ?? "");
        types.push(tradeUpType);
        options.onType?.(tradeUpType);
        return emptyResult([{ id: EXIST_ID, ids: [...LISTING_IDS].sort().join(",") }]);
      }
      if (sql.includes("profit_streak")) {
        return emptyResult([{ id: EXIST_ID, profit_cents: 0, profit_streak: 0 }]);
      }
      return emptyResult();
    },
    async connect(): Promise<pg.PoolClient> {
      statements.push("connect");
      return client as pg.PoolClient;
    },
  };
  return {
    pool: pool as pg.Pool,
    statements,
    types,
    get releases() { return state.releases; },
    get discarded() { return state.discarded; },
  };
}

function updateTradeUp(): ReturnType<typeof makeTradeUp> {
  return makeTradeUp({
    listingIds: LISTING_IDS,
    profit_cents: 0,
    total_cost_cents: 1000,
    expected_value_cents: 1000,
    roi_percentage: 0,
  });
}

function clientStatements(statements: readonly string[]): string[] {
  return statements.filter(sql =>
    sql === "connect" ||
    sql === "BEGIN" ||
    sql === "ROLLBACK" ||
    sql === "COMMIT" ||
    sql === "release" ||
    sql === "release:error" ||
    sql.includes("UPDATE trade_ups SET"),
  );
}

const touchedTypes = new Set<string>();

async function drain(type: string): Promise<void> {
  const { pool } = scriptedPool({ onUpdate() {} });
  await mergeTradeUps(pool, [], type);
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const type of touchedTypes) await drain(type);
  touchedTypes.clear();
});

describe("merge-update lock retry", () => {
  it.each(["40P01", "55P03"])(
    "rolls the transaction back and retries %s, then commits",
    async (code) => {
      const type = `merge_p0_${code}_ok`;
      touchedTypes.add(type);
      let updates = 0;
      const { pool, statements } = scriptedPool({
        onUpdate() {
          updates += 1;
          if (updates === 1) throw pgError(code, code === "40P01" ? "deadlock detected" : "canceling statement due to lock timeout");
        },
      });
      const warns: string[] = [];
      vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
        warns.push(args.map(arg => String(arg)).join(" "));
      });

      const before = skippedShareLockStats().queuedTradeUps;
      await mergeTradeUps(pool, [updateTradeUp()], type);

      expect(updates).toBe(2);
      expect(warns.some(line => line.includes(`${code}, retry 1 in 50ms`))).toBe(true);
      const txn = clientStatements(statements);
      const rollbackAt = txn.indexOf("ROLLBACK");
      const releaseAt = txn.indexOf("release");
      const secondBegin = txn.indexOf("BEGIN", rollbackAt + 1);
      expect(rollbackAt).toBeGreaterThan(txn.indexOf("BEGIN"));
      expect(releaseAt).toBeGreaterThan(rollbackAt);
      expect(secondBegin).toBeGreaterThan(releaseAt);
      expect(txn.at(-2)).toBe("COMMIT");
      expect(skippedShareLockStats().queuedTradeUps).toBe(before);
    },
  );

  it("discards the client when rollback fails and still retries the deadlock", async () => {
    const type = "merge_p0_rollback_fail";
    touchedTypes.add(type);
    let updates = 0;
    let rollbacks = 0;
    const script = scriptedPool({
      onUpdate() {
        updates += 1;
        if (updates === 1) throw pgError("40P01", "deadlock detected");
      },
      onRollback() {
        rollbacks += 1;
        if (rollbacks === 1) throw new Error("rollback failed");
      },
    });
    const { pool, statements } = script;
    const warns: string[] = [];
    const errors: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      warns.push(args.map(arg => String(arg)).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(arg => String(arg)).join(" "));
    });

    await mergeTradeUps(pool, [updateTradeUp()], type);

    expect(updates).toBe(2);
    expect(script.discarded).toBe(1);
    expect(statements).toContain("release:error");
    expect(warns.some(line => line.includes("40P01, retry 1 in 50ms"))).toBe(true);
    expect(errors.some(line => line.includes("rollback failed"))).toBe(true);
  });

  it("stops after the capped backoff when a deadlock keeps recurring, and the next cycle applies the re-queue", async () => {
    const type = "merge_p0_exhausted";
    const other = "merge_p0_exhausted_other";
    touchedTypes.add(type);
    touchedTypes.add(other);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    let updates = 0;
    const seen: string[] = [];
    const { pool, statements } = scriptedPool({
      onType(tradeUpType) {
        seen.push(tradeUpType);
      },
      onUpdate() {
        const current = seen.at(-1);
        if (current === type) {
          updates += 1;
          throw pgError("40P01", "deadlock detected");
        }
      },
    });
    const warns: string[] = [];
    const errors: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      warns.push(args.map(arg => String(arg)).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(arg => String(arg)).join(" "));
    });

    const before = skippedShareLockStats().queuedTradeUps;
    const started = Date.now();
    const tu = updateTradeUp();
    const finished: string[] = [];
    for (const task of [
      { taskName: "knife", tradeUpType: type, tradeUps: [tu] },
      { taskName: "classified", tradeUpType: other, tradeUps: [tu] },
    ]) {
      const merged = await mergeTaskTradeUps(pool, task.taskName, task.tradeUps, task.tradeUpType);
      finished.push(`${task.taskName}:${merged}`);
    }

    expect(finished).toEqual(["knife:true", "classified:true"]);
    expect(seen).toEqual([type, other]);
    expect(updates).toBe(4);
    expect(Date.now() - started).toBeGreaterThanOrEqual(300);
    expect(warns.map(line => line.match(/retry \d+ in \d+ms/)?.[0])).toEqual([
      "retry 1 in 50ms",
      "retry 2 in 100ms",
      "retry 3 in 200ms",
    ]);
    expect(errors.some(line => line.includes("40P01 after 3 retries"))).toBe(true);
    expect(errors.some(line => line.includes("re-queued 1 trade-ups"))).toBe(true);
    expect(skippedShareLockStats().queuedTradeUps).toBe(before + 1);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(clientStatements(statements).filter(sql => sql === "COMMIT").length).toBe(1);

    const next = scriptedPool({ onUpdate() {} });
    await mergeTradeUps(next.pool, [], type);
    expect(skippedShareLockStats().queuedTradeUps).toBe(before);
    expect(clientStatements(next.statements).filter(sql => sql.includes("UPDATE trade_ups SET"))).toHaveLength(1);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("still rejects a non-transient error on the first attempt and keeps the re-queue", async () => {
    const type = "merge_p0_syntax";
    const other = "merge_p0_syntax_other";
    touchedTypes.add(type);
    touchedTypes.add(other);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    let seedUpdates = 0;
    const seeder = scriptedPool({
      onUpdate() {
        seedUpdates += 1;
        throw pgError("40P01", "deadlock detected");
      },
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const before = skippedShareLockStats().queuedTradeUps;
    await mergeTradeUps(seeder.pool, [updateTradeUp()], type);
    expect(seedUpdates).toBe(4);
    expect(skippedShareLockStats().queuedTradeUps).toBe(before + 1);

    let updates = 0;
    const failing = scriptedPool({
      onUpdate() {
        updates += 1;
        throw pgError("42601", "syntax error");
      },
    });
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(arg => String(arg)).join(" "));
    });

    await expect(mergeTradeUps(failing.pool, [], type)).rejects.toThrow("syntax error");
    expect(updates).toBe(1);
    expect(skippedShareLockStats().queuedTradeUps).toBe(before + 1);

    const seen: string[] = [];
    const loopPool = scriptedPool({
      onType(tradeUpType) {
        seen.push(tradeUpType);
      },
      onUpdate() {
        if (seen.at(-1) === type) throw pgError("42601", "syntax error");
      },
    });
    const knifeOk = await mergeTaskTradeUps(loopPool.pool, "knife", [], type);
    const classifiedOk = await mergeTaskTradeUps(loopPool.pool, "classified", [updateTradeUp()], other);
    expect(knifeOk).toBe(false);
    expect(classifiedOk).toBe(true);
    expect(seen).toEqual([type, other]);
    expect(errors.some(line => line.includes("knife merge failed") && line.includes("syntax error"))).toBe(true);
    expect(skippedShareLockStats().queuedTradeUps).toBe(before + 1);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("wires the daemon super-batch to continue after a failed merge", () => {
    const src = fs.readFileSync(new URL("../../server/daemon/index.ts", import.meta.url), "utf8");
    expect(src).toContain("const merged = await mergeTaskTradeUps(pool, taskName, tradeUps, tradeUpType);");
    expect(src).toContain("if (!merged) continue;");
  });
});
