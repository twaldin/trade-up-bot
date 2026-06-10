/**
 * Characterization tests for real_input_count and missing_count on the
 * trade-ups list and detail endpoints.
 *
 * Semantics (captured from the current correlated-subquery implementation):
 *   real_input_count — inputs whose listing_id does NOT start with 'theor'
 *   missing_count    — real inputs whose listing row no longer exists in listings
 *
 * These tests are the regression net for the Step 2 batch rewrite.
 * They MUST pass against both the original correlated queries and the
 * replacement batched query.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createTestApp, type TestContext } from "./setup.js";

describe("trade-up input counts (real_input_count / missing_count)", () => {
  let ctx: TestContext;

  // IDs we inject directly in the test — not from seedTestData
  let tuFullId: number;   // all inputs backed by listings rows
  let tuMixedId: number;  // 3 real missing + 1 theor% input + 1 backed real input

  beforeEach(async () => {
    ctx = await createTestApp({ defaultTier: "pro", defaultUserId: "user_pro" });

    // Insert required users
    await ctx.pool.query(
      `INSERT INTO users (steam_id, display_name, avatar_url, tier) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      ["user_pro", "ProUser", "", "pro"]
    );

    // ─── Trade-up A: fully-backed ──────────────────────────────────────────
    // 4 inputs, each with a matching listing row. No theoretical inputs.
    // Expected: real_input_count=4, missing_count=0
    const { rows: [rowA] } = await ctx.pool.query(`
      INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents,
        roi_percentage, chance_to_profit, type, listing_status, outcomes_json,
        output_skin_names, collection_names, created_at)
      VALUES (10000, 12000, 2000, 20.0, 0.7, 'covert_knife', 'active', '[]',
              '{}', '{}', NOW() - INTERVAL '4 hours')
      RETURNING id
    `);
    tuFullId = rowA.id;

    for (let i = 0; i < 4; i++) {
      const lid = `cnt-full-${tuFullId}-${i}`;
      await ctx.pool.query(
        `INSERT INTO listings (id, skin_id, price_cents, float_value, source) VALUES ($1, $2, $3, $4, $5)`,
        [lid, "skin-classified-1", 2500, 0.15 + i * 0.01, "csfloat"]
      );
      await ctx.pool.query(
        `INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name,
          collection_name, price_cents, float_value, condition, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [tuFullId, lid, "skin-classified-1", "AK-47 | Test Skin",
          "Test Collection Alpha", 2500, 0.15 + i * 0.01, "Field-Tested", "csfloat"]
      );
    }

    // ─── Trade-up B: mixed ────────────────────────────────────────────────
    // 5 inputs total:
    //   1 × listing_id LIKE 'theor%'  → excluded from real_input_count
    //   1 × real input with matching listing row (backed)
    //   3 × real inputs with NO matching listing row (missing)
    // Expected: real_input_count=4, missing_count=3
    // preserved_at is set so it appears with include_stale=true
    const { rows: [rowB] } = await ctx.pool.query(`
      INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents,
        roi_percentage, chance_to_profit, type, listing_status, preserved_at,
        outcomes_json, output_skin_names, collection_names, created_at)
      VALUES (8000, 10000, 2000, 25.0, 0.6, 'covert_knife', 'stale', NOW(),
              '[]', '{}', '{}', NOW() - INTERVAL '4 hours')
      RETURNING id
    `);
    tuMixedId = rowB.id;

    // 1 theoretical input (listing_id starts with 'theor')
    await ctx.pool.query(
      `INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name,
        collection_name, price_cents, float_value, condition, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [tuMixedId, "theor-abc-123", "skin-classified-1", "AK-47 | Test Skin",
        "Test Collection Alpha", 2000, 0.10, "Factory New", "theory"]
    );

    // 1 backed real input (has a listings row)
    const backedId = `cnt-mixed-backed-${tuMixedId}`;
    await ctx.pool.query(
      `INSERT INTO listings (id, skin_id, price_cents, float_value, source) VALUES ($1, $2, $3, $4, $5)`,
      [backedId, "skin-classified-1", 2000, 0.20, "csfloat"]
    );
    await ctx.pool.query(
      `INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name,
        collection_name, price_cents, float_value, condition, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [tuMixedId, backedId, "skin-classified-1", "AK-47 | Test Skin",
        "Test Collection Alpha", 2000, 0.20, "Field-Tested", "csfloat"]
    );

    // 3 missing real inputs (no corresponding listings row)
    for (let i = 0; i < 3; i++) {
      const lid = `cnt-missing-${tuMixedId}-${i}`;
      await ctx.pool.query(
        `INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name,
          collection_name, price_cents, float_value, condition, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [tuMixedId, lid, "skin-classified-1", "AK-47 | Test Skin",
          "Test Collection Alpha", 2000, 0.25 + i * 0.01, "Field-Tested", "csfloat"]
      );
    }
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  // ─── List endpoint ────────────────────────────────────────────────────────

  it("fully-backed trade-up has missing_count=0 and listing_status=active in list", async () => {
    const res = await request(ctx.app)
      .get("/api/trade-ups?type=covert_knife&include_stale=true")
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");

    expect(res.status).toBe(200);
    const tu = res.body.trade_ups.find((t: { id: number }) => t.id === tuFullId);
    expect(tu).toBeDefined();
    // missing = 0 (all listings present); status stays active
    expect(tu.missing_count).toBe(0);
    expect(tu.listing_status).toBe("active");
  });

  it("mixed trade-up has missing_count=3 and listing_status=stale in list", async () => {
    const res = await request(ctx.app)
      .get("/api/trade-ups?type=covert_knife&include_stale=true")
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");

    expect(res.status).toBe(200);
    const tu = res.body.trade_ups.find((t: { id: number }) => t.id === tuMixedId);
    expect(tu).toBeDefined();
    // real inputs = 4 (5 total − 1 theor%), missing = 3 (no listing row)
    // canonicalListingStatus leaves non-active status unchanged → stale stays stale
    expect(tu.missing_count).toBe(3);
    expect(tu.listing_status).toBe("stale");
  });

  // ─── Detail endpoint ──────────────────────────────────────────────────────
  // The detail endpoint spreads the full DB row so real_input_count IS present.

  it("fully-backed trade-up has real_input_count=4, missing_count=0 in detail", async () => {
    const res = await request(ctx.app)
      .get(`/api/trade-ups/${tuFullId}`)
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");

    expect(res.status).toBe(200);
    // real_input_count comes from the DB row (correlated subquery / batched replacement)
    expect(res.body.real_input_count).toBe(4);
    expect(res.body.missing_count).toBe(0);
  });

  it("mixed trade-up has real_input_count=4, missing_count=3 in detail", async () => {
    const res = await request(ctx.app)
      .get(`/api/trade-ups/${tuMixedId}`)
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");

    expect(res.status).toBe(200);
    // 5 inputs − 1 theor% = 4 real; 3 of 4 real have no listing row
    expect(res.body.real_input_count).toBe(4);
    expect(res.body.missing_count).toBe(3);
  });
});
