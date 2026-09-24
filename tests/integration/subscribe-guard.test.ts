import express from "express";
import type { Request, Response, NextFunction } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApp, type TestContext } from "./setup.js";

const stripeMock = vi.hoisted(() => ({
  customersCreate: vi.fn(async () => ({ id: "cus_new" })),
  sessionsCreate: vi.fn(async () => ({ url: "https://checkout.stripe.test/cs_test" })),
  portalCreate: vi.fn(async () => ({ url: "https://billing.stripe.test/session" })),
  subscriptionsList: vi.fn(async () => ({ data: [] as { status: string }[] })),
}));

vi.mock("stripe", () => {
  class Stripe {
    customers = { create: stripeMock.customersCreate };
    checkout = { sessions: { create: stripeMock.sessionsCreate, retrieve: vi.fn(), listLineItems: vi.fn() } };
    billingPortal = { sessions: { create: stripeMock.portalCreate } };
    subscriptions = { list: stripeMock.subscriptionsList };
    webhooks = { constructEvent: vi.fn() };
  }
  return { default: Stripe };
});

process.env.STRIPE_SECRET_KEY = "sk_test_subscribe_guard";
process.env.STRIPE_PRO_PRICE_ID = "price_pro_test";
process.env.STRIPE_PRO_YEARLY_PRICE_ID = "price_year_test";
process.env.STRIPE_PRO_LIFETIME_PRICE_ID = "price_life_test";
process.env.BASE_URL = "http://localhost:3001";

const { stripeRouter } = await import("../../server/routes/stripe.js");

let ctx: TestContext;
let app: express.Express;

beforeAll(async () => {
  ctx = await createTestApp();
  await ctx.pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS lifetime BOOLEAN NOT NULL DEFAULT false");
  for (const [id, tier] of [["user_free", "free"], ["user_pro", "pro"], ["user_pro2", "free"], ["user_granted", "pro"], ["user_pastdue", "free"]] as const) {
    await ctx.pool.query(
      "INSERT INTO users (steam_id, display_name, avatar_url, tier) VALUES ($1, $1, '', $2) ON CONFLICT DO NOTHING",
      [id, tier],
    );
  }
  app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const steamId = req.header("x-test-user-id");
    if (steamId) {
      req.user = {
        steam_id: steamId,
        display_name: "Guard",
        avatar_url: "",
        tier: "free",
        is_admin: false,
      };
    }
    next();
  });
  app.use(stripeRouter(ctx.pool));
}, 60_000);

afterAll(async () => {
  await ctx.cleanup();
});

beforeEach(async () => {
  stripeMock.customersCreate.mockClear();
  stripeMock.sessionsCreate.mockClear();
  stripeMock.subscriptionsList.mockReset();
  stripeMock.subscriptionsList.mockResolvedValue({ data: [] });
  await ctx.pool.query("UPDATE users SET tier = 'free', lifetime = false, stripe_customer_id = NULL WHERE steam_id = $1", ["user_free"]);
  await ctx.pool.query("UPDATE users SET tier = 'pro', lifetime = false, stripe_customer_id = 'cus_pro' WHERE steam_id = $1", ["user_pro"]);
  await ctx.pool.query("UPDATE users SET tier = 'free', lifetime = true, stripe_customer_id = 'cus_life' WHERE steam_id = $1", ["user_pro2"]);
  await ctx.pool.query("UPDATE users SET tier = 'pro', lifetime = false, stripe_customer_id = NULL WHERE steam_id = $1", ["user_granted"]);
  await ctx.pool.query("UPDATE users SET tier = 'free', lifetime = false, stripe_customer_id = 'cus_pastdue' WHERE steam_id = $1", ["user_pastdue"]);
});

const subscribe = (steamId: string | null, plan: string) => {
  const req = request(app).post("/api/subscribe").send({ plan });
  return steamId ? req.set("x-test-user-id", steamId) : req;
};

