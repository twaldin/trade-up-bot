import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import Stripe from "stripe";
import pg from "pg";
import { stripeRouter } from "../../server/routes/stripe.js";

const WEBHOOK_SECRET = "whsec_test_tracking";
const TRACKING_ENV = {
  GA4_MEASUREMENT_ID: "G-NEWPROP123",
  GA4_API_SECRET: "ga4-secret-value",
  META_PIXEL_ID: "123456789012345",
  META_CAPI_TOKEN: "meta-token-value",
};
const ENV_KEYS = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRO_LIFETIME_PRICE_ID", ...Object.keys(TRACKING_ENV)];
const saved = new Map<string, string | undefined>();

function app() {
  const server = express();
  server.use((req, res, next) => {
    if (req.path === "/api/stripe-webhook") express.raw({ type: "application/json" })(req, res, next);
    else express.json()(req, res, next);
  });
  server.use(stripeRouter(new pg.Pool({ connectionString: "postgres://unused@127.0.0.1:1/unused" })));
  return server;
}

function checkoutCompleted(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: "evt_test_1",
    object: "event",
    type: "checkout.session.completed",
    created: 1_700_000_100,
    data: {
      object: {
        id: "cs_test_abc",
        object: "checkout.session",
        amount_total: 699,
        currency: "usd",
        payment_status: "paid",
        mode: "subscription",
        customer: "cus_test_1",
        customer_details: { email: "test@example.com" },
        metadata: { tub_plan: "pro_monthly", tub_ua: "Mozilla/5.0 test" },
        ...overrides,
      },
    },
  });
}

function signed(payload: string) {
  return new Stripe("sk_test_dummy").webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
}

function post(payload: string) {
  return request(app())
    .post("/api/stripe-webhook")
    .set("Content-Type", "application/json")
    .set("stripe-signature", signed(payload))
    .send(payload);
}

beforeEach(() => {
  for (const key of ENV_KEYS) saved.set(key, process.env[key]);
  process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  delete process.env.STRIPE_PRO_LIFETIME_PRICE_ID;
  for (const key of Object.keys(TRACKING_ENV)) delete process.env[key];
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Stripe webhook conversion side-effect", () => {
  it("still rejects bad signatures exactly as before", async () => {
    const res = await request(app())
      .post("/api/stripe-webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "t=1,v1=bad")
      .send(checkoutCompleted());
    expect(res.status).toBe(400);
  });

  it("makes no tracking call when the tracking env vars are unset", async () => {
    const fetchSpy = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await post(checkoutCompleted());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fires Meta CAPI + GA4 MP Purchase once for a paid checkout", async () => {
    Object.assign(process.env, TRACKING_ENV);
    const fetchSpy = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    const res = await post(checkoutCompleted());
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    const urls = fetchSpy.mock.calls.map(([url]) => String(url));
    expect(urls.filter((u) => u.includes("graph.facebook.com")).length).toBe(1);
    expect(urls.filter((u) => u.includes("google-analytics.com/mp/collect")).length).toBe(1);
  });

  it("does not report unpaid checkouts", async () => {
    Object.assign(process.env, TRACKING_ENV);
    const fetchSpy = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    const res = await post(checkoutCompleted({ payment_status: "unpaid" }));
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 200 when the tracking endpoints reject", async () => {
    Object.assign(process.env, TRACKING_ENV);
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => { throw new Error("network down"); }));
    const res = await post(checkoutCompleted());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
  });

  it("returns 200 when fetch throws synchronously", async () => {
    Object.assign(process.env, TRACKING_ENV);
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(() => { throw new Error("sync"); }));
    const res = await post(checkoutCompleted());
    expect(res.status).toBe(200);
  });

  it("does not wait on a hung tracking endpoint before acknowledging Stripe", async () => {
    Object.assign(process.env, TRACKING_ENV);
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(() => new Promise<Response>(() => {})));
    const started = Date.now();
    const res = await post(checkoutCompleted());
    expect(res.status).toBe(200);
    expect(Date.now() - started).toBeLessThan(1500);
  });
});
