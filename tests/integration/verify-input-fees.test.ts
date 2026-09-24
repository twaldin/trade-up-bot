import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { createTestApp, type TestContext } from "./setup.js";
import { storedInputCost } from "../../server/engine/fees.js";
import {
  seedFeeTradeUp, readTradeUp, readInputPrices, readListing, expectConsistentCost, discoveryInputCost,
  type FeeInputSeed,
} from "../helpers/input-fees.js";

/**
 * Verify must compare marketplace raw vs listings raw, and stored input vs
 * storedInputCost(raw, source) — never raw vs fee-inclusive.
 */

const market = vi.hoisted(() => ({
  csfloat: new Map<string, number>(),
  dmarket: new Map<string, number>(),
  buff: new Map<string, { id: string; priceCents: number; floatValue: number }[]>(),
  invalidated: [] as string[],
}));

vi.mock("../../server/sync.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/sync.js")>();
  return {
    ...actual,
    isDMarketConfigured: () => true,
    fetchAllDMarketListings: async () =>
      [...market.dmarket].map(([id, price]) => ({ itemId: id.replace(/^dmarket:/, ""), price: { USD: String(price) } })),
  };
});

vi.mock("../../server/sync/buff.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/sync/buff.js")>();
  return {
    ...actual,
    fetchBuffListings: async (goodsId: number) => ({ items: market.buff.get(String(goodsId)) ?? [], totalPages: 1, totalCount: 0 }),
  };
});

vi.mock("../../server/redis.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/redis.js")>();
  return {
    ...actual,
    getRedis: () => ({ get: async () => "buff-cookie", incrby: async () => 0 }),
    cacheInvalidatePrefix: async (prefix: string) => { market.invalidated.push(prefix); return 0; },
  };
});

vi.mock("../../server/engine/pricing.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/engine/pricing.js")>();
  return {
    ...actual,
    lookupOutputPrice: async () => ({ priceCents: 50_000, marketplace: "csfloat", grossPrice: 51_000, feePct: 0.02 }),
  };
});

const CSF = "verify-fee-csf-1";
const DM = "dmarket:verify-fee-dm-1";
const BUFF = "buff:verify-fee-buff-1";
const BUFF_GOODS = "4242";
const BUFF_FLOAT = 0.2345678;

function seeds(stored: { csf: number; dm: number; buff: number }): FeeInputSeed[] {
  return [
    { listingId: CSF, source: "csfloat", raw: 1000, stored: stored.csf, float: 0.15 },
    { listingId: DM, source: "dmarket", raw: 1000, stored: stored.dm, float: 0.16 },
    { listingId: BUFF, source: "buff", raw: 1000, stored: stored.buff, float: BUFF_FLOAT, marketplaceId: BUFF_GOODS },
  ];
}

const FEE = { csf: storedInputCost(1000, "csfloat"), dm: storedInputCost(1000, "dmarket"), buff: storedInputCost(1000, "buff") };

function setMarket(prices: { csf: number; dm: number; buff: number }) {
  market.csfloat.set(CSF, prices.csf);
  market.dmarket.set(DM, prices.dm);
  market.buff.set(BUFF_GOODS, [{ id: "900001", priceCents: prices.buff, floatValue: BUFF_FLOAT }]);
}

async function verify(ctx: TestContext, id: number) {
  const res = await request(ctx.app).post(`/api/verify-trade-up/${id}`);
  expect(res.status).toBe(200);
  return res.body as {
    inputs: { listing_id: string; status: string; current_price?: number; original_price: number; price_changed?: boolean }[];
    any_price_changed: boolean;
    updated_trade_up: { total_cost_cents: number; profit_cents: number; roi_percentage: number } | null;
  };
}

