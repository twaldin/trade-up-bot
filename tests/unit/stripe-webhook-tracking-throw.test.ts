import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import Stripe from "stripe";
import pg from "pg";

vi.mock("../../server/tracking.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/tracking.js")>();
  return {
    ...actual,
    trackCheckoutCompleted: () => { throw new Error("tracker exploded"); },
  };
});

const { stripeRouter } = await import("../../server/routes/stripe.js");

const WEBHOOK_SECRET = "whsec_test_tracking_throw";
const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRO_LIFETIME_PRICE_ID"]) saved.set(key, process.env[key]);
  process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  delete process.env.STRIPE_PRO_LIFETIME_PRICE_ID;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.restoreAllMocks();
});

describe("Stripe webhook with a tracker that throws synchronously", () => {
  it("still acknowledges the event with 200", async () => {
    const server = express();
    server.use("/api/stripe-webhook", express.raw({ type: "application/json" }));
    server.use(stripeRouter(new pg.Pool({ connectionString: "postgres://unused@127.0.0.1:1/unused" })));
    const payload = JSON.stringify({
      id: "evt_test_2",
      object: "event",
      type: "checkout.session.completed",
      created: 1_700_000_100,
      data: { object: { id: "cs_test_x", object: "checkout.session", payment_status: "paid", mode: "subscription", customer: "cus_1", metadata: {} } },
    });
    const sig = new Stripe("sk_test_dummy").webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
    const res = await request(server)
      .post("/api/stripe-webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", sig)
      .send(payload);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
  });
});
