import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createTestApp, type TestContext } from "./setup.js";
import { storedInputCost } from "../../server/engine/fees.js";
import { applyListingPriceToInputs } from "../../server/engine/db-stats.js";
import { projectedScore, runInputFeeBackfill, withReadOnlySession } from "../../scripts/backfill-input-fees.js";
import { recalcTradeUpCosts } from "../../server/engine/db-stats.js";
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
    const csv = fs.readFileSync(csvPath, "utf8");
    expect(csv.split("\n")[0]).toBe("status,trade_up_id,listing_id,old_price,new_price,old_source,new_source");
    expect(csv).toContain(`committed,${id},bf-apply-csf,1000,1058,csfloat,csfloat`);
    expect(csv).not.toMatch(/^pending,/m);
    const { rows: sources } = await ctx.pool.query("SELECT input_sources FROM trade_ups WHERE id = $1", [id]);
    expect(sources[0].input_sources).toEqual(["buff", "csfloat"]);

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
    expect(res).toEqual({ inputsUpdated: 0, tradeUpsUpdated: 0, tradeUpsFlagged: 0 });
    expect(await readTradeUp(ctx.pool, id)).toEqual(before);
    expect((await readInputPrices(ctx.pool, id))["bf-noop"]).toBe(storedInputCost(1000, "csfloat"));
  });

  it("projectedScore matches the compute_trade_up_score() trigger", async () => {
    const cost = 1000;
    const profit = 500;
    const chance = 0.5;
    const worst = -200;
    const { rows } = await ctx.pool.query(
      `INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage,
         chance_to_profit, worst_case_cents, type, listing_status, is_theoretical, outcomes_json)
       VALUES ($1, $2, $3, 0, $4, $5, 'classified_covert', 'active', false, '[]')
       RETURNING trade_up_score`,
      [cost, cost + profit, profit, chance, worst]
    );
    expect(rows[0].trade_up_score).toBe(projectedScore(cost, profit, chance, worst));
    expect(rows[0].trade_up_score).toBe(208);
  });

  it("counts a stored-total projection that disagrees with the input sum", async () => {
    const id = await seedFeeTradeUp(ctx.pool, [
      { listingId: "bf-mismatch", source: "csfloat", raw: 1000, stored: 1000, float: 0.15 },
    ]);
    await ctx.pool.query("UPDATE trade_ups SET total_cost_cents = total_cost_cents - 50 WHERE id = $1", [id]);
    const report = await runInputFeeBackfill(ctx.pool, { log: () => undefined });
    expect(report.projectionMismatches).toBe(1);
    expect(report.sample[0].new_cost_cents).toBe(storedInputCost(1000, "csfloat"));
  });

  it("builds the first page with the diversity cap and reports join/leave", async () => {
    const ids: number[] = [];
    for (let i = 0; i < 21; i++) {
      ids.push(await seedFeeTradeUp(ctx.pool, [
        { listingId: `bf-div-a-${i}`, source: "skinport", raw: 500, stored: 500, float: 0.15 },
      ]));
    }
    const other = await seedFeeTradeUp(ctx.pool, [
      { listingId: "bf-div-b", source: "skinport", raw: 500, stored: 500, float: 0.16 },
    ]);
    await ctx.pool.query("UPDATE trade_ups SET collection_names = ARRAY['Combo A'] WHERE id = ANY($1::int[])", [ids]);
    await ctx.pool.query("UPDATE trade_ups SET collection_names = ARRAY['Combo B'] WHERE id = $1", [other]);

    const report = await runInputFeeBackfill(ctx.pool, {
      firstPageIds: [ids[0], 999999],
      log: () => undefined,
    });
    expect(report.inputsAffected).toBe(0);
    expect(report.firstPageLeave).toContain(999999);
    expect(report.firstPageJoin.length).toBeGreaterThan(0);

    const site = await runInputFeeBackfill(ctx.pool, { log: () => undefined });
    expect(site.firstPageSize).toBe(21);
    expect(site.firstPageLeave).not.toContain(ids[0]);
  });

  it("uses the listing source when the stored input source is the csfloat default", async () => {
    const id = await seedFeeTradeUp(ctx.pool, [
      { listingId: "bf-src", source: "csfloat", raw: 500, stored: 500, float: 0.15 },
    ]);
    await ctx.pool.query("UPDATE listings SET source = 'dmarket' WHERE id = 'bf-src'");
    const report = await runInputFeeBackfill(ctx.pool, { log: () => undefined });
    expect(report.sourceMismatches).toBe(1);
    expect(report.sourceMismatchTradeUps).toBe(1);
    expect(report.sourceFixInputs).toBe(1);
    expect(report.sourceFixTradeUps).toBe(1);
    expect(report.perMarketplace).toEqual({ dmarket: 1 });
    expect(report.sample[0].new_cost_cents).toBe(storedInputCost(500, "dmarket"));
    expect(report.sample[0].new_cost_cents).not.toBe(storedInputCost(500, "csfloat"));
    expect((await readInputPrices(ctx.pool, id))["bf-src"]).toBe(500);
  });

  it("the revert CSV lists only rows whose UPDATE changed one row", async () => {
    await seedFeeTradeUp(ctx.pool, [
      { listingId: "bf-csv-keep", source: "csfloat", raw: 1000, stored: 1000, float: 0.15 },
    ]);
    await seedFeeTradeUp(ctx.pool, [
      { listingId: "bf-csv-skip", source: "buff", raw: 500, stored: 500, float: 0.16 },
    ]);
    await ctx.pool.query(`
      CREATE OR REPLACE FUNCTION bf_skip_second() RETURNS trigger AS $$
      BEGIN
        IF NEW.listing_id = 'bf-csv-keep' THEN
          UPDATE trade_up_inputs SET price_cents = 1 WHERE listing_id = 'bf-csv-skip' AND price_cents = 500;
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await ctx.pool.query(`
      CREATE TRIGGER bf_skip_second BEFORE UPDATE ON trade_up_inputs
      FOR EACH ROW EXECUTE FUNCTION bf_skip_second()`);
    const csvPath = path.join(os.tmpdir(), `backfill-csv-rowcount-${process.pid}.csv`);
    fs.rmSync(csvPath, { force: true });
    let pending = "";
    await runInputFeeBackfill(ctx.pool, {
      dryRun: false,
      csvPath,
      log: () => undefined,
      beforeCommit: () => { pending = fs.readFileSync(csvPath, "utf8"); },
    });
    expect(pending).toContain("pending,");
    expect(pending).toContain(",bf-csv-keep,1000,1058,csfloat,csfloat");
    const csv = fs.readFileSync(csvPath, "utf8");
    expect(csv).toContain(",bf-csv-keep,1000,1058,csfloat,csfloat");
    expect(csv).toMatch(/^committed,/m);
    expect(csv).not.toContain("bf-csv-skip");
    expect(csv).not.toMatch(/^pending,/m);
    fs.rmSync(csvPath, { force: true });
  });

  it("a backfill then Phase 4b on the same row changes nothing", async () => {
    const id = await seedFeeTradeUp(ctx.pool, [
      { listingId: "bf-then-4b", source: "csfloat", raw: 500, stored: 500, float: 0.15 },
    ]);
    await ctx.pool.query("UPDATE listings SET source = 'dmarket' WHERE id = 'bf-then-4b'");
    const csvPath = path.join(os.tmpdir(), `backfill-src-${process.pid}.csv`);
    fs.rmSync(csvPath, { force: true });
    await runInputFeeBackfill(ctx.pool, { dryRun: false, csvPath, log: () => undefined });
    expect(fs.readFileSync(csvPath, "utf8")).toContain(`committed,${id},bf-then-4b,500,${storedInputCost(500, "dmarket")},csfloat,dmarket`);
    const { rows: sources } = await ctx.pool.query("SELECT source FROM trade_up_inputs WHERE listing_id = 'bf-then-4b'");
    expect(sources[0].source).toBe("dmarket");
    const { rows: tuSources } = await ctx.pool.query("SELECT input_sources FROM trade_ups WHERE id = $1", [id]);
    expect(tuSources[0].input_sources).toEqual(["dmarket"]);
    fs.rmSync(csvPath, { force: true });
    const after = await readTradeUp(ctx.pool, id);
    expect((await readInputPrices(ctx.pool, id))["bf-then-4b"]).toBe(storedInputCost(500, "dmarket"));

    await ctx.pool.query("UPDATE listings SET price_updated_at = NOW() WHERE id = 'bf-then-4b'");
    const recalc = await recalcTradeUpCosts(ctx.pool, new Date(Date.now() - 60_000).toISOString());
    expect(recalc.updated).toBe(0);
    expect(await readTradeUp(ctx.pool, id)).toEqual(after);
    expect((await readInputPrices(ctx.pool, id))["bf-then-4b"]).toBe(storedInputCost(500, "dmarket"));
  });

  it("joins and leaves are empty when nothing changes", async () => {
    await seedFeeTradeUp(ctx.pool, [
      { listingId: "bf-stable", source: "csfloat", raw: 500, stored: storedInputCost(500, "csfloat"), float: 0.15 },
    ]);
    const report = await runInputFeeBackfill(ctx.pool, { log: () => undefined });
    expect(report.inputsAffected).toBe(0);
    expect(report.firstPageLeave).toEqual([]);
    expect(report.firstPageJoin).toEqual([]);
  });

  it("a dry-run session cannot write", async () => {
    await withReadOnlySession(ctx.pool, async (db) => {
      const { rows } = await db.query("SHOW default_transaction_read_only");
      expect(rows[0].default_transaction_read_only).toBe("on");
      const timeout = await db.query("SHOW statement_timeout");
      expect(timeout.rows[0].statement_timeout).toBe("30s");
      await expect(db.query("INSERT INTO sync_meta (key, value) VALUES ('x', 'y')")).rejects.toThrow(/read-only/);
    });
    await ctx.pool.query("INSERT INTO sync_meta (key, value) VALUES ('backfill-rw', '1')");
  });

  it("tier free still corrects a trade-up created inside the public delay", async () => {
    const id = await seedFeeTradeUp(ctx.pool, [
      { listingId: "bf-fresh", source: "csfloat", raw: 1000, stored: 1000, float: 0.15 },
    ]);
    const report = await runInputFeeBackfill(ctx.pool, { tier: "free", log: () => undefined });
    expect(report.inputsAffected).toBe(1);
    expect(report.sample[0].trade_up_id).toBe(id);
  });

  it("raw M1 before is the pre-write pro-board snapshot", async () => {
    const id = await seedFeeTradeUp(ctx.pool, [
      { listingId: "bf-m1", source: "csfloat", raw: 1000, stored: 1000, float: 0.15 },
    ]);
    const before = await readTradeUp(ctx.pool, id);
    const lines: string[] = [];
    const report = await runInputFeeBackfill(ctx.pool, { dryRun: false, log: (l) => lines.push(l) });
    expect(report.m1RawBefore).toBe(before.trade_up_score);
    expect(report.m1RawAfter).not.toBe(report.m1RawBefore);
    expect(lines.join("\n")).not.toContain("differs from SQL");
    expect(lines.join("\n")).toContain("M1 raw (pro board");
  });

  it("keeps CSV rows pending when COMMIT throws", async () => {
    const id = await seedFeeTradeUp(ctx.pool, [
      { listingId: "bf-commit", source: "csfloat", raw: 1000, stored: 1000, float: 0.15 },
    ]);
    await ctx.pool.query(`
      CREATE FUNCTION bf_fail_commit() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'commit failed';
      END $$ LANGUAGE plpgsql`);
    await ctx.pool.query(`
      CREATE CONSTRAINT TRIGGER bf_fail_commit
      AFTER UPDATE ON trade_up_inputs
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION bf_fail_commit()`);
    const csvPath = path.join(os.tmpdir(), `backfill-commit-${process.pid}.csv`);
    fs.rmSync(csvPath, { force: true });
    await expect(runInputFeeBackfill(ctx.pool, { dryRun: false, csvPath, pauseMs: 0, log: () => undefined }))
      .rejects.toThrow(/commit failed/);
    const csv = fs.readFileSync(csvPath, "utf8");
    expect(csv).toMatch(/^pending,/m);
    expect(csv).not.toMatch(/^committed,/m);
    expect((await readInputPrices(ctx.pool, id))["bf-commit"]).toBe(1000);
    fs.rmSync(csvPath, { force: true });
  });

  it("retries a batch when the first UPDATE raises 55P03", async () => {
    const id = await seedFeeTradeUp(ctx.pool, [
      { listingId: "bf-lock", source: "csfloat", raw: 1000, stored: 1000, float: 0.15 },
    ]);
    await ctx.pool.query("CREATE SEQUENCE bf_retry_seq");
    await ctx.pool.query(`
      CREATE FUNCTION bf_lock_once() RETURNS trigger AS $$
      BEGIN
        IF nextval('bf_retry_seq') = 1 THEN
          RAISE EXCEPTION 'lock timeout' USING ERRCODE = '55P03';
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await ctx.pool.query(`
      CREATE TRIGGER bf_lock_once BEFORE UPDATE ON trade_up_inputs
      FOR EACH ROW EXECUTE FUNCTION bf_lock_once()`);
    const report = await runInputFeeBackfill(ctx.pool, { dryRun: false, pauseMs: 0, log: () => undefined });
    const { rows } = await ctx.pool.query("SELECT last_value FROM bf_retry_seq");
    expect(Number(rows[0].last_value)).toBeGreaterThanOrEqual(2);
    expect(report.inputsAffected).toBe(1);
    expect((await readInputPrices(ctx.pool, id))["bf-lock"]).toBe(storedInputCost(1000, "csfloat"));
  });
});
