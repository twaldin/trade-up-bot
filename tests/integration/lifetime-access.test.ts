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
});
