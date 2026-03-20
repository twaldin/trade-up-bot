/**
 * Concurrency stress tests.
 * Tests that concurrent operations don't cause race conditions,
 * deadlocks, or data corruption.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createTestApp, seedTestData, createOverlappingTradeUps, type TestContext } from "../integration/setup.js";

describe("Concurrent claims", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestApp({ defaultTier: "pro" });
    await seedTestData(ctx.pool, {
      profitableCount: 20,
      unprofitableCount: 0,
      staleCount: 0,
      type: "covert_knife",
    });
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("10 concurrent claims on different trade-ups all succeed", async () => {
    const { rows: tus } = await ctx.pool.query(
      "SELECT id FROM trade_ups WHERE listing_status = 'active' ORDER BY id LIMIT 10"
    );
    expect(tus.length).toBe(10);

    // Fire all 10 claims concurrently from different users
    const promises = tus.map((tu: { id: number }, i: number) =>
      request(ctx.app)
        .post(`/api/trade-ups/${tu.id}/claim`)
        .set("X-Test-User-Id", `concurrent-user-${i}`)
        .set("X-Test-User-Tier", "pro")
    );

    const results = await Promise.all(promises);

    // All should succeed since they're different trade-ups with non-overlapping listings
    const successes = results.filter(r => r.status === 200);
    expect(successes.length).toBe(10);
  });

  it("10 concurrent claims on same trade-up: exactly 1 wins", async () => {
    const { rows: tus } = await ctx.pool.query(
      "SELECT id FROM trade_ups WHERE listing_status = 'active' LIMIT 1"
    );
    const tuId = tus[0].id;

    // Fire 10 concurrent claims from different users
    const promises = Array.from({ length: 10 }, (_, i) =>
      request(ctx.app)
        .post(`/api/trade-ups/${tuId}/claim`)
        .set("X-Test-User-Id", `race-user-${i}`)
        .set("X-Test-User-Tier", "pro")
    );

    const results = await Promise.all(promises);

    const successes = results.filter(r => r.status === 200);
    const conflicts = results.filter(r => r.status === 409);

    // Exactly 1 should win — FOR UPDATE on trade_ups serializes concurrent claims
    expect(successes.length).toBe(1);
    expect(conflicts.length).toBe(9);
  });

  it("concurrent claim + release doesn't corrupt state", async () => {
    const { rows: tus } = await ctx.pool.query(
      "SELECT id FROM trade_ups WHERE listing_status = 'active' LIMIT 1"
    );
    const tuId = tus[0].id;

    // Claim it first
    await request(ctx.app)
      .post(`/api/trade-ups/${tuId}/claim`)
      .set("X-Test-User-Id", "owner")
      .set("X-Test-User-Tier", "pro");

    // Concurrently: owner releases + another user tries to claim
    const [release, claim] = await Promise.all([
      request(ctx.app)
        .delete(`/api/trade-ups/${tuId}/claim`)
        .set("X-Test-User-Id", "owner")
        .set("X-Test-User-Tier", "pro"),
      request(ctx.app)
        .post(`/api/trade-ups/${tuId}/claim`)
        .set("X-Test-User-Id", "challenger")
        .set("X-Test-User-Tier", "pro"),
    ]);

    // Release should succeed
    expect(release.status).toBe(200);

    // Claim may succeed or fail depending on timing — both are valid
    expect([200, 409]).toContain(claim.status);

    // Regardless, verify DB state is consistent:
    // either challenger owns it or nobody does
    const { rows: claims } = await ctx.pool.query(
      "SELECT user_id FROM trade_up_claims WHERE trade_up_id = $1 AND released_at IS NULL AND expires_at > NOW()",
      [tuId]
    );
    expect(claims.length).toBeLessThanOrEqual(1);
  });

  it("overlapping listings: concurrent claims on trade-ups A and B", async () => {
    const { tuIdA, tuIdB } = await createOverlappingTradeUps(ctx.pool);

    // Two users simultaneously try to claim A and B (which share listings)
    const [claimA, claimB] = await Promise.all([
      request(ctx.app)
        .post(`/api/trade-ups/${tuIdA}/claim`)
        .set("X-Test-User-Id", "user-a")
        .set("X-Test-User-Tier", "pro"),
      request(ctx.app)
        .post(`/api/trade-ups/${tuIdB}/claim`)
        .set("X-Test-User-Id", "user-b")
        .set("X-Test-User-Tier", "pro"),
    ]);

    // At most one should succeed — shared listings prevent both
    const successes = [claimA, claimB].filter(r => r.status === 200);
    expect(successes.length).toBeLessThanOrEqual(1);

    // Verify no listing is double-claimed
    const { rows: claimed } = await ctx.pool.query(
      "SELECT id, claimed_by FROM listings WHERE claimed_by IS NOT NULL"
    );
    const claimedByUsers = new Set(claimed.map((r: { claimed_by: string }) => r.claimed_by));
    // All claimed listings should belong to the same user
    expect(claimedByUsers.size).toBeLessThanOrEqual(1);
  });
});
