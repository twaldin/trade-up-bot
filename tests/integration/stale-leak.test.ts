import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createTestApp, seedTestData, type TestContext } from "./setup.js";

/**
 * Coherence between the WHERE filter (listing_status column) and the canonical
 * status recomputed from live listings.
 *
 * Bug: a listing deleted without cascadeTradeUpStatuses running (race, crashed
 * fetcher, raw DELETE) leaves listing_status='active' in the column. The list
 * endpoint's WHERE passes the row, then canonicalListingStatus() recomputes
 * 'partial'/'stale' from the live LEFT JOIN — so the default view (Show stale
 * OFF) renders yellow/red rows it promised to hide.
 */
describe("stale-leak coherence guard", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestApp({ defaultTier: "pro", defaultUserId: "user_pro" });
    await seedTestData(ctx.pool, {
      profitableCount: 6,
      unprofitableCount: 0,
      staleCount: 0,
      type: "covert_knife",
    });
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  async function breakOneTradeUp(): Promise<number> {
    // Pick a column-'active' trade-up and raw-delete one input listing,
    // bypassing cascadeTradeUpStatuses — simulates the race.
    const { rows: [tu] } = await ctx.pool.query(
      `SELECT id FROM trade_ups WHERE listing_status = 'active' AND type = 'covert_knife' ORDER BY id LIMIT 1`
    );
    await ctx.pool.query(
      `DELETE FROM listings WHERE id = (
         SELECT listing_id FROM trade_up_inputs WHERE trade_up_id = $1 LIMIT 1
       )`,
      [tu.id]
    );
    return tu.id;
  }

  it("default view (stale OFF) never returns rows with non-active canonical status", async () => {
    const brokenId = await breakOneTradeUp();

    const res = await request(ctx.app)
      .get("/api/trade-ups?type=covert_knife")
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");

    expect(res.status).toBe(200);
    const returnedIds = res.body.trade_ups.map((tu: { id: number }) => tu.id);
    expect(returnedIds).not.toContain(brokenId);
    for (const tu of res.body.trade_ups) {
      expect(tu.listing_status).toBe("active");
    }
  });

  it("self-heals the listing_status column on read", async () => {
    const brokenId = await breakOneTradeUp();

    await request(ctx.app)
      .get("/api/trade-ups?type=covert_knife")
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");

    const { rows: [row] } = await ctx.pool.query(
      `SELECT listing_status, preserved_at FROM trade_ups WHERE id = $1`,
      [brokenId]
    );
    expect(row.listing_status).toBe("partial");
    expect(row.preserved_at).not.toBeNull();
  });

  it("healed row stays visible under include_stale=true", async () => {
    const brokenId = await breakOneTradeUp();

    // First request drops + heals
    await request(ctx.app)
      .get("/api/trade-ups?type=covert_knife")
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");

    const res = await request(ctx.app)
      .get("/api/trade-ups?type=covert_knife&include_stale=true")
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");

    expect(res.status).toBe(200);
    const broken = res.body.trade_ups.find((tu: { id: number }) => tu.id === brokenId);
    expect(broken).toBeDefined();
    expect(broken.listing_status).toBe("partial");
    expect(broken.missing_count).toBeGreaterThan(0);
  });
});
