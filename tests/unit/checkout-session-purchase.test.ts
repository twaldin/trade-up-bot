import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import request from "supertest";
import vm from "node:vm";
import { AUTH_RETURN_STRIP_SOURCE } from "../../shared/auth-return-strip.js";
import { consumeCheckoutReturn } from "../../src/lib/auth-return.js";
import { reportPurchase } from "../../src/lib/purchase.js";
import { installBrowser } from "../helpers/browser-stub.js";
import type { StripePool } from "../../server/stripe-entitlement.js";

const stripeMock = vi.hoisted(() => ({
  retrieve: vi.fn(),
}));

vi.mock("stripe", () => {
  class Stripe {
    checkout = {
      sessions: {
        retrieve: stripeMock.retrieve,
        create: vi.fn(),
        listLineItems: vi.fn(),
      },
    };
    customers = { create: vi.fn() };
    billingPortal = { sessions: { create: vi.fn() } };
    subscriptions = { list: vi.fn(async () => ({ data: [] as { status: string }[] })) };
    webhooks = { constructEvent: vi.fn() };
  }
  return { default: Stripe };
});

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_checkout_confirm";

const { stripeRouter } = await import("../../server/routes/stripe.js");

const customers = new Map<string, string | null>([
  ["user_a", "cus_a"],
  ["user_b", "cus_b"],
]);

function memoryPool(): StripePool {
  const query: StripePool["query"] = async <T>(_sql: string, values?: unknown[]) => {
    const steamId = typeof values?.[0] === "string" ? values[0] : "";
    if (!customers.has(steamId)) return { rows: [] as T[], rowCount: 0 };
    const row = { stripe_customer_id: customers.get(steamId) ?? null };
    return { rows: [row] as T[], rowCount: 1 };
  };
  return {
    query,
    async connect() {
      return { query, release() {} };
    },
  };
}

function paidSession(customer: string | { id: string }, id = "cs_paid") {
  return {
    id,
    customer,
    payment_status: "paid" as const,
    amount_total: 699,
    currency: "usd",
  };
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const steamId = req.header("x-test-user");
    if (steamId) {
      req.user = {
        steam_id: steamId,
        display_name: "Tester",
        avatar_url: "",
        tier: "free",
        is_admin: false,
      };
    }
    next();
  });
  app.use(stripeRouter(memoryPool()));
  return app;
}

const app = createApp();

function runStrip(href: string) {
  const url = new URL(href);
  const location = {
    href: url.href,
    origin: url.origin,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
  };
  const replaced: string[] = [];
  const history = {
    state: null,
    replaceState(_state: unknown, _title: string, next: string) {
      replaced.push(next);
    },
  };
  const window: { __tubCheckoutReturn?: { upgraded: string | null; sessionId: string | null } } = {};
  vm.runInNewContext(AUTH_RETURN_STRIP_SOURCE, { window, location, history, URLSearchParams });
  return { checkout: window.__tubCheckoutReturn, replaced };
}

let gtag: Mock<NonNullable<typeof globalThis.gtag>>;

function purchaseCalls() {
  return gtag.mock.calls.filter((call) => call[1] === "purchase");
}

function installApi(actor: string | null) {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = raw.startsWith("http") ? new URL(raw).pathname : raw;
    const req = request(app).get(path);
    if (actor) req.set("x-test-user", actor);
    const res = await req;
    return new Response(JSON.stringify(res.body), {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  }));
}

beforeEach(() => {
  gtag = vi.fn<NonNullable<typeof globalThis.gtag>>();
  globalThis.gtag = gtag;
  globalThis.fbq = vi.fn();
  stripeMock.retrieve.mockReset();
  stripeMock.retrieve.mockResolvedValue(paidSession("cus_a"));
  installBrowser({ pathname: "/", search: "" });
});

afterEach(() => {
  globalThis.gtag = undefined;
  globalThis.fbq = undefined;
  globalThis.tubTracking = undefined;
  vi.unstubAllGlobals();
});

