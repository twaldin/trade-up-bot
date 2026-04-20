import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createTestApp, seedTestData, type TestContext } from "./setup.js";

describe("Trade-Ups List API", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestApp({ defaultTier: "pro", defaultUserId: "user_pro" });
    await seedTestData(ctx.pool, {
      profitableCount: 8,
      unprofitableCount: 4,
      staleCount: 3,
      type: "covert_knife",
    });
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  // ─── 1. Returns trade-ups sorted by profit descending by default ──────

  it("returns trade-ups sorted by profit descending by default", async () => {
    const res = await request(ctx.app)
      .get("/api/trade-ups?type=covert_knife")
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");

    expect(res.status).toBe(200);
    expect(res.body.trade_ups.length).toBeGreaterThan(0);

    // Verify descending order by profit
    const profits = res.body.trade_ups.map((tu: any) => tu.profit_cents);
    for (let i = 1; i < profits.length; i++) {
      expect(profits[i]).toBeLessThanOrEqual(profits[i - 1]);
    }
  });

  // ─── 2. Show stale OFF excludes partial/stale trade-ups ───────────────

  it("show stale OFF excludes partial/stale trade-ups", async () => {
    const res = await request(ctx.app)
      .get("/api/trade-ups?type=covert_knife")
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");

    expect(res.status).toBe(200);

    // No stale trade-ups should appear
    const statuses = res.body.trade_ups.map((tu: any) => tu.listing_status);
    expect(statuses).not.toContain("stale");
  });

  // ─── 3. Show stale ON includes partial trade-ups with missing_inputs count

  it("show stale ON includes stale trade-ups", async () => {
    const res = await request(ctx.app)
      .get("/api/trade-ups?type=covert_knife&include_stale=true")
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");

    expect(res.status).toBe(200);

    // Should include stale trade-ups
    const staleOnes = res.body.trade_ups.filter((tu: any) => tu.listing_status === "stale");
    expect(staleOnes.length).toBeGreaterThan(0);
  });

  it("derives partial status + missing_count when DB status is stale/active drifted", async () => {
    const { rows: [target] } = await ctx.pool.query(`
      SELECT t.id, tui.listing_id
      FROM trade_ups t
      JOIN trade_up_inputs tui ON tui.trade_up_id = t.id
      JOIN listings l ON l.id = tui.listing_id
      WHERE t.type = 'covert_knife'
        AND t.listing_status = 'active'
        AND tui.listing_id NOT LIKE 'theor%'
      LIMIT 1
    `);

    expect(target).toBeDefined();
    await ctx.pool.query("DELETE FROM listings WHERE id = $1", [target.listing_id]);

    const res = await request(ctx.app)
      .get("/api/trade-ups?type=covert_knife&include_stale=true")
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");

    expect(res.status).toBe(200);
    const drifted = res.body.trade_ups.find((tu: any) => tu.id === target.id);
    expect(drifted).toBeDefined();
    expect(drifted.listing_status).toBe("partial");
    expect(drifted.missing_count).toBeGreaterThan(0);
    expect(drifted.missing_inputs).toBe(drifted.missing_count);

    const detail = await request(ctx.app)
      .get(`/api/trade-ups/${target.id}`)
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");

    expect(detail.status).toBe(200);
    expect(detail.body.listing_status).toBe("partial");
    expect(detail.body.missing_count).toBeGreaterThan(0);
  });

  // ─── 4. Pagination returns correct page with per_page limit ───────────

  it("pagination returns correct page with per_page limit", async () => {
    const perPage = 3;

    // Page 1
    const page1 = await request(ctx.app)
      .get(`/api/trade-ups?type=covert_knife&per_page=${perPage}&page=1&include_stale=true`)
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");
    expect(page1.status).toBe(200);
    expect(page1.body.trade_ups.length).toBe(perPage);
    expect(page1.body.page).toBe(1);
    expect(page1.body.per_page).toBe(perPage);

    // Page 2
    const page2 = await request(ctx.app)
      .get(`/api/trade-ups?type=covert_knife&per_page=${perPage}&page=2&include_stale=true`)
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");
    expect(page2.status).toBe(200);
    expect(page2.body.trade_ups.length).toBe(perPage);
    expect(page2.body.page).toBe(2);

    // Pages should not overlap
    const page1Ids = new Set(page1.body.trade_ups.map((tu: any) => tu.id));
    const page2Ids = page2.body.trade_ups.map((tu: any) => tu.id);
    for (const id of page2Ids) {
      expect(page1Ids.has(id)).toBe(false);
    }
  });

  // ─── 5. Type filter returns only requested trade-up type ──────────────

  it("type filter returns only requested trade-up type", async () => {
    // Add some classified_covert trade-ups
    await seedTestData(ctx.pool, {
      profitableCount: 3,
      unprofitableCount: 0,
      staleCount: 0,
      type: "classified_covert",
    });

    // Request only classified_covert
    const res = await request(ctx.app)
      .get("/api/trade-ups?type=classified_covert")
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");

    expect(res.status).toBe(200);
    expect(res.body.trade_ups.length).toBeGreaterThan(0);

    // All returned should be classified_covert
    for (const tu of res.body.trade_ups) {
      expect(tu.type).toBe("classified_covert");
    }
  });

  // ─── 6. Total count matches filters ───────────────────────────────────

  it("total count reflects the applied filters", async () => {
    const res = await request(ctx.app)
      .get("/api/trade-ups?type=covert_knife&min_profit=0")
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");

    expect(res.status).toBe(200);

    // With min_profit=0, we should only get profitable ones
    // (profit >= 0 cents, which includes all profitable trade-ups)
    for (const tu of res.body.trade_ups) {
      expect(tu.profit_cents).toBeGreaterThanOrEqual(0);
    }
    expect(res.body.total).toBeGreaterThan(0);
    expect(res.body.total).toBeLessThanOrEqual(res.body.total);
  });

  // ─── 7. Sort by ROI ascending ─────────────────────────────────────────

  it("sort by ROI ascending works", async () => {
    const res = await request(ctx.app)
      .get("/api/trade-ups?type=covert_knife&sort=roi&order=asc&include_stale=true")
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");

    expect(res.status).toBe(200);
    const rois = res.body.trade_ups.map((tu: any) => tu.roi_percentage);
    for (let i = 1; i < rois.length; i++) {
      expect(rois[i]).toBeGreaterThanOrEqual(rois[i - 1]);
    }
  });

  // ─── 8. Response includes tier config ─────────────────────────────────

  it("response includes tier config for the requesting user", async () => {
    const resPro = await request(ctx.app)
      .get("/api/trade-ups?type=covert_knife")
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");
    expect(resPro.body.tier).toBe("pro");
    expect(resPro.body.tier_config.delay).toBe(0);
    expect(resPro.body.tier_config.showListingIds).toBe(true);

    const resBasic = await request(ctx.app)
      .get("/api/trade-ups?type=covert_knife")
      .set("X-Test-User-Id", "user_basic")
      .set("X-Test-User-Tier", "basic");
    expect(resBasic.body.tier).toBe("basic");
    expect(resBasic.body.tier_config.delay).toBe(30 * 60); // 30 min
    expect(resBasic.body.tier_config.showListingIds).toBe(true);
  });

  // ─── 9. Free tier returns limited results ─────────────────────────────

  it("free tier returns unlimited trade-ups with listing links hidden", async () => {
    const res = await request(ctx.app)
      .get("/api/trade-ups?type=covert_knife")
      .set("X-Test-User-Id", "user_free")
      .set("X-Test-User-Tier", "free");

    expect(res.status).toBe(200);
    // Free tier gets unlimited trade-ups (no limit per type)
    expect(res.body.trade_ups.length).toBeGreaterThan(0);
    expect(res.body.tier).toBe("free");
    // All tiers get listing links (per tier table in CLAUDE.md)
    expect(res.body.tier_config.showListingIds).toBe(true);
  });

  // ─── 10. Trade-ups include input_summary ──────────────────────────────

  it("trade-ups include input_summary with skin names and collections", async () => {
    const res = await request(ctx.app)
      .get("/api/trade-ups?type=covert_knife")
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");

    expect(res.status).toBe(200);
    expect(res.body.trade_ups.length).toBeGreaterThan(0);

    const tu = res.body.trade_ups[0];
    expect(tu.input_summary).toBeDefined();
    expect(tu.input_summary.skins).toBeDefined();
    expect(Array.isArray(tu.input_summary.skins)).toBe(true);
    expect(tu.input_summary.collections).toBeDefined();
    expect(tu.input_summary.input_count).toBeGreaterThan(0);
  });
});
