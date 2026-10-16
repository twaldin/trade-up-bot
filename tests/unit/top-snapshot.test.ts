import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  INSERT_TOP_SNAPSHOT_SQL,
  PURGE_TOP_SNAPSHOT_SQL,
  TOP_SNAPSHOT_LIMIT,
  TOP_SNAPSHOT_LOCK_TIMEOUT,
  TOP_SNAPSHOT_STATEMENT_TIMEOUT,
  isTopSnapshotGiveUp,
  localTimeoutStatements,
} from "../../server/top-snapshot.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("top snapshot SQL", () => {
  it("copies at most 1000 active rows in score order with a plain read", () => {
    expect(TOP_SNAPSHOT_LIMIT).toBe(1000);
    expect(INSERT_TOP_SNAPSHOT_SQL).toMatch(/LIMIT 1000/);
    expect(INSERT_TOP_SNAPSHOT_SQL).toMatch(/listing_status = 'active'/);
    expect(INSERT_TOP_SNAPSHOT_SQL).toMatch(/is_theoretical = false/);
    expect(INSERT_TOP_SNAPSHOT_SQL).toMatch(
      /ORDER BY t\.trade_up_score DESC NULLS LAST, t\.id DESC/,
    );
    expect(INSERT_TOP_SNAPSHOT_SQL).not.toMatch(/for\s+update/i);
    expect(INSERT_TOP_SNAPSHOT_SQL).not.toMatch(/lock\s+table/i);
  });

  it("stamps the UTC day and skips a second insert of the same trade-up", () => {
    expect(INSERT_TOP_SNAPSHOT_SQL).toMatch(/date_trunc\('day', now\(\)\)/);
    expect(INSERT_TOP_SNAPSHOT_SQL).toMatch(
      /ON CONFLICT \(snapshot_at, trade_up_id\) DO NOTHING/,
    );
    expect(INSERT_TOP_SNAPSHOT_SQL).not.toMatch(/SELECT\s+NOW\(\)/i);
  });

  it("describes a full scan of the raw top 1000", () => {
    const src = readFileSync(path.join(root, "server/top-snapshot.ts"), "utf8");
    expect(src).not.toMatch(/idx_tu_active_score/);
    expect(src).toMatch(/full scan/);
    expect(src).toMatch(/41 ms/);
    expect(src).toMatch(
      /The snapshot is the raw top 1000 by score, without the board's spread across collection combos\./,
    );
  });

  it("deletes rows older than 14 days in a bounded index range", () => {
    expect(PURGE_TOP_SNAPSHOT_SQL).toMatch(/snapshot_at < NOW\(\) - INTERVAL '14 days'/);
    expect(PURGE_TOP_SNAPSHOT_SQL).toMatch(/LIMIT \$1::int/);
    expect(PURGE_TOP_SNAPSHOT_SQL).not.toMatch(/EXTRACT\s*\(/i);
  });

  it("sets statement_timeout and lock_timeout for the local transaction", () => {
    expect(localTimeoutStatements(TOP_SNAPSHOT_STATEMENT_TIMEOUT, TOP_SNAPSHOT_LOCK_TIMEOUT))
      .toBe("SET LOCAL statement_timeout = '10s'; SET LOCAL lock_timeout = '2s'");
  });

  it("treats statement and lock timeouts as a give-up", () => {
    expect(isTopSnapshotGiveUp({ code: "57014" })).toBe(true);
    expect(isTopSnapshotGiveUp({ code: "55P03" })).toBe(true);
    expect(isTopSnapshotGiveUp({ code: "23505" })).toBe(false);
    expect(isTopSnapshotGiveUp(new Error("nope"))).toBe(false);
  });
});

describe("top snapshot schedule", () => {
  it("has exactly one cron entry", () => {
    const text = readFileSync(path.join(root, "scripts/trade-up-top-snapshot.cron"), "utf8");
    const entries = text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith("#"));
    expect(entries).toEqual([
      "15 4 * * * cd /opt/trade-up-bot && npx --no-install tsx scripts/snapshot-top-trade-ups.ts",
    ]);
  });
});
