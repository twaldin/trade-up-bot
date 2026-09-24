import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestApp, type TestContext } from "./setup.js";
import { storedInputCost } from "../../server/engine/fees.js";
import { recalcTradeUpCosts } from "../../server/engine/db-stats.js";
import { applyListedResult, checkListingStaleness } from "../../server/sync/listings.js";
import {
  seedFeeTradeUp, readTradeUp, readInputPrices, readListing, expectConsistentCost, discoveryInputCost,
} from "../helpers/input-fees.js";

/**
 * Every non-Verify path that reprices trade_up_inputs from a listing price:
 *   - csfloat-checker "listed" branch (applyListedResult)
 *   - sync/listings checkListingStaleness (dormant, same branch)
 *   - daemon Phase 4b recalcTradeUpCosts
 * must store storedInputCost(raw, source), exactly like discovery.
 */

vi.mock("../../server/engine/pricing.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/engine/pricing.js")>();
  return {
    ...actual,
    lookupOutputPrice: async () => ({ priceCents: 50_000, marketplace: "csfloat", grossPrice: 51_000, feePct: 0.02 }),
  };
});

const FEE_CSF_1000 = storedInputCost(1000, "csfloat");
const FEE_DM_1000 = storedInputCost(1000, "dmarket");
const FEE_BUFF_1000 = storedInputCost(1000, "buff");