describe("POST /api/subscribe refuses a second Pro checkout", () => {
  it("still creates a checkout for a free user and keeps the configured price", async () => {
    const res = await subscribe("user_free", "pro");
    expect(res.status).toBe(200);
    expect(res.body.url).toBe("https://checkout.stripe.test/cs_test");
    expect(stripeMock.customersCreate).toHaveBeenCalledTimes(1);
    expect(stripeMock.sessionsCreate).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(stripeMock.sessionsCreate.mock.calls)).toContain('"price":"price_pro_test"');
  });

  it("returns 409 for an active Pro subscription and does not create a customer or a session", async () => {
    for (const plan of ["pro", "pro-yearly"]) {
      const res = await subscribe("user_pro", plan);
      expect(res.status, plan).toBe(409);
      expect(res.body.error).toMatch(/already have Pro/i);
    }
    const lifetime = await subscribe("user_pro", "pro-lifetime");
    expect(lifetime.status).toBe(409);
    expect(lifetime.body.error).toBe("Cancel your current plan in Manage subscription first, then buy Lifetime.");
    expect(stripeMock.customersCreate).not.toHaveBeenCalled();
    expect(stripeMock.sessionsCreate).not.toHaveBeenCalled();
  });

  it("returns 409 for granted Pro with no Stripe customer and leaves the row unchanged", async () => {
    const before = await ctx.pool.query("SELECT tier, lifetime, stripe_customer_id FROM users WHERE steam_id = $1", ["user_granted"]);
    const res = await subscribe("user_granted", "pro");
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already have Pro/i);
    expect(stripeMock.customersCreate).not.toHaveBeenCalled();
    expect(stripeMock.sessionsCreate).not.toHaveBeenCalled();
    const after = await ctx.pool.query("SELECT tier, lifetime, stripe_customer_id FROM users WHERE steam_id = $1", ["user_granted"]);
    expect(after.rows).toEqual(before.rows);
    expect(after.rows[0].stripe_customer_id).toBeNull();
  });

  it("returns 409 when Stripe still has an open subscription the tier column missed", async () => {
    for (const status of ["active", "trialing", "past_due", "unpaid", "incomplete"]) {
      stripeMock.subscriptionsList.mockResolvedValueOnce({ data: [{ status }] });
      const res = await subscribe("user_pastdue", "pro");
      expect(res.status, status).toBe(409);
      expect(res.body.error).toMatch(/Manage subscription/);
    }
    expect(stripeMock.customersCreate).not.toHaveBeenCalled();
    expect(stripeMock.sessionsCreate).not.toHaveBeenCalled();
    stripeMock.subscriptionsList.mockResolvedValueOnce({ data: [{ status: "past_due" }] });
    const lifetime = await subscribe("user_pastdue", "pro-lifetime");
    expect(lifetime.status).toBe(409);
    expect(lifetime.body.error).toBe("Cancel your current plan in Manage subscription first, then buy Lifetime.");
  });

  it("tells a granted Pro user there is no billing to manage", async () => {
    const res = await request(app).post("/api/billing-portal").set("x-test-user-id", "user_granted");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Your Pro access was granted directly; there's no billing to manage.");
    expect(stripeMock.portalCreate).not.toHaveBeenCalled();
  });

  it("returns 409 for lifetime access even when the tier column is free", async () => {
    const res = await subscribe("user_pro2", "pro-lifetime");
    expect(res.status).toBe(409);
    expect(stripeMock.customersCreate).not.toHaveBeenCalled();
    expect(stripeMock.sessionsCreate).not.toHaveBeenCalled();
  });

  it("still rejects a logged-out caller and an unknown plan", async () => {
    expect((await subscribe(null, "pro")).status).toBe(401);
    expect((await subscribe("user_free", "nope")).status).toBe(400);
    expect(stripeMock.sessionsCreate).not.toHaveBeenCalled();
  });
});
