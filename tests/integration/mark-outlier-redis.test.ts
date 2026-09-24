import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createTestApp, type TestContext } from "./setup.js";
import { runMarkOutlierStale } from "../../scripts/mark-outlier-stale.js";

const flushed = vi.hoisted(() => ({ prefixes: [] as string[] }));

vi.mock("../../server/redis.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/redis.js")>();
  return {
    ...actual,
    redisConnected: async () => undefined,
    cacheInvalidatePrefix: async (prefix: string) => {
      flushed.prefixes.push(prefix);
      return 0;
    },
  };
});

describe("mark-outlier-stale redis flush", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    flushed.prefixes.length = 0;
    ctx = await createTestApp();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("apply mode flushes tu: after the run, and dry-run does not", async () => {
    await ctx.pool.query(
      `INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, type, listing_status)
       VALUES (100000, 100, -99900, -99, 'classified_covert', 'active')`,
    );
    const csvPath = path.join(os.tmpdir(), `mark-outlier-redis-${process.pid}.csv`);

    await runMarkOutlierStale(ctx.pool, { dryRun: true, pauseMs: 0, log: () => undefined });
    expect(flushed.prefixes).toEqual([]);

    await runMarkOutlierStale(ctx.pool, { dryRun: false, csvPath, pauseMs: 0, log: () => undefined });
    expect(flushed.prefixes).toEqual(["tu:"]);
    fs.unlinkSync(csvPath);
  });
});
