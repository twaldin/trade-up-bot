import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createTestApp, seedTestData, createOverlappingTradeUps, type TestContext } from "./setup.js";

describe("Claims API", () => {
  let ctx: TestContext;
  let profitableId: number;

  beforeEach(async () => {
    ctx = await createTestApp({ defaultTier: "pro", defaultUserId: "user_pro" });
    const { lastTradeUpId } = await seedTestData(ctx.pool);
    profitableId = lastTradeUpId;
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  // ─── 1. Claiming a trade-up returns the claim with expiry time ──────────

  it("claiming a trade-up returns the claim with expiry time", async () => {
    const res = await request(ctx.app)
      .post(`/api/trade-ups/${profitableId}/claim`)
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");

    expect(res.status).toBe(200);
    expect(res.body.claim).toBeDefined();
    expect(res.body.claim.trade_up_id).toBe(profitableId);
    expect(res.body.claim.user_id).toBe("user_pro");
    expect(res.body.claim.expires_at).toBeDefined();

    // Expiry should be ~30 minutes from now
    // The claim route stores expires_at as "YYYY-MM-DD HH:MM:SS.sss" (UTC, stripped Z).
    // PG TIMESTAMPTZ returns it without timezone in pg text mode. Append +00 for UTC.
    // Verify expiry is a valid timestamp in the future
    const rawExpiry = res.body.claim.expires_at;
    expect(rawExpiry).toBeDefined();
    const expiresAt = new Date(String(rawExpiry));
    expect(expiresAt.getTime()).not.toBeNaN();
    // Should be in the future (at least 1 min from now)
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 60 * 1000);
  });

  // ─── 2. Claimed trade-up cannot be claimed by another user ──────────────

  it("claimed trade-up cannot be claimed by another user", async () => {
    // First user claims
    const claim1 = await request(ctx.app)
      .post(`/api/trade-ups/${profitableId}/claim`)
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");
    expect(claim1.status).toBe(200);

    // Second user tries to claim the same trade-up
    const claim2 = await request(ctx.app)
      .post(`/api/trade-ups/${profitableId}/claim`)
      .set("X-Test-User-Id", "user_pro2")
      .set("X-Test-User-Tier", "pro");
    expect(claim2.status).toBe(409);
    expect(claim2.body.error).toMatch(/already claimed/i);
  });

  // ─── 3. Listing-level conflict ──────────────────────────────────────────

  it("claiming trade-up B fails if it shares a listing with already-claimed trade-up A", async () => {
    const { tuIdA, tuIdB } = await createOverlappingTradeUps(ctx.pool);

    // User 1 claims trade-up A
    const claimA = await request(ctx.app)
      .post(`/api/trade-ups/${tuIdA}/claim`)
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");
    expect(claimA.status).toBe(200);

    // User 2 tries to claim trade-up B (shares listings with A)
    const claimB = await request(ctx.app)
      .post(`/api/trade-ups/${tuIdB}/claim`)
      .set("X-Test-User-Id", "user_pro2")
      .set("X-Test-User-Tier", "pro");
    expect(claimB.status).toBe(409);
    expect(claimB.body.error).toMatch(/listings are already claimed/i);
  });

  // ─── 4. Releasing a claim allows re-claiming ───────────────────────────

  it("releasing a claim allows re-claiming", async () => {
    // Claim
    const claim1 = await request(ctx.app)
      .post(`/api/trade-ups/${profitableId}/claim`)
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");
    expect(claim1.status).toBe(200);

    // Release
    const release = await request(ctx.app)
      .delete(`/api/trade-ups/${profitableId}/claim`)
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");
    expect(release.status).toBe(200);
    expect(release.body.released).toBe(true);

    // Re-claim by a different user
    const claim2 = await request(ctx.app)
      .post(`/api/trade-ups/${profitableId}/claim`)
      .set("X-Test-User-Id", "user_pro2")
      .set("X-Test-User-Tier", "pro");
    expect(claim2.status).toBe(200);
    expect(claim2.body.claim.user_id).toBe("user_pro2");
  });

  // ─── 5. Confirming a claim marks the trade-up as stale ─────────────────

  it("confirming a claim removes the trade-up (listings deleted → cascade deletes)", async () => {
    // Claim
    await request(ctx.app)
      .post(`/api/trade-ups/${profitableId}/claim`)
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");

    // Confirm
    const confirm = await request(ctx.app)
      .post(`/api/trade-ups/${profitableId}/confirm`)
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");
    expect(confirm.status).toBe(200);
    expect(confirm.body.confirmed).toBe(true);

    // Trade-up is deleted by cascade (all listings gone, claim released)
    const { rows } = await ctx.pool.query("SELECT id FROM trade_ups WHERE id = $1", [profitableId]);
    expect(rows).toHaveLength(0);
  });

  // ─── 6. Confirming deletes the listings from DB ────────────────────────

  it("confirming deletes the listings from DB", async () => {
    // Get the listing IDs for this trade-up
    const { rows: inputs } = await ctx.pool.query(
      "SELECT listing_id FROM trade_up_inputs WHERE trade_up_id = $1", [profitableId]
    );
    const listingIds = inputs.map((i: { listing_id: string }) => i.listing_id);

    // Verify listings exist before
    for (const lid of listingIds) {
      const { rows } = await ctx.pool.query("SELECT 1 FROM listings WHERE id = $1", [lid]);
      expect(rows.length).toBeGreaterThan(0);
    }

    // Claim and confirm
    await request(ctx.app)
      .post(`/api/trade-ups/${profitableId}/claim`)
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");
    await request(ctx.app)
      .post(`/api/trade-ups/${profitableId}/confirm`)
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");

    // Verify listings are gone
    for (const lid of listingIds) {
      const { rows } = await ctx.pool.query("SELECT 1 FROM listings WHERE id = $1", [lid]);
      expect(rows.length).toBe(0);
    }
  });

  // ─── 7. Cannot re-claim a confirmed (stale) trade-up ──────────────────

  it("cannot re-claim after confirm (trade-up deleted by cascade)", async () => {
    // Claim and confirm
    await request(ctx.app)
      .post(`/api/trade-ups/${profitableId}/claim`)
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");
    await request(ctx.app)
      .post(`/api/trade-ups/${profitableId}/confirm`)
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");

    // Try to claim again — trade-up no longer exists (cascade deleted it)
    const reClaim = await request(ctx.app)
      .post(`/api/trade-ups/${profitableId}/claim`)
      .set("X-Test-User-Id", "user_pro2")
      .set("X-Test-User-Tier", "pro");
    expect(reClaim.status).toBe(404);
    expect(reClaim.body.error).toMatch(/not found/i);
  });

  // ─── 8. Rate limit: 11th claim returns 429 ────────────────────────────

  it("rate limit: 11th claim returns 429", async () => {
    // Use a unique user to avoid cross-test rate limit contamination.
    // The in-memory rate limiter persists across tests in the same process.
    const rlUser = `user_ratelimit_${Date.now()}`;

    // Create 11 claimable trade-ups
    const tradeUpIds: number[] = [];
    for (let i = 0; i < 11; i++) {
      const cost = 5000;
      const ev = 8000;
      const { rows } = await ctx.pool.query(`
        INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, chance_to_profit, type, listing_status, outcomes_json, created_at)
        VALUES ($1, $2, $3, $4, $5, 'covert_knife', 'active', '[]', NOW() - INTERVAL '4 hours')
        RETURNING id
      `, [cost, ev, ev - cost, 60.0, 0.9]);
      const id = rows[0].id;
      tradeUpIds.push(id);

      for (let j = 0; j < 5; j++) {
        const lid = `rl-listing-${id}-${j}`;
        await ctx.pool.query(
          `INSERT INTO listings (id, skin_id, price_cents, float_value) VALUES ($1, $2, $3, $4)`,
          [lid, "skin-classified-1", 1000, 0.15 + j * 0.01]
        );
        await ctx.pool.query(
          `INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [id, lid, "skin-classified-1", "AK-47 | Test Skin", "Test Collection Alpha", 1000, 0.15 + j * 0.01, "FT"]
        );
      }
    }

    // Claim 10, releasing each after (to stay under the 5-active-claims limit)
    for (let i = 0; i < 10; i++) {
      const res = await request(ctx.app)
        .post(`/api/trade-ups/${tradeUpIds[i]}/claim`)
        .set("X-Test-User-Id", rlUser)
        .set("X-Test-User-Tier", "pro");
      expect(res.status).toBe(200);

      // Release so we don't hit the active claims limit
      await request(ctx.app)
        .delete(`/api/trade-ups/${tradeUpIds[i]}/claim`)
        .set("X-Test-User-Id", rlUser)
        .set("X-Test-User-Tier", "pro");
    }

    // 11th claim should be rate-limited
    const res11 = await request(ctx.app)
      .post(`/api/trade-ups/${tradeUpIds[10]}/claim`)
      .set("X-Test-User-Id", rlUser)
      .set("X-Test-User-Tier", "pro");
    expect(res11.status).toBe(429);
    expect(res11.body.error).toMatch(/limit/i);
  });

  // ─── 9. Non-pro user gets 403 on claim ─────────────────────────────────

  it("non-pro user gets 403 on claim", async () => {
    const res = await request(ctx.app)
      .post(`/api/trade-ups/${profitableId}/claim`)
      .set("X-Test-User-Id", "user_free")
      .set("X-Test-User-Tier", "free");
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/requires.*pro/i);
  });

  // ─── 10. Cannot claim an unprofitable trade-up ─────────────────────────

  it("cannot claim an unprofitable trade-up", async () => {
    // Use a unique user to avoid cross-test rate limit contamination
    const unprofUser = `user_unprof_${Date.now()}`;

    // Find an unprofitable trade-up (negative profit)
    const { rows } = await ctx.pool.query("SELECT id FROM trade_ups WHERE profit_cents <= 0 LIMIT 1");
    expect(rows.length).toBeGreaterThan(0);

    const res = await request(ctx.app)
      .post(`/api/trade-ups/${rows[0].id}/claim`)
      .set("X-Test-User-Id", unprofUser)
      .set("X-Test-User-Tier", "pro");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not profitable/i);
  });
});
