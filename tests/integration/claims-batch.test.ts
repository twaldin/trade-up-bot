/**
 * Integration test for the batched getActiveClaims path (cache miss → PG).
 *
 * Verifies that the single batch query replacing the per-claim loop produces
 * correct listing_ids arrays for 2 simultaneously active claims.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestApp, type TestContext } from "./setup.js";
import { getActiveClaims } from "../../server/routes/claims.js";

describe("getActiveClaims batch listing-id load", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestApp({ defaultTier: "pro", defaultUserId: "user_pro" });

    await ctx.pool.query(
      `INSERT INTO users (steam_id, display_name, avatar_url, tier) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      ["user_pro", "ProUser", "", "pro"]
    );
    await ctx.pool.query(
      `INSERT INTO users (steam_id, display_name, avatar_url, tier) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      ["user_pro2", "ProUser2", "", "pro"]
    );
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("returns correct listing_ids arrays for 2 active claims (batch path)", async () => {
    // ─── trade-up A: 3 inputs ────────────────────────────────────────────
    const { rows: [tuA] } = await ctx.pool.query(`
      INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents,
        roi_percentage, chance_to_profit, type, listing_status, outcomes_json,
        output_skin_names, collection_names, created_at)
      VALUES (9000, 12000, 3000, 33.3, 0.8, 'covert_knife', 'active', '[]',
              '{}', '{}', NOW() - INTERVAL '4 hours')
      RETURNING id
    `);

    const lidA = ["batch-claim-a1", "batch-claim-a2", "batch-claim-a3"];
    for (const lid of lidA) {
      await ctx.pool.query(
        `INSERT INTO listings (id, skin_id, price_cents, float_value, source) VALUES ($1, $2, $3, $4, $5)`,
        [lid, "skin-classified-1", 3000, 0.15, "csfloat"]
      );
      await ctx.pool.query(
        `INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name,
          collection_name, price_cents, float_value, condition, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [tuA.id, lid, "skin-classified-1", "AK-47 | Test Skin",
          "Test Collection Alpha", 3000, 0.15, "Field-Tested", "csfloat"]
      );
    }

    // ─── trade-up B: 2 inputs ────────────────────────────────────────────
    const { rows: [tuB] } = await ctx.pool.query(`
      INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents,
        roi_percentage, chance_to_profit, type, listing_status, outcomes_json,
        output_skin_names, collection_names, created_at)
      VALUES (6000, 8000, 2000, 33.3, 0.7, 'covert_knife', 'active', '[]',
              '{}', '{}', NOW() - INTERVAL '4 hours')
      RETURNING id
    `);

    const lidB = ["batch-claim-b1", "batch-claim-b2"];
    for (const lid of lidB) {
      await ctx.pool.query(
        `INSERT INTO listings (id, skin_id, price_cents, float_value, source) VALUES ($1, $2, $3, $4, $5)`,
        [lid, "skin-classified-1", 3000, 0.20, "csfloat"]
      );
      await ctx.pool.query(
        `INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name,
          collection_name, price_cents, float_value, condition, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [tuB.id, lid, "skin-classified-1", "AK-47 | Test Skin",
          "Test Collection Alpha", 3000, 0.20, "Field-Tested", "csfloat"]
      );
    }

    // Insert two active claims (expires_at far in the future)
    const futureExpiry = new Date(Date.now() + 30 * 60 * 1000).toISOString().replace("T", " ").replace("Z", "");
    await ctx.pool.query(
      `INSERT INTO trade_up_claims (trade_up_id, user_id, claimed_at, expires_at)
       VALUES ($1, $2, NOW(), $3)`,
      [tuA.id, "user_pro", futureExpiry]
    );
    await ctx.pool.query(
      `INSERT INTO trade_up_claims (trade_up_id, user_id, claimed_at, expires_at)
       VALUES ($1, $2, NOW(), $3)`,
      [tuB.id, "user_pro2", futureExpiry]
    );

    // Call getActiveClaims (cache miss path — Redis is unavailable in tests)
    const claims = await getActiveClaims(ctx.pool);

    expect(claims.length).toBe(2);

    const claimA = claims.find(c => c.trade_up_id === tuA.id);
    const claimB = claims.find(c => c.trade_up_id === tuB.id);

    expect(claimA).toBeDefined();
    expect(claimB).toBeDefined();

    // listing_ids should match exactly what was inserted
    expect(claimA!.listing_ids.sort()).toEqual(lidA.sort());
    expect(claimB!.listing_ids.sort()).toEqual(lidB.sort());
  });
});
