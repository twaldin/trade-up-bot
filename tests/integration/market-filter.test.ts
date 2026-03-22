import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestApp, type TestContext } from "./setup.js";
import { saveTradeUps, mergeTradeUps } from "../../server/engine/db-save.js";
import type { TradeUp, TradeUpInput, TradeUpOutcome } from "../../shared/types.js";

function makeMarketTradeUp(sources: string[]): TradeUp {
  const inputs: TradeUpInput[] = sources.map((source, i) => ({
    listing_id: `test-${source}-${Date.now()}-${Math.random().toString(36).slice(2)}-${i}`,
    skin_id: "skin-classified-1",
    skin_name: "AK-47 | Test Skin",
    collection_name: "Test Collection Alpha",
    price_cents: 1000,
    float_value: 0.15,
    condition: "Field-Tested" as const,
    source,
  }));
  const outcomes: TradeUpOutcome[] = [{
    skin_id: "skin-covert-1", skin_name: "AK-47 | Fire Serpent",
    collection_name: "Test Collection Alpha", probability: 1.0,
    predicted_float: 0.15, predicted_condition: "Field-Tested" as const,
    estimated_price_cents: 15000,
  }];
  return {
    id: 0, inputs, outcomes, total_cost_cents: 10000,
    expected_value_cents: 15000, profit_cents: 5000,
    roi_percentage: 50, created_at: new Date().toISOString(),
  };
}

describe("market filter", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("trade_ups table has input_sources column", async () => {
    const { rows } = await ctx.pool.query(`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'trade_ups'
        AND column_name = 'input_sources'
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].data_type).toBe("ARRAY");
  });

  it("input_sources defaults to empty array", async () => {
    const { rows } = await ctx.pool.query(`
      INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, type, outcomes_json)
      VALUES (1000, 1500, 500, 50.0, 'classified_covert', '[]')
      RETURNING input_sources
    `);
    expect(rows[0].input_sources).toEqual([]);
  });

  describe("input_sources consistency", () => {
    it("saveTradeUps sets input_sources from input sources", async () => {
      const tu = makeMarketTradeUp(["csfloat", "csfloat", "dmarket"]);
      for (const inp of tu.inputs) {
        await ctx.pool.query(
          "INSERT INTO listings (id, skin_id, price_cents, float_value, source) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING",
          [inp.listing_id, inp.skin_id, inp.price_cents, inp.float_value, inp.source]
        );
      }
      await saveTradeUps(ctx.pool, [tu], false, "classified_covert", false, "discovery");

      const { rows } = await ctx.pool.query(
        "SELECT input_sources FROM trade_ups ORDER BY id DESC LIMIT 1"
      );
      expect(rows[0].input_sources.sort()).toEqual(["csfloat", "dmarket"]);
    });

    it("saveTradeUps sets input_sources for single-market trade-up", async () => {
      const tu = makeMarketTradeUp(["dmarket", "dmarket", "dmarket"]);
      for (const inp of tu.inputs) {
        await ctx.pool.query(
          "INSERT INTO listings (id, skin_id, price_cents, float_value, source) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING",
          [inp.listing_id, inp.skin_id, inp.price_cents, inp.float_value, inp.source]
        );
      }
      await saveTradeUps(ctx.pool, [tu], false, "classified_covert", false, "discovery");

      const { rows } = await ctx.pool.query(
        "SELECT input_sources FROM trade_ups ORDER BY id DESC LIMIT 1"
      );
      expect(rows[0].input_sources).toEqual(["dmarket"]);
    });

    it("mergeTradeUps sets input_sources on insert", async () => {
      const tu = makeMarketTradeUp(["dmarket", "csfloat"]);
      for (const inp of tu.inputs) {
        await ctx.pool.query(
          "INSERT INTO listings (id, skin_id, price_cents, float_value, source) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING",
          [inp.listing_id, inp.skin_id, inp.price_cents, inp.float_value, inp.source]
        );
      }
      await mergeTradeUps(ctx.pool, [tu], "classified_covert");

      const { rows } = await ctx.pool.query(
        "SELECT input_sources FROM trade_ups ORDER BY id DESC LIMIT 1"
      );
      expect(rows[0].input_sources.sort()).toEqual(["csfloat", "dmarket"]);
    });
  });
});
