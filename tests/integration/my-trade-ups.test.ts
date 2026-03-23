import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import pg from "pg";
import { createTestApp, seedTestData, type TestContext } from "./setup.js";
import { VALID_MARKETPLACES } from "../../shared/my-trade-ups-types.js";

/** Insert a user_trade_ups row directly for testing CRUD without going through confirm flow */
async function insertUserTradeUp(
  pool: pg.Pool,
  overrides: Partial<{
    user_id: string;
    trade_up_id: number;
    status: string;
    total_cost_cents: number;
    expected_value_cents: number;
    roi_percentage: number;
    chance_to_profit: number;
    best_case_cents: number;
    worst_case_cents: number;
    type: string;
    outcome_skin_id: string;
    outcome_skin_name: string;
    outcome_condition: string;
    outcome_float: number;
    sold_price_cents: number;
    sold_marketplace: string;
    actual_profit_cents: number;
    executed_at: string;
    sold_at: string;
  }> = {}
): Promise<number> {
  const defaults = {
    user_id: "user_pro",
    trade_up_id: 1,
    status: "purchased",
    total_cost_cents: 10000,
    expected_value_cents: 12000,
    roi_percentage: 20.0,
    chance_to_profit: 0.8,
    best_case_cents: 5000,
    worst_case_cents: -2000,
    type: "covert_knife",
  };
  const d = { ...defaults, ...overrides };

  const { rows } = await pool.query(
    `INSERT INTO user_trade_ups
       (user_id, trade_up_id, status, snapshot_inputs, snapshot_outcomes,
        total_cost_cents, expected_value_cents, roi_percentage, chance_to_profit,
        best_case_cents, worst_case_cents, type,
        outcome_skin_id, outcome_skin_name, outcome_condition, outcome_float,
        sold_price_cents, sold_marketplace, actual_profit_cents,
        executed_at, sold_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
     RETURNING id`,
    [
      d.user_id,
      d.trade_up_id,
      d.status,
      JSON.stringify([{ skin_name: "AK-47 | Test Skin", collection_name: "Test Collection Alpha", price_cents: 2000, float_value: 0.15, condition: "Field-Tested", source: "csfloat", stattrak: false }]),
      JSON.stringify([{ skin_name: "AK-47 | Fire Serpent", skin_id: "skin-covert-1", probability: 1.0, price_cents: 12000, condition: "Field-Tested", predicted_float: 0.15 }]),
      d.total_cost_cents,
      d.expected_value_cents,
      d.roi_percentage,
      d.chance_to_profit,
      d.best_case_cents,
      d.worst_case_cents,
      d.type,
      overrides.outcome_skin_id ?? null,
      overrides.outcome_skin_name ?? null,
      overrides.outcome_condition ?? null,
      overrides.outcome_float ?? null,
      overrides.sold_price_cents ?? null,
      overrides.sold_marketplace ?? null,
      overrides.actual_profit_cents ?? null,
      overrides.executed_at ?? null,
      overrides.sold_at ?? null,
    ]
  );
  return rows[0].id;
}

