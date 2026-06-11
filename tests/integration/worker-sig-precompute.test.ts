/**
 * Integration test for plan 019: worker signature precompute.
 *
 * Seeds trade-ups into the test DB, runs the same query the daemon uses to
 * build the sig file, writes it, loads it back via loadSigsFromFile, and
 * asserts the TradeUpStore recognises seeded sigs and blocks rediscovery.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createTestApp, seedTestData, type TestContext } from "./setup.js";
import { TradeUpStore } from "../../server/engine/store.js";
import { parseSig } from "../../server/engine/utils.js";
import { writeSignatureFile, loadSigsFromFile } from "../../server/daemon/sig-file.js";
import { makeTradeUp } from "../helpers/fixtures.js";

const tmpFile = join(tmpdir(), `worker-sig-integration-${process.pid}.txt`);

describe("worker sig precompute — integration", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestApp();
    await seedTestData(ctx.pool, {
      profitableCount: 2,
      unprofitableCount: 1,
      staleCount: 0,
      type: "classified_covert",
    });
  });

  afterEach(async () => {
    await ctx.cleanup();
    if (existsSync(tmpFile)) unlinkSync(tmpFile);
  });

  it("generates sig file from DB and TradeUpStore blocks seeded sigs", async () => {
    // Run the same query the daemon uses to build taskSigFile
    const { rows } = await ctx.pool.query(`
      SELECT STRING_AGG(tui.listing_id::text, ',') as ids
      FROM trade_ups t
      JOIN trade_up_inputs tui ON tui.trade_up_id = t.id
      WHERE t.type = $1 AND t.is_theoretical = false
      GROUP BY t.id
    `, ["classified_covert"]);

    expect(rows.length).toBeGreaterThan(0);

    const sigs = new Set<string>();
    for (const row of rows) {
      sigs.add(parseSig(row.ids));
    }

    // Write and reload
    await writeSignatureFile(tmpFile, sigs);
    const loaded = await loadSigsFromFile(tmpFile);

    expect(loaded.size).toBe(sigs.size);

    // Seed a TradeUpStore with the loaded sigs — it must block any re-add
    const store = new TradeUpStore(20, loaded);

    // Reconstruct a trade-up whose listing IDs match a known sig
    // The sig is sorted listing IDs joined by comma; extract one set of IDs
    const [knownSig] = [...loaded];
    const knownIds = knownSig.split(",");
    const tu = makeTradeUp({ listingIds: knownIds });

    expect(store.add(tu)).toBe(false);
    expect(store.total).toBe(0);
  });

  it("allows trade-ups with listing IDs not in the sig file", async () => {
    const { rows } = await ctx.pool.query(`
      SELECT STRING_AGG(tui.listing_id::text, ',') as ids
      FROM trade_ups t
      JOIN trade_up_inputs tui ON tui.trade_up_id = t.id
      WHERE t.type = $1 AND t.is_theoretical = false
      GROUP BY t.id
    `, ["classified_covert"]);

    const sigs = new Set<string>();
    for (const row of rows) {
      sigs.add(parseSig(row.ids));
    }

    await writeSignatureFile(tmpFile, sigs);
    const loaded = await loadSigsFromFile(tmpFile);

    const store = new TradeUpStore(20, loaded);
    // Brand new listing IDs not in DB
    const tu = makeTradeUp({ listingIds: ["brand-new-x", "brand-new-y", "brand-new-z", "brand-new-w", "brand-new-v"] });
    expect(store.add(tu)).toBe(true);
  });
});