describe("Verify keeps input costs fee-inclusive", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestApp({ defaultTier: "pro", defaultUserId: "user_pro" });
    process.env.CSFLOAT_API_KEY = "test-key";
    market.csfloat.clear();
    market.dmarket.clear();
    market.buff.clear();
    market.invalidated.length = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      const id = url.split("/listings/")[1];
      const price = market.csfloat.get(id);
      if (price === undefined) return new Response("not found", { status: 404 });
      return new Response(JSON.stringify({ state: "listed", price }), { status: 200 });
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    delete process.env.CSFLOAT_API_KEY;
    await ctx.cleanup();
  });

  it("is a no-op when nothing changed on any marketplace (no writes, no timestamp bump, no cache flush)", async () => {
    const id = await seedFeeTradeUp(ctx.pool, seeds(FEE));
    setMarket({ csf: 1000, dm: 1000, buff: 1000 });
    const before = await readTradeUp(ctx.pool, id);

    const body = await verify(ctx, id);

    expect(body.inputs.map(r => r.status)).toEqual(["active", "active", "active"]);
    for (const r of body.inputs) {
      expect(r.price_changed).toBe(false);
      expect(r.current_price).toBe(r.original_price);
    }
    expect(body.any_price_changed).toBe(false);
    expect(body.updated_trade_up).toBeNull();
    expect(await readInputPrices(ctx.pool, id)).toEqual({ [CSF]: FEE.csf, [DM]: FEE.dm, [BUFF]: FEE.buff });
    for (const lid of [CSF, DM, BUFF]) {
      const l = await readListing(ctx.pool, lid);
      expect(l?.price_cents).toBe(1000);
      expect(l?.price_updated_at).toBeNull();
    }
    expect(await readTradeUp(ctx.pool, id)).toEqual(before);
    expect(market.invalidated).toEqual([]);
  });

  it("writes the fee-inclusive price when a CSFloat listing changes (1000 → 1100 stores 1161)", async () => {
    const id = await seedFeeTradeUp(ctx.pool, seeds(FEE));
    setMarket({ csf: 1100, dm: 1000, buff: 1000 });

    const body = await verify(ctx, id);

    const csf = body.inputs.find(r => r.listing_id === CSF);
    expect(csf).toMatchObject({ price_changed: true, current_price: 1161, original_price: FEE.csf });
    expect(body.inputs.filter(r => r.listing_id !== CSF).every(r => r.price_changed === false)).toBe(true);
    expect(await readInputPrices(ctx.pool, id)).toEqual({ [CSF]: 1161, [DM]: FEE.dm, [BUFF]: FEE.buff });

    const row = await expectConsistentCost(ctx.pool, id, 1161 + FEE.dm + FEE.buff);
    expect(body.updated_trade_up).toMatchObject({
      total_cost_cents: row.total_cost_cents, profit_cents: row.profit_cents, roi_percentage: row.roi_percentage,
    });

    const csfListing = await readListing(ctx.pool, CSF);
    expect(csfListing?.price_cents).toBe(1100);
    expect(csfListing?.price_updated_at).not.toBeNull();
    expect((await readListing(ctx.pool, DM))?.price_updated_at).toBeNull();
    expect((await readListing(ctx.pool, BUFF))?.price_updated_at).toBeNull();
    expect(market.invalidated).toContain("tu:");
  });

  it("writes fee-inclusive prices when DMarket and Buff listings change", async () => {
    const id = await seedFeeTradeUp(ctx.pool, seeds(FEE));
    setMarket({ csf: 1000, dm: 1200, buff: 900 });

    await verify(ctx, id);

    const dm = storedInputCost(1200, "dmarket");
    const buff = storedInputCost(900, "buff");
    expect(await readInputPrices(ctx.pool, id)).toEqual({ [CSF]: FEE.csf, [DM]: dm, [BUFF]: buff });
    await expectConsistentCost(ctx.pool, id, FEE.csf + dm + buff);
    expect((await readListing(ctx.pool, DM))?.price_cents).toBe(1200);
    expect((await readListing(ctx.pool, BUFF))?.price_cents).toBe(900);
    expect((await readListing(ctx.pool, CSF))?.price_updated_at).toBeNull();
  });

  it("heals an already-stripped row without touching the listings", async () => {
    const id = await seedFeeTradeUp(ctx.pool, seeds({ csf: 1000, dm: 1000, buff: 1000 }));
    setMarket({ csf: 1000, dm: 1000, buff: 1000 });
    const before = await readTradeUp(ctx.pool, id);

    const body = await verify(ctx, id);

    expect(body.inputs.every(r => r.price_changed === true)).toBe(true);
    expect(body.inputs.find(r => r.listing_id === CSF)?.current_price).toBe(1058);
    expect(await readInputPrices(ctx.pool, id)).toEqual({ [CSF]: 1058, [DM]: FEE.dm, [BUFF]: FEE.buff });
    const after = await expectConsistentCost(ctx.pool, id, FEE.csf + FEE.dm + FEE.buff);
    expect(after.roi_percentage).toBeLessThan(before.roi_percentage);
    expect(after.chance_to_profit).toBeLessThan(before.chance_to_profit);
    for (const lid of [CSF, DM, BUFF]) {
      const l = await readListing(ctx.pool, lid);
      expect(l?.price_cents).toBe(1000);
      expect(l?.price_updated_at).toBeNull();
    }
  });

  it("stores exactly what discovery stores for the same listing on every marketplace", async () => {
    const id = await seedFeeTradeUp(ctx.pool, seeds({ csf: 1000, dm: 1000, buff: 1000 }));
    setMarket({ csf: 1234, dm: 777, buff: 4321 });

    await verify(ctx, id);

    expect(await readInputPrices(ctx.pool, id)).toEqual({
      [CSF]: await discoveryInputCost(ctx.pool, 1234, "csfloat"),
      [DM]: await discoveryInputCost(ctx.pool, 777, "dmarket"),
      [BUFF]: await discoveryInputCost(ctx.pool, 4321, "buff"),
    });
  });
});
