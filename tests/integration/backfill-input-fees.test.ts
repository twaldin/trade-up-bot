import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createTestApp, type TestContext } from "./setup.js";
import { storedInputCost } from "../../server/engine/fees.js";
import { applyListingPriceToInputs } from "../../server/engine/db-stats.js";
import { runInputFeeBackfill } from "../../scripts/backfill-input-fees.js";
import { seedFeeTradeUp, readInputPrices, readTradeUp } from "../helpers/input-fees.js";

describe("input-fee backfill", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestApp();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("dry-run (the default) reports stripped rows with before/after cost and ROI and writes nothing", async () => {
    const healthy = storedInputCost(1000, "csfloat");
    const stripped = await seedFeeTradeUp(ctx.pool, [
      { listingId: "bf-csf", source: "csfloat", raw: 1000, stored: 1000, float: 0.15 },
      { listingId: "bf-dm", source: "dmarket", raw: 800, stored: storedInputCost(800, "dmarket"), float: 0.16 },
    ]);
    const gone = await seedFeeTradeUp(ctx.pool, [
      { listingId: "bf-gone", source: "buff", raw: 500, stored: 500, float: 0.17 },
    ]);
    await ctx.pool.query("DELETE FROM listings WHERE id = 'bf-gone'");
    const theoretical = await seedFeeTradeUp(ctx.pool, [
      { listingId: "bf-theory", source: "csfloat", raw: 500, stored: 500, float: 0.18 },
    ]);
    await ctx.pool.query("UPDATE trade_ups SET is_theoretical = true WHERE id = $1", [theoretical]);
    const before = await readTradeUp(ctx.pool, stripped);

    const lines: string[] = [];
    const report = await runInputFeeBackfill(ctx.pool, { batchSize: 1, log: (l) => lines.push(l) });

    expect(report.dryRun).toBe(true);
    expect(report.tradeUpsAffected).toBe(1);
    expect(report.inputsAffected).toBe(1);
    expect(report.sample).toEqual([
      expect.objectContaining({
        trade_up_id: stripped,
        old_cost_cents: before.total_cost_cents,
        new_cost_cents: before.total_cost_cents + (healthy - 1000),
        old_roi: before.roi_percentage,
      }),
    ]);
    expect(report.sample[0].new_roi).toBeLessThan(report.sample[0].old_roi);
    expect(report.avgRoiDelta).toBeGreaterThan(0);
    expect(lines.join("\n")).toContain(`${stripped}  cost ${before.total_cost_cents} -> ${report.sample[0].new_cost_cents}`);
    expect((await readInputPrices(ctx.pool, stripped))["bf-csf"]).toBe(1000);
    expect((await readInputPrices(ctx.pool, gone))["bf-gone"]).toBe(500);
    expect((await readInputPrices(ctx.pool, theoretical))["bf-theory"]).toBe(500);
  });

  it("--apply heals stripped inputs, then a second dry-run is a no-op", async () => {
    const id = await seedFeeTradeUp(ctx.pool, [
      { listingId: "bf-apply-csf", source: "csfloat", raw: 1000, stored: 1000, float: 0.15 },
      { listingId: "bf-apply-buff", source: "buff", raw: 500, stored: 500, float: 0.16 },
    ]);
    const csvPath = path.join(os.tmpdir(), `backfill-input-fees-${process.pid}.csv`);
    fs.rmSync(csvPath, { force: true });

    const applied = await runInputFeeBackfill(ctx.pool, { dryRun: false, csvPath, log: () => undefined });
    expect(applied.dryRun).toBe(false);
    expect(applied.inputsAffected).toBe(2);
    expect(await readInputPrices(ctx.pool, id)).toEqual({
      "bf-apply-csf": storedInputCost(1000, "csfloat"),
      "bf-apply-buff": storedInputCost(500, "buff"),
    });
    expect(fs.readFileSync(csvPath, "utf8")).toContain("bf-apply-csf,1000,1058");

    const again = await runInputFeeBackfill(ctx.pool, { log: () => undefined });
    expect(again.tradeUpsAffected).toBe(0);
    expect(again.inputsAffected).toBe(0);
    expect(again.sample).toEqual([]);
    fs.rmSync(csvPath, { force: true });
  });

  it("applyListingPriceToInputs is a no-op when the stored cost already matches storedInputCost", async () => {
    const id = await seedFeeTradeUp(ctx.pool, [
      { listingId: "bf-noop", source: "csfloat", raw: 1000, stored: storedInputCost(1000, "csfloat"), float: 0.15 },
    ]);
    const before = await readTradeUp(ctx.pool, id);
    const res = await applyListingPriceToInputs(ctx.pool, "bf-noop", 1000);
    expect(res).toEqual({ inputsUpdated: 0, tradeUpsUpdated: 0 });
    expect(await readTradeUp(ctx.pool, id)).toEqual(before);
    expect((await readInputPrices(ctx.pool, id))["bf-noop"]).toBe(storedInputCost(1000, "csfloat"));
  });
});
