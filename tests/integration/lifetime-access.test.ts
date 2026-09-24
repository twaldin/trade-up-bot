import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestContext } from "./setup.js";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestApp({ defaultTier: "free", defaultUserId: "user_free" });
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
});

describe("lifetime access while tier is still free", () => {
  it("lets Verify through the Pro gate", async () => {
    const blocked = await request(ctx.app).post("/api/verify-trade-up/1");
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toMatch(/Pro/);

    const allowed = await request(ctx.app).post("/api/verify-trade-up/1").set("x-test-user-lifetime", "true");
    expect(allowed.status).not.toBe(403);
  });

  it("lets Claim and Confirm through the Pro gate", async () => {
    for (const path of ["/api/trade-ups/1/claim", "/api/trade-ups/1/confirm"]) {
      const blocked = await request(ctx.app).post(path).send({ listing_ids: ["x"] });
      expect(blocked.status, path).toBe(403);

      const allowed = await request(ctx.app).post(path).set("x-test-user-lifetime", "true").send({ listing_ids: ["x"] });
      expect(allowed.status, path).not.toBe(403);
    }
  });

  it("serves the live board and detail tier to a lifetime buyer whose tier is still free", async () => {
    const { rows } = await ctx.pool.query(
      `INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, chance_to_profit, type, listing_status, outcomes_json, created_at)
       VALUES (10000, 12000, 2000, 20, 0.5, 'classified_covert', 'active', '[]', NOW())
       RETURNING id`,
    );
    const id = rows[0].id as number;
    const lifetime = { "x-test-user-id": "user_life", "x-test-user-tier": "free", "x-test-user-lifetime": "true" };

    const board = await request(ctx.app).get("/api/trade-ups?include_stale=true&per_page=500").set(lifetime);
    expect(board.status).toBe(200);
    expect(board.body.tier).toBe("pro");
    expect(board.body.tier_config.delay).toBe(0);
    expect(board.body.trade_ups.some((row: { id: number }) => row.id === id)).toBe(true);

    const free = await request(ctx.app).get("/api/trade-ups?include_stale=true&per_page=500");
    expect(free.body.tier).toBe("free");
    expect(free.body.tier_config.delay).toBe(3 * 60 * 60);
    expect(free.body.trade_ups.some((row: { id: number }) => row.id === id)).toBe(false);

    const detail = await request(ctx.app).get(`/api/trade-ups/${id}`).set(lifetime);
    expect(detail.status).toBe(200);
    expect(detail.headers["x-effective-tier"]).toBe("pro");

    const inputs = await request(ctx.app).get(`/api/trade-up/${id}/inputs`).set(lifetime);
    expect(inputs.status).toBe(200);
    expect(inputs.headers["x-effective-tier"]).toBe("pro");

    const freeDetail = await request(ctx.app).get(`/api/trade-ups/${id}`);
    expect(freeDetail.headers["x-effective-tier"]).toBe("free");
  });
});