describe("My Trade-Ups", () => {
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

  it("user_trade_ups table exists", async () => {
    const { rows } = await ctx.pool.query(
      "SELECT 1 FROM information_schema.tables WHERE table_name = 'user_trade_ups' AND table_schema = current_schema()"
    );
    expect(rows.length).toBe(1);
  });

  // ── GET /api/my-trade-ups ──────────────────────────────────────────────

  it("GET /api/my-trade-ups returns empty array when user has none", async () => {
    const res = await request(ctx.app).get("/api/my-trade-ups");
    expect(res.status).toBe(200);
    expect(res.body.trade_ups).toEqual([]);
  });

  it("GET /api/my-trade-ups returns user entries", async () => {
    await insertUserTradeUp(ctx.pool, { trade_up_id: profitableId });
    const res = await request(ctx.app).get("/api/my-trade-ups");
    expect(res.status).toBe(200);
    expect(res.body.trade_ups.length).toBe(1);
    expect(res.body.trade_ups[0].trade_up_id).toBe(profitableId);
    expect(res.body.trade_ups[0].status).toBe("purchased");
  });

  it("GET /api/my-trade-ups filters by status", async () => {
    const id1 = await insertUserTradeUp(ctx.pool, { trade_up_id: profitableId, status: "purchased" });
    // Use a different trade_up_id to avoid unique constraint
    const id2 = await insertUserTradeUp(ctx.pool, { trade_up_id: profitableId - 1, status: "executed", executed_at: new Date().toISOString() });

    const resPurchased = await request(ctx.app).get("/api/my-trade-ups?status=purchased");
    expect(resPurchased.body.trade_ups.length).toBe(1);
    expect(resPurchased.body.trade_ups[0].id).toBe(id1);

    const resExecuted = await request(ctx.app).get("/api/my-trade-ups?status=executed");
    expect(resExecuted.body.trade_ups.length).toBe(1);
    expect(resExecuted.body.trade_ups[0].id).toBe(id2);

    const resMulti = await request(ctx.app).get("/api/my-trade-ups?status=purchased,executed");
    expect(resMulti.body.trade_ups.length).toBe(2);
  });

  it("GET /api/my-trade-ups rejects free tier", async () => {
    const res = await request(ctx.app)
      .get("/api/my-trade-ups")
      .set("X-Test-User-Tier", "free");
    expect(res.status).toBe(403);
  });

  // ── POST /api/my-trade-ups/:id/execute ─────────────────────────────────

  it("POST execute transitions purchased → executed with outcome data", async () => {
    const utId = await insertUserTradeUp(ctx.pool, { trade_up_id: profitableId });

    const res = await request(ctx.app)
      .post(`/api/my-trade-ups/${utId}/execute`)
      .send({ outcome_index: 0 });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("executed");
    expect(res.body.outcome_skin_name).toBe("AK-47 | Fire Serpent");
    expect(res.body.outcome_float).toBe(0.15);

    // Verify DB
    const { rows } = await ctx.pool.query("SELECT status, executed_at, outcome_skin_name FROM user_trade_ups WHERE id = $1", [utId]);
    expect(rows[0].status).toBe("executed");
    expect(rows[0].executed_at).not.toBeNull();
    expect(rows[0].outcome_skin_name).toBe("AK-47 | Fire Serpent");
  });

  it("POST execute rejects invalid outcome_index", async () => {
    const utId = await insertUserTradeUp(ctx.pool, { trade_up_id: profitableId });

    const res = await request(ctx.app)
      .post(`/api/my-trade-ups/${utId}/execute`)
      .send({ outcome_index: 999 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/outcome_index/i);
  });

  it("POST execute rejects entry not owned by user", async () => {
    const utId = await insertUserTradeUp(ctx.pool, { user_id: "user_pro2", trade_up_id: profitableId });

    const res = await request(ctx.app)
      .post(`/api/my-trade-ups/${utId}/execute`)
      .send({ outcome_index: 0 });

    expect(res.status).toBe(404);
  });

  // ── POST /api/my-trade-ups/:id/sell ────────────────────────────────────

  it("POST sell transitions executed → sold and writes price observation", async () => {
    const utId = await insertUserTradeUp(ctx.pool, {
      trade_up_id: profitableId,
      status: "executed",
      executed_at: new Date().toISOString(),
      outcome_skin_id: "skin-covert-1",
      outcome_skin_name: "AK-47 | Fire Serpent",
      outcome_condition: "Field-Tested",
      outcome_float: 0.15,
    });

    const res = await request(ctx.app)
      .post(`/api/my-trade-ups/${utId}/sell`)
      .send({ price_cents: 15000, marketplace: "csfloat" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("sold");
    expect(res.body.sold_price_cents).toBe(15000);
    expect(res.body.actual_profit_cents).toBe(5000); // 15000 - 10000

    // Verify price observation was written
    const { rows: obs } = await ctx.pool.query(
      "SELECT * FROM price_observations WHERE skin_name = $1 AND source = 'user_report'",
      ["AK-47 | Fire Serpent"]
    );
    expect(obs.length).toBe(1);
    expect(obs[0].price_cents).toBe(15000);
    expect(obs[0].float_value).toBeCloseTo(0.15);
  });

  it("POST sell rejects non-executed entry", async () => {
    const utId = await insertUserTradeUp(ctx.pool, { trade_up_id: profitableId, status: "purchased" });

    const res = await request(ctx.app)
      .post(`/api/my-trade-ups/${utId}/sell`)
      .send({ price_cents: 15000, marketplace: "csfloat" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/executed/i);
  });

  it("POST sell rejects invalid marketplace", async () => {
    const utId = await insertUserTradeUp(ctx.pool, {
      trade_up_id: profitableId,
      status: "executed",
      executed_at: new Date().toISOString(),
      outcome_skin_name: "AK-47 | Fire Serpent",
      outcome_float: 0.15,
    });

    const res = await request(ctx.app)
      .post(`/api/my-trade-ups/${utId}/sell`)
      .send({ price_cents: 15000, marketplace: "invalid_marketplace" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/marketplace/i);
  });

  // ── DELETE /api/my-trade-ups/:id ───────────────────────────────────────

  it("DELETE removes entry", async () => {
    const utId = await insertUserTradeUp(ctx.pool, { trade_up_id: profitableId });

    const res = await request(ctx.app).delete(`/api/my-trade-ups/${utId}`);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);

    // Verify gone
    const { rows } = await ctx.pool.query("SELECT 1 FROM user_trade_ups WHERE id = $1", [utId]);
    expect(rows.length).toBe(0);
  });

  // ── Confirm creates user_trade_up snapshot ─────────────────────────────

  describe("Confirm creates user_trade_up snapshot", () => {
    it("creates user_trade_ups entry on confirm", async () => {
      const claimRes = await request(ctx.app)
        .post(`/api/trade-ups/${profitableId}/claim`)
        .set("X-Test-User-Id", "user_pro")
        .set("X-Test-User-Tier", "pro");
      expect(claimRes.status).toBe(200);

      const { rows: inputs } = await ctx.pool.query(
        "SELECT listing_id FROM trade_up_inputs WHERE trade_up_id = $1",
        [profitableId]
      );
      const listingIds = inputs.map((r: any) => r.listing_id).filter((id: string) => !id.startsWith("theor"));

      const confirmRes = await request(ctx.app)
        .post(`/api/trade-ups/${profitableId}/confirm`)
        .send({ listing_ids: listingIds })
        .set("X-Test-User-Id", "user_pro")
        .set("X-Test-User-Tier", "pro");
      expect(confirmRes.status).toBe(200);

      const { rows } = await ctx.pool.query(
        "SELECT * FROM user_trade_ups WHERE user_id = $1 AND trade_up_id = $2",
        ["user_pro", profitableId]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("purchased");
      expect(rows[0].snapshot_inputs).toHaveLength(listingIds.length);
      expect(rows[0].snapshot_outcomes.length).toBeGreaterThan(0);
      expect(rows[0].total_cost_cents).toBeGreaterThan(0);
      expect(rows[0].type).toBeDefined();
    });

    it("partial confirm snapshots only confirmed listings", async () => {
      const claimRes = await request(ctx.app)
        .post(`/api/trade-ups/${profitableId}/claim`)
        .set("X-Test-User-Id", "user_pro")
        .set("X-Test-User-Tier", "pro");
      expect(claimRes.status).toBe(200);

      const { rows: inputs } = await ctx.pool.query(
        "SELECT listing_id FROM trade_up_inputs WHERE trade_up_id = $1",
        [profitableId]
      );
      const allIds = inputs.map((r: any) => r.listing_id).filter((id: string) => !id.startsWith("theor"));
      const partialIds = allIds.slice(0, 2);

      const confirmRes = await request(ctx.app)
        .post(`/api/trade-ups/${profitableId}/confirm`)
        .send({ listing_ids: partialIds })
        .set("X-Test-User-Id", "user_pro")
        .set("X-Test-User-Tier", "pro");
      expect(confirmRes.status).toBe(200);

      const { rows } = await ctx.pool.query(
        "SELECT * FROM user_trade_ups WHERE user_id = $1 AND trade_up_id = $2",
        ["user_pro", profitableId]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].snapshot_inputs).toHaveLength(2);
    });
  });

  // ── Claim with auto-verify ───────────────────────────────────────────

  describe("Claim with auto-verify", () => {
    it("claim still succeeds for active trade-ups (DB-presence verify)", async () => {
      const res = await request(ctx.app)
        .post(`/api/trade-ups/${profitableId}/claim`)
        .set("X-Test-User-Id", "user_pro")
        .set("X-Test-User-Tier", "pro");
      expect(res.status).toBe(200);
      expect(res.body.claim).toBeDefined();
      expect(res.body.verification).toBeDefined();
    });
  });

  // ── GET /api/my-trade-ups/stats ────────────────────────────────────────

  it("GET stats returns zeros when no sold entries", async () => {
    const res = await request(ctx.app).get("/api/my-trade-ups/stats");
    expect(res.status).toBe(200);
    expect(res.body.all_time_profit_cents).toBe(0);
    expect(res.body.total_executed).toBe(0);
    expect(res.body.total_sold).toBe(0);
    expect(res.body.win_count).toBe(0);
    expect(res.body.win_rate).toBe(0);
    expect(res.body.avg_roi).toBe(0);
  });

  it("GET stats computes correctly from sold entries only", async () => {
    // Insert a sold entry with profit
    await insertUserTradeUp(ctx.pool, {
      trade_up_id: profitableId,
      status: "sold",
      total_cost_cents: 10000,
      executed_at: new Date().toISOString(),
      sold_at: new Date().toISOString(),
      sold_price_cents: 15000,
      actual_profit_cents: 5000,
    });
    // Insert another sold entry with loss (different trade_up_id)
    await insertUserTradeUp(ctx.pool, {
      trade_up_id: profitableId - 1,
      status: "sold",
      total_cost_cents: 10000,
      executed_at: new Date().toISOString(),
      sold_at: new Date().toISOString(),
      sold_price_cents: 7000,
      actual_profit_cents: -3000,
    });
    // Insert a purchased entry (should NOT count)
    await insertUserTradeUp(ctx.pool, {
      trade_up_id: profitableId - 2,
      status: "purchased",
      total_cost_cents: 10000,
    });

    const res = await request(ctx.app).get("/api/my-trade-ups/stats");
    expect(res.status).toBe(200);
    expect(res.body.all_time_profit_cents).toBe(2000); // 5000 + (-3000)
    expect(res.body.total_sold).toBe(2);
    expect(res.body.total_executed).toBe(2); // sold counts as executed too
    expect(res.body.win_count).toBe(1);
    expect(res.body.win_rate).toBeCloseTo(50.0); // 1/2 * 100
    // avg_roi = AVG(actual_profit_cents / total_cost_cents * 100) = AVG(50, -30) = 10
    expect(res.body.avg_roi).toBeCloseTo(10.0, 0);
  });
});
