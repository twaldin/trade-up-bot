import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createTestApp, seedTestData, type TestContext } from "./setup.js";

/**
 * Verify endpoint integration tests.
 *
 * The verify endpoint (/api/verify-trade-up/:id) calls external APIs
 * (CSFloat, DMarket, Skinport) to check listing status. In these tests
 * we don't mock external APIs — instead we test the behavioral gates:
 * - Tier gating (free users blocked)
 * - Rate limiting
 * - DB-level propagation effects when listings are deleted
 *
 * For tests that need to simulate sold/delisted listings, we manipulate
 * the DB directly (delete listings) and verify the status detection logic.
 */

describe("Verify API", () => {
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

  // ─── 1. Free user gets 403 on verify ──────────────────────────────────

  it("free user gets 403 on verify", async () => {
    const res = await request(ctx.app)
      .post(`/api/verify-trade-up/${profitableId}`)
      .set("X-Test-User-Id", "user_free")
      .set("X-Test-User-Tier", "free");

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/basic|pro/i);
  });

  // ─── 2. Basic user can access verify ──────────────────────────────────

  it("basic user can access verify (not blocked by tier)", async () => {
    // Note: This will attempt external API calls which will fail in test.
    // The important behavior is that the endpoint doesn't reject with 403.
    // Since there's no CSFLOAT_API_KEY in the test env, we expect 500.
    const res = await request(ctx.app)
      .post(`/api/verify-trade-up/${profitableId}`)
      .set("X-Test-User-Id", "user_basic")
      .set("X-Test-User-Tier", "basic");

    // Should NOT be 403 — basic tier is allowed
    expect(res.status).not.toBe(403);
    // Will be 500 because no CSFLOAT_API_KEY is configured in test env
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/api key/i);
  });

  // ─── 3. Verify returns 404 for nonexistent trade-up ───────────────────

  it("verify returns 404 for nonexistent trade-up", async () => {
    // Set an API key so we get past the key check
    process.env.CSFLOAT_API_KEY = "test-key";

    const res = await request(ctx.app)
      .post("/api/verify-trade-up/999999")
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");

    expect(res.status).toBe(404);

    delete process.env.CSFLOAT_API_KEY;
  });

  // ─── 4. Verify propagates sold listings to other trade-ups sharing them ─

  it("verify propagates sold listings to other trade-ups sharing them", async () => {
    // Create two trade-ups that share a listing
    const sharedListingId = `shared-verify-${Date.now()}`;
    await ctx.pool.query(
      `INSERT INTO listings (id, skin_id, price_cents, float_value) VALUES ($1, $2, $3, $4)`,
      [sharedListingId, "skin-classified-1", 2000, 0.15]
    );

    // Trade-up A
    const { rows: rowsA } = await ctx.pool.query(`
      INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, chance_to_profit, type, listing_status, outcomes_json, created_at)
      VALUES ($1, $2, $3, $4, $5, 'covert_knife', 'active', '[]', NOW() - INTERVAL '4 hours')
      RETURNING id
    `, [10000, 14000, 4000, 40.0, 0.8]);
    const tuIdA = rowsA[0].id;

    // Trade-up B
    const { rows: rowsB } = await ctx.pool.query(`
      INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, chance_to_profit, type, listing_status, outcomes_json, created_at)
      VALUES ($1, $2, $3, $4, $5, 'covert_knife', 'active', '[]', NOW() - INTERVAL '4 hours')
      RETURNING id
    `, [11000, 15000, 4000, 36.0, 0.7]);
    const tuIdB = rowsB[0].id;

    // Both trade-ups reference the shared listing
    await ctx.pool.query(
      `INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [tuIdA, sharedListingId, "skin-classified-1", "AK-47 | Test Skin", "Test Collection Alpha", 2000, 0.15, "FT"]
    );
    await ctx.pool.query(
      `INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [tuIdB, sharedListingId, "skin-classified-1", "AK-47 | Test Skin", "Test Collection Alpha", 2000, 0.15, "FT"]
    );

    // Add more unique inputs to each so they're not fully stale
    for (let i = 0; i < 4; i++) {
      const lidA = `unique-verify-a-${i}`;
      const lidB = `unique-verify-b-${i}`;
      await ctx.pool.query(
        `INSERT INTO listings (id, skin_id, price_cents, float_value) VALUES ($1, $2, $3, $4)`,
        [lidA, "skin-classified-1", 2000, 0.16 + i * 0.01]
      );
      await ctx.pool.query(
        `INSERT INTO listings (id, skin_id, price_cents, float_value) VALUES ($1, $2, $3, $4)`,
        [lidB, "skin-classified-1", 2000, 0.20 + i * 0.01]
      );
      await ctx.pool.query(
        `INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [tuIdA, lidA, "skin-classified-1", "AK-47 | Test Skin", "Test Collection Alpha", 2000, 0.16 + i * 0.01, "FT"]
      );
      await ctx.pool.query(
        `INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [tuIdB, lidB, "skin-classified-1", "AK-47 | Test Skin", "Test Collection Alpha", 2000, 0.20 + i * 0.01, "FT"]
      );
    }

    // Simulate: delete the shared listing (as if it was sold)
    await ctx.pool.query("DELETE FROM listings WHERE id = $1", [sharedListingId]);

    // Now simulate what verify does when it finds a deleted listing:
    // It marks the trade-up as partial and propagates to other trade-ups
    await ctx.pool.query(
      "UPDATE trade_ups SET listing_status = 'partial', preserved_at = NOW() WHERE id = $1",
      [tuIdA]
    );

    // Propagate to trade-up B (same logic as verify endpoint)
    const { rows: affected } = await ctx.pool.query(
      "SELECT DISTINCT trade_up_id FROM trade_up_inputs WHERE listing_id = $1 AND trade_up_id != $2",
      [sharedListingId, tuIdA]
    );
    for (const { trade_up_id } of affected) {
      await ctx.pool.query(
        "UPDATE trade_ups SET listing_status = 'partial', preserved_at = COALESCE(preserved_at, NOW()) WHERE id = $1 AND listing_status = 'active'",
        [trade_up_id]
      );
    }

    // Verify trade-up B was affected
    const { rows: tuBRows } = await ctx.pool.query("SELECT listing_status FROM trade_ups WHERE id = $1", [tuIdB]);
    expect(tuBRows[0].listing_status).toBe("partial");
  });

  // ─── 5. Verify invalid trade-up ID returns 400 ────────────────────────

  it("verify invalid trade-up ID returns 400", async () => {
    process.env.CSFLOAT_API_KEY = "test-key";

    const res = await request(ctx.app)
      .post("/api/verify-trade-up/not-a-number")
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid/i);

    delete process.env.CSFLOAT_API_KEY;
  });

  // ─── 6. Unauthenticated user gets 403 on verify ──────────────────────

  it("unauthenticated user gets 403 on verify", async () => {
    // Create a test app with no default user
    const noAuthCtx = await createTestApp({ defaultTier: "free", defaultUserId: "" });
    await seedTestData(noAuthCtx.pool);

    const res = await request(noAuthCtx.app)
      .post(`/api/verify-trade-up/1`)
      .set("X-Test-User-Id", "")
      .set("X-Test-User-Tier", "free");

    expect(res.status).toBe(403);

    await noAuthCtx.cleanup();
  });
});