describe("GET /api/checkout-session/:id", () => {
  it("rejects a guest before reading Stripe", async () => {
    const res = await request(app).get("/api/checkout-session/cs_fake_anything");
    expect(res.status).toBe(401);
    expect(stripeMock.retrieve).not.toHaveBeenCalled();
  });

  it("hides a session the signed-in user does not own with the same 404 as an unknown id", async () => {
    stripeMock.retrieve.mockRejectedValueOnce(new Error("No such checkout.session"));
    const unknown = await request(app).get("/api/checkout-session/cs_missing").set("x-test-user", "user_a");
    stripeMock.retrieve.mockResolvedValue(paidSession("cus_a", "cs_fake_anything"));
    const unowned = await request(app).get("/api/checkout-session/cs_fake_anything").set("x-test-user", "user_b");
    expect(unknown.status).toBe(404);
    expect(unowned.status).toBe(404);
    expect(unowned.body).toEqual({ error: "Checkout session not found" });
    expect(unowned.body).toEqual(unknown.body);
  });

  it("rejects an owned session that is not paid", async () => {
    stripeMock.retrieve.mockResolvedValue({ ...paidSession("cus_a"), payment_status: "unpaid" });
    const res = await request(app).get("/api/checkout-session/cs_paid").set("x-test-user", "user_a");
    expect(res.status).toBe(409);
  });

  it("confirms a paid session for the owning customer, including an expanded customer", async () => {
    stripeMock.retrieve.mockResolvedValue({ ...paidSession("cus_a"), customer: { id: "cus_a" } });
    const res = await request(app).get("/api/checkout-session/cs_paid").set("x-test-user", "user_a");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ transaction_id: "cs_paid", value: 6.99, currency: "USD" });
  });
});

describe("Stripe return purchase accuracy", () => {
  it("a guest page load with a fake session_id fires nothing and strips the query", async () => {
    const stripped = runStrip("https://tradeupbot.app/?upgraded=1&session_id=cs_fake_anything");
    expect(stripped.checkout).toEqual({ upgraded: "1", sessionId: "cs_fake_anything" });
    expect(stripped.replaced).toEqual(["/"]);
    installApi(null);
    window.__tubCheckoutReturn = stripped.checkout;
    const handoff = consumeCheckoutReturn();
    expect(handoff).toEqual({ upgraded: "1", sessionId: "cs_fake_anything" });
    await reportPurchase(handoff!.upgraded, handoff!.sessionId);
    expect(purchaseCalls()).toEqual([]);
    expect(stripeMock.retrieve).not.toHaveBeenCalled();
  });

  it("a signed-in user who does not own the session fires nothing", async () => {
    installApi("user_b");
    stripeMock.retrieve.mockResolvedValue(paidSession("cus_a", "cs_fake_anything"));
    await reportPurchase("1", "cs_fake_anything");
    expect(purchaseCalls()).toEqual([]);
  });

  it("a valid paid session fires exactly once", async () => {
    installApi("user_a");
    stripeMock.retrieve.mockResolvedValue(paidSession("cus_a", "cs_paid"));
    await reportPurchase("pro", "cs_paid");
    await reportPurchase("pro", "cs_paid");
    expect(purchaseCalls()).toHaveLength(1);
    expect(purchaseCalls()[0]?.[2]).toMatchObject({
      transaction_id: "cs_paid",
      value: 6.99,
      currency: "USD",
    });
  });

  it("a reload of the same session_id fires nothing", async () => {
    installApi("user_a");
    stripeMock.retrieve.mockResolvedValue(paidSession("cus_a", "cs_paid"));
    await reportPurchase("pro", "cs_paid");
    expect(purchaseCalls()).toHaveLength(1);

    window.__tubCheckoutReturn = { upgraded: "pro", sessionId: "cs_paid" };
    const again = consumeCheckoutReturn();
    expect(again).toEqual({ upgraded: "pro", sessionId: "cs_paid" });
    await reportPurchase(again!.upgraded, again!.sessionId);
    expect(purchaseCalls()).toHaveLength(1);
    expect(stripeMock.retrieve).toHaveBeenCalledTimes(1);
  });

  it("does not fire when a 200 body is not a confirmed checkout", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ error: "Login required" }), { status: 200 })));
    await reportPurchase("1", "cs_fake_anything");
    expect(purchaseCalls()).toEqual([]);
    expect(window.localStorage.getItem("tub_purchase_cs_fake_anything")).toBeNull();
  });
});