describe("input buyer fee on reprice paths", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestApp();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await ctx.cleanup();
  });

  /** Two trade-ups sharing one CSFloat listing (raw 1000), each with a DMarket and Buff input. */
  async function seedShared(sharedStored: number) {
    const a = await seedFeeTradeUp(ctx.pool, [
      { listingId: "shared-csf", source: "csfloat", raw: 1000, stored: sharedStored, float: 0.15 },
      { listingId: "dmarket:a", source: "dmarket", raw: 1000, stored: FEE_DM_1000, float: 0.16 },
      { listingId: "buff:a", source: "buff", raw: 1000, stored: FEE_BUFF_1000, float: 0.17 },
    ]);
    const b = await seedFeeTradeUp(ctx.pool, [
      { listingId: "shared-csf", source: "csfloat", raw: 1000, stored: sharedStored, float: 0.15 },
      { listingId: "dmarket:b", source: "dmarket", raw: 1000, stored: FEE_DM_1000, float: 0.18 },
      { listingId: "buff:b", source: "buff", raw: 1000, stored: FEE_BUFF_1000, float: 0.19 },
    ]);
    return { a, b };
  }

  // ─── csfloat-checker "listed" branch ──────────────────────────────────────

  describe("csfloat-checker applyListedResult", () => {
    it("price change 1000 → 1100 writes 1161 to every trade-up using the listing and recomputes totals", async () => {
      const { a, b } = await seedShared(FEE_CSF_1000);

      const res = await applyListedResult(ctx.pool, { id: "shared-csf", price_cents: 1000 }, { price: 1100 });

      expect(res.listingChanged).toBe(true);
      for (const id of [a, b]) {
        expect((await readInputPrices(ctx.pool, id))["shared-csf"]).toBe(1161);
        await expectConsistentCost(ctx.pool, id, 1161 + FEE_DM_1000 + FEE_BUFF_1000);
      }
      const l = await readListing(ctx.pool, "shared-csf");
      expect(l?.price_cents).toBe(1100);
      expect(l?.price_updated_at).not.toBeNull();
    });

    it("unchanged price writes nothing to inputs or trade-ups and does not bump price_updated_at", async () => {
      const { a } = await seedShared(FEE_CSF_1000);
      const before = await readTradeUp(ctx.pool, a);

      const res = await applyListedResult(ctx.pool, { id: "shared-csf", price_cents: 1000 }, { price: 1000 });

      expect(res).toEqual({ listingChanged: false, inputsUpdated: 0, tradeUpsUpdated: 0 });
      expect((await readInputPrices(ctx.pool, a))["shared-csf"]).toBe(FEE_CSF_1000);
      expect(await readTradeUp(ctx.pool, a)).toEqual(before);
      expect((await readListing(ctx.pool, "shared-csf"))?.price_updated_at).toBeNull();
    });

    it("stores exactly what discovery stores", async () => {
      const { a } = await seedShared(FEE_CSF_1000);
      await applyListedResult(ctx.pool, { id: "shared-csf", price_cents: 1000 }, { price: 2345 });
      expect((await readInputPrices(ctx.pool, a))["shared-csf"]).toBe(await discoveryInputCost(ctx.pool, 2345, "csfloat"));
    });
  });

  // ─── sync/listings checkListingStaleness ──────────────────────────────────

  describe("checkListingStaleness", () => {
    function stubCsfloat(prices: Record<string, number>) {
      const requested: string[] = [];
      vi.stubGlobal("fetch", async (url: string) => {
        const id = url.split("/listings/")[1];
        requested.push(id);
        if (!(id in prices)) return new Response("not found", { status: 404 });
        return new Response(JSON.stringify({ state: "listed", price: prices[id] }), { status: 200 });
      });
      return requested;
    }

    it("price change 1000 → 1100 writes 1161 and recomputes totals", async () => {
      const { a, b } = await seedShared(FEE_CSF_1000);
      stubCsfloat({ "shared-csf": 1100 });

      await checkListingStaleness(ctx.pool, { apiKey: "k", maxChecks: 50 });

      for (const id of [a, b]) {
        expect((await readInputPrices(ctx.pool, id))["shared-csf"]).toBe(1161);
        await expectConsistentCost(ctx.pool, id, 1161 + FEE_DM_1000 + FEE_BUFF_1000);
      }
      expect((await readInputPrices(ctx.pool, a))["shared-csf"]).toBe(await discoveryInputCost(ctx.pool, 1100, "csfloat"));
    });

    it("unchanged price writes nothing", async () => {
      const { a } = await seedShared(FEE_CSF_1000);
      stubCsfloat({ "shared-csf": 1000 });
      const before = await readTradeUp(ctx.pool, a);

      await checkListingStaleness(ctx.pool, { apiKey: "k", maxChecks: 50 });

      expect((await readInputPrices(ctx.pool, a))["shared-csf"]).toBe(FEE_CSF_1000);
      expect(await readTradeUp(ctx.pool, a)).toEqual(before);
      expect((await readListing(ctx.pool, "shared-csf"))?.price_updated_at).toBeNull();
    });

    it("only checks CSFloat listings — DMarket and Buff listings are never looked up on CSFloat or deleted", async () => {
      await seedShared(FEE_CSF_1000);
      const requested = stubCsfloat({ "shared-csf": 1000 });

      await checkListingStaleness(ctx.pool, { apiKey: "k", maxChecks: 50 });

      expect(requested).toEqual(["shared-csf"]);
      for (const lid of ["dmarket:a", "dmarket:b", "buff:a", "buff:b"]) {
        expect(await readListing(ctx.pool, lid)).toBeDefined();
      }
    });
  });

  // ─── daemon Phase 4b recalcTradeUpCosts ───────────────────────────────────

  describe("recalcTradeUpCosts (Phase 4b)", () => {
    const since = () => new Date(Date.now() - 60_000).toISOString();
    const flag = (ids: string[]) =>
      ctx.pool.query("UPDATE listings SET price_updated_at = NOW() WHERE id = ANY($1)", [ids]);

    it("(a) a flagged listing with an unchanged price and fee-inclusive inputs is a no-op", async () => {
      const { a, b } = await seedShared(FEE_CSF_1000);
      const before = [await readTradeUp(ctx.pool, a), await readTradeUp(ctx.pool, b)];
      // CSFloat sync re-upserts bump price_updated_at even when the price is the same.
      await flag(["shared-csf", "dmarket:a", "buff:a"]);

      const res = await recalcTradeUpCosts(ctx.pool, since());

      expect(res.updated).toBe(0);
      expect(await readInputPrices(ctx.pool, a)).toEqual({ "shared-csf": FEE_CSF_1000, "dmarket:a": FEE_DM_1000, "buff:a": FEE_BUFF_1000 });
      expect([await readTradeUp(ctx.pool, a), await readTradeUp(ctx.pool, b)]).toEqual(before);
      expect((await readListing(ctx.pool, "shared-csf"))?.price_updated_at).toBeNull();
    });

    it("(b) a flagged listing with a changed price writes the fee-inclusive price per marketplace", async () => {
      const { a, b } = await seedShared(FEE_CSF_1000);
      await ctx.pool.query("UPDATE listings SET price_cents = 1100 WHERE id = 'shared-csf'");
      await ctx.pool.query("UPDATE listings SET price_cents = 1200 WHERE id = 'dmarket:a'");
      await ctx.pool.query("UPDATE listings SET price_cents = 900 WHERE id = 'buff:a'");
      await flag(["shared-csf", "dmarket:a", "buff:a"]);

      const res = await recalcTradeUpCosts(ctx.pool, since());

      expect(res.updated).toBe(2);
      const dm = storedInputCost(1200, "dmarket");
      const buff = storedInputCost(900, "buff");
      expect(await readInputPrices(ctx.pool, a)).toEqual({ "shared-csf": 1161, "dmarket:a": dm, "buff:a": buff });
      await expectConsistentCost(ctx.pool, a, 1161 + dm + buff);
      await expectConsistentCost(ctx.pool, b, 1161 + FEE_DM_1000 + FEE_BUFF_1000);
      expect(await readInputPrices(ctx.pool, a)).toEqual({
        "shared-csf": await discoveryInputCost(ctx.pool, 1100, "csfloat"),
        "dmarket:a": await discoveryInputCost(ctx.pool, 1200, "dmarket"),
        "buff:a": await discoveryInputCost(ctx.pool, 900, "buff"),
      });
    });

    it("(c) stripped (raw) inputs on a flagged listing are corrected to the fee-inclusive price", async () => {
      const a = await seedFeeTradeUp(ctx.pool, [
        { listingId: "strip-csf", source: "csfloat", raw: 1000, stored: 1000, float: 0.15 },
        { listingId: "dmarket:strip", source: "dmarket", raw: 1000, stored: 1000, float: 0.16 },
        { listingId: "buff:strip", source: "buff", raw: 1000, stored: 1000, float: 0.17 },
      ]);
      const before = await readTradeUp(ctx.pool, a);
      await flag(["strip-csf", "dmarket:strip", "buff:strip"]);

      const res = await recalcTradeUpCosts(ctx.pool, since());

      expect(res.updated).toBe(1);
      expect(await readInputPrices(ctx.pool, a)).toEqual({ "strip-csf": 1058, "dmarket:strip": FEE_DM_1000, "buff:strip": FEE_BUFF_1000 });
      const after = await expectConsistentCost(ctx.pool, a, 1058 + FEE_DM_1000 + FEE_BUFF_1000);
      expect(after.roi_percentage).toBeLessThan(before.roi_percentage);
      expect(after.trade_up_score).toBeLessThan(before.trade_up_score);
    });

    it("skinport and calculator inputs carry no buyer fee and are never flagged as drift", async () => {
      const a = await seedFeeTradeUp(ctx.pool, [
        { listingId: "sp-1", source: "skinport", raw: 1000, stored: 1000, float: 0.15 },
        { listingId: "calc-1", source: "calculator", raw: 1000, stored: 1000, float: 0.16 },
      ]);
      const before = await readTradeUp(ctx.pool, a);
      await flag(["sp-1", "calc-1"]);

      expect((await recalcTradeUpCosts(ctx.pool, since())).updated).toBe(0);
      expect(await readTradeUp(ctx.pool, a)).toEqual(before);
    });
  });
});
