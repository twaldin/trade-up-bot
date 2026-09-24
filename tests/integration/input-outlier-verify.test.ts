import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { createTestApp, type TestContext } from "./setup.js";
import { storedInputCost } from "../../server/engine/fees.js";
import { refPriceCache, skinportMedianCache } from "../../server/engine/pricing.js";
import { resetInputReferenceCache } from "../../server/engine/input-outlier.js";
import { seedFeeTradeUp, readInputPrices } from "../helpers/input-fees.js";

const market = vi.hoisted(() => ({
  csfloat: new Map<string, number>(),
  dmarket: new Map<string, number>(),
  buff: new Map<string, { id: string; priceCents: number; floatValue: number }[]>(),
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

vi.mock("../../server/sync/buff.js", () => ({
  fetchBuffListings: async (goodsId: number) => ({
    items: market.buff.get(String(goodsId)) ?? [],
    totalPages: 1,
    totalCount: 0,
  }),
}));

vi.mock("../../server/redis.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/redis.js")>();
  return {
    ...actual,
    getRedis: () => ({ get: async () => "buff-cookie", incrby: async () => 0 }),
  };
});

const SKIN = "AK-47 | Test Skin";
const OUTLIER = 9_999_900;

async function setRef(pool: TestContext["pool"]) {
  await pool.query(
    `INSERT INTO price_data (skin_name, condition, min_price_cents, median_price_cents, source, volume)
     VALUES ($1, 'Field-Tested', 1000, 1000, 'csfloat_ref', 10)
     ON CONFLICT (skin_name, condition, source) DO UPDATE SET min_price_cents = 1000, median_price_cents = 1000`,
    [SKIN],
  );
  refPriceCache.clear();
  skinportMedianCache.clear();
  resetInputReferenceCache();
}

describe("Verify outlier guard", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestApp({ defaultTier: "pro", defaultUserId: "user_pro" });
    process.env.CSFLOAT_API_KEY = "test-key";
    market.csfloat.clear();
    market.dmarket.clear();
    market.buff.clear();
    refPriceCache.clear();
    skinportMedianCache.clear();
    resetInputReferenceCache();
    vi.stubGlobal("fetch", async (url: string) => {
      const id = String(url).split("/listings/")[1];
      const price = market.csfloat.get(id);
      if (price === undefined) return new Response("not found", { status: 404 });
      return new Response(JSON.stringify({ state: "listed", price }), { status: 200 });
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    delete process.env.CSFLOAT_API_KEY;
    refPriceCache.clear();
    skinportMedianCache.clear();
    resetInputReferenceCache();
    await ctx.cleanup();
  });

  async function status(id: number) {
    const { rows } = await ctx.pool.query(
      "SELECT listing_status, preserved_at FROM trade_ups WHERE id = $1",
      [id],
    );
    return rows[0] as { listing_status: string; preserved_at: Date | null };
  }

  it("does not write a CSFloat outlier price and does not re-activate the row", async () => {
    const id = await seedFeeTradeUp(ctx.pool, [
      { listingId: "verify-csf", source: "csfloat", raw: 1000, stored: storedInputCost(1000, "csfloat"), float: 0.2 },
    ]);
    const kept = new Date("2020-03-01T00:00:00Z");
    await ctx.pool.query("UPDATE trade_ups SET listing_status = 'stale', preserved_at = $1 WHERE id = $2", [kept, id]);
    await setRef(ctx.pool);
    market.csfloat.set("verify-csf", OUTLIER);

    const res = await request(ctx.app).post(`/api/verify-trade-up/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.inputs[0].price_outlier).toBe(true);
    expect((await readInputPrices(ctx.pool, id))["verify-csf"]).toBe(storedInputCost(1000, "csfloat"));
    const row = await status(id);
    expect(row.listing_status).toBe("stale");
    expect(new Date(row.preserved_at!).toISOString()).toBe(kept.toISOString());
    expect((await ctx.pool.query("SELECT price_cents FROM listings WHERE id = 'verify-csf'")).rows[0].price_cents).toBe(OUTLIER);
  });

  it("does not write a DMarket outlier, including when the listing row is re-inserted", async () => {
    const id = await seedFeeTradeUp(ctx.pool, [
      { listingId: "dmarket:verify-out", source: "dmarket", raw: 1000, stored: storedInputCost(1000, "dmarket"), float: 0.2 },
    ]);
    await setRef(ctx.pool);
    market.dmarket.set("dmarket:verify-out", OUTLIER);
    await ctx.pool.query("DELETE FROM listings WHERE id = 'dmarket:verify-out'");

    const res = await request(ctx.app).post(`/api/verify-trade-up/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.inputs[0].price_outlier).toBe(true);
    expect((await readInputPrices(ctx.pool, id))["dmarket:verify-out"]).toBe(storedInputCost(1000, "dmarket"));
    expect((await status(id)).listing_status).toBe("stale");
    expect((await status(id)).preserved_at).not.toBeNull();
    const listing = (await ctx.pool.query("SELECT price_cents FROM listings WHERE id = 'dmarket:verify-out'")).rows[0];
    expect(listing.price_cents).toBe(OUTLIER);
  });

  it("does not write a Buff outlier price", async () => {
    const id = await seedFeeTradeUp(ctx.pool, [
      { listingId: "buff:verify-out", source: "buff", raw: 1000, stored: storedInputCost(1000, "buff"), float: 0.2, marketplaceId: "77" },
    ]);
    await setRef(ctx.pool);
    market.buff.set("77", [{ id: "1", priceCents: OUTLIER, floatValue: 0.2 }]);

    const res = await request(ctx.app).post(`/api/verify-trade-up/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.inputs[0].price_outlier).toBe(true);
    expect((await readInputPrices(ctx.pool, id))["buff:verify-out"]).toBe(storedInputCost(1000, "buff"));
    expect((await status(id)).listing_status).toBe("stale");
  });
});
