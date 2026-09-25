import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createTestApp, type TestContext } from "./setup.js";
import { recordDMarketRelink } from "../../server/engine.js";
import { storedInputCost } from "../../server/engine/fees.js";
import { expectConsistentCost, readInputPrices, seedFeeTradeUp } from "../helpers/input-fees.js";

/**
 * Verify follows dmarket_listing_relinks. A rewritten listing_id must also
 * receive the drifted fee-inclusive price, and two inputs that resolve to the
 * same live offer must not both be rewritten or reported active.
 */

const market = vi.hoisted(() => ({
  csfloat: new Map<string, number>(),
  dmarket: new Map<string, number>(),
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

const OLD = "dmarket:verify-relink-old";
const LIVE = "dmarket:verify-relink-live";
const OLD_A = "dmarket:verify-collapse-a";
const OLD_B = "dmarket:verify-collapse-b";
const SHARED = "dmarket:verify-collapse-shared";
const CSF = "csfloat:verify-relink-keep";

function dmSeed(listingId: string, raw: number, float: number) {
  return { listingId, source: "dmarket", raw, stored: storedInputCost(raw, "dmarket"), float };
}

async function verify(ctx: TestContext, id: number) {
  const res = await request(ctx.app).post(`/api/verify-trade-up/${id}`);
  expect(res.status).toBe(200);
  return res.body as {
    inputs: { listing_id: string; status: string; price_changed?: boolean; current_price?: number }[];
    all_active: boolean;
    any_unavailable: boolean;
    updated_trade_up: { total_cost_cents: number } | null;
  };
}

async function listingStatus(ctx: TestContext, id: number): Promise<string | undefined> {
  const { rows } = await ctx.pool.query<{ listing_status: string }>(
    "SELECT listing_status FROM trade_ups WHERE id = $1",
    [id],
  );
  return rows[0]?.listing_status;
}

async function inputIds(ctx: TestContext, id: number): Promise<string[]> {
  const { rows } = await ctx.pool.query<{ listing_id: string }>(
    "SELECT listing_id FROM trade_up_inputs WHERE trade_up_id = $1 ORDER BY listing_id",
    [id],
  );
  return rows.map(row => row.listing_id);
}

describe("Verify follows a DMarket relink", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestApp({ defaultTier: "pro", defaultUserId: "user_pro" });
    process.env.CSFLOAT_API_KEY = "test-key";
    market.csfloat.clear();
    market.dmarket.clear();
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
    await ctx.cleanup();
  });

  it("writes the drifted fee-inclusive price on the live id after a relink", async () => {
    const stored = storedInputCost(1000, "dmarket");
    const id = await seedFeeTradeUp(ctx.pool, [dmSeed(OLD, 1000, 0.15)]);
    await recordDMarketRelink(ctx.pool, OLD, LIVE);
    market.dmarket.set(LIVE, 1200);

    const body = await verify(ctx, id);

    const next = storedInputCost(1200, "dmarket");
    expect(body.inputs).toEqual([
      expect.objectContaining({ listing_id: LIVE, status: "active", price_changed: true, current_price: next }),
    ]);
    expect(body.updated_trade_up?.total_cost_cents).toBe(next);
    expect(await readInputPrices(ctx.pool, id)).toEqual({ [LIVE]: next });
    expect((await readInputPrices(ctx.pool, id))[OLD]).toBeUndefined();
    await expectConsistentCost(ctx.pool, id, next);
    expect(stored).not.toBe(next);
  });

  it("keeps the stored fee price when the relinked offer price is unchanged", async () => {
    const stored = storedInputCost(1000, "dmarket");
    const id = await seedFeeTradeUp(ctx.pool, [dmSeed(OLD, 1000, 0.15)]);
    await recordDMarketRelink(ctx.pool, OLD, LIVE);
    market.dmarket.set(LIVE, 1000);

    const body = await verify(ctx, id);

    expect(body.all_active).toBe(true);
    expect(body.inputs[0]).toMatchObject({ listing_id: LIVE, status: "active", price_changed: false });
    expect(body.updated_trade_up).toBeNull();
    expect(await readInputPrices(ctx.pool, id)).toEqual({ [LIVE]: stored });
  });

  it("does not rewrite either input when two relinks collapse onto one live offer", async () => {
    const id = await seedFeeTradeUp(ctx.pool, [
      dmSeed(OLD_A, 1000, 0.15),
      dmSeed(OLD_B, 1100, 0.16),
      { listingId: CSF, source: "csfloat", raw: 1000, stored: storedInputCost(1000, "csfloat"), float: 0.17 },
    ]);
    await ctx.pool.query(
      `INSERT INTO listings (id, skin_id, price_cents, float_value, source)
       VALUES ($1, 'skin-classified-1', 1000, 0.21, 'dmarket')`,
      [LIVE],
    );
    await recordDMarketRelink(ctx.pool, OLD_A, LIVE);
    await recordDMarketRelink(ctx.pool, OLD_B, LIVE);
    market.dmarket.set(LIVE, 1000);
    market.csfloat.set(CSF, 1000);

    const body = await verify(ctx, id);

    expect(body.all_active).toBe(false);
    expect(body.any_unavailable).toBe(true);
    const byId = new Map(body.inputs.map(row => [row.listing_id, row.status]));
    expect(byId.get(OLD_A)).toBe("delisted");
    expect(byId.get(OLD_B)).toBe("delisted");
    expect(byId.get(LIVE)).toBeUndefined();
    expect(byId.get(CSF)).toBe("active");
    expect(await inputIds(ctx, id)).toEqual([CSF, OLD_A, OLD_B].sort());
    expect(await listingStatus(ctx, id)).toBe("partial");
    const live = await ctx.pool.query("SELECT id FROM listings WHERE id = $1", [LIVE]);
    expect(live.rows).toHaveLength(1);
  });

  it("does not rewrite a relink onto a claimed listing", async () => {
    const id = await seedFeeTradeUp(ctx.pool, [
      dmSeed(OLD, 1000, 0.15),
      { listingId: CSF, source: "csfloat", raw: 1000, stored: storedInputCost(1000, "csfloat"), float: 0.17 },
    ]);
    await ctx.pool.query(
      `INSERT INTO listings (id, skin_id, price_cents, float_value, source, claimed_by)
       VALUES ($1, 'skin-classified-1', 1000, 0.21, 'dmarket', 'other-user')`,
      [LIVE],
    );
    await recordDMarketRelink(ctx.pool, OLD, LIVE);
    market.dmarket.set(LIVE, 1200);
    market.csfloat.set(CSF, 1000);

    const body = await verify(ctx, id);

    const byId = new Map(body.inputs.map(row => [row.listing_id, row.status]));
    expect(byId.get(LIVE)).toBeUndefined();
    expect(byId.get(OLD)).toBe("delisted");
    expect(byId.get(CSF)).toBe("active");
    expect(body.all_active).toBe(false);
    expect(await inputIds(ctx, id)).toEqual([CSF, OLD].sort());
    expect(await listingStatus(ctx, id)).toBe("partial");
    const claim = await ctx.pool.query<{ claimed_by: string }>(
      `SELECT claimed_by FROM listings WHERE id = $1`,
      [LIVE],
    );
    expect(claim.rows[0].claimed_by).toBe("other-user");
  });

  it("leaves a shared live listing in place when one input already holds it", async () => {
    const colliding = await seedFeeTradeUp(ctx.pool, [
      dmSeed(SHARED, 1000, 0.15),
      dmSeed(OLD_A, 1100, 0.16),
      { listingId: CSF, source: "csfloat", raw: 1000, stored: storedInputCost(1000, "csfloat"), float: 0.17 },
    ]);
    const sibling = await seedFeeTradeUp(ctx.pool, [
      dmSeed(SHARED, 1000, 0.15),
    ]);
    await recordDMarketRelink(ctx.pool, OLD_A, SHARED);
    market.dmarket.set(SHARED, 1000);
    market.csfloat.set(CSF, 1000);

    const body = await verify(ctx, colliding);

    expect(body.all_active).toBe(false);
    const byId = new Map(body.inputs.map(row => [row.listing_id, row.status]));
    expect(byId.get(SHARED)).toBe("delisted");
    expect(byId.get(OLD_A)).toBe("delisted");
    expect(byId.get(CSF)).toBe("active");
    expect(await inputIds(ctx, colliding)).toEqual([CSF, OLD_A, SHARED].sort());
    expect(await listingStatus(ctx, colliding)).toBe("partial");
    expect(await listingStatus(ctx, sibling)).toBe("active");
    expect(await inputIds(ctx, sibling)).toEqual([SHARED]);
    const live = await ctx.pool.query("SELECT id FROM listings WHERE id = $1", [SHARED]);
    expect(live.rows).toHaveLength(1);
  });
});
