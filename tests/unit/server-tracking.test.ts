import { describe, it, expect, vi, afterEach } from "vitest";
import {
  checkoutSessionTrackingFields,
  checkoutTrackingMetadata,
  ga4PurchaseRequest,
  hashEmail,
  hashExternalId,
  metaPurchaseRequest,
  purchaseConversionFromSession,
  resolvePurchasePlan,
  sendPurchaseConversions,
  serverTrackingConfig,
  trackCheckoutCompleted,
  trackingCspSources,
  type CheckoutSessionLike,
  type PurchaseConversion,
} from "../../server/tracking.js";
import { purchaseEventId } from "../../shared/tracking.js";

const EMAIL_HASH = "973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b";
const STEAM_HASH = "985fd683729bdfa8da3634d67fd07f89043302cab21c45eca6940e5445c10561";

const FULL_ENV = {
  GA4_MEASUREMENT_ID: "G-NEWPROP123",
  GA4_API_SECRET: "ga4-secret-value",
  META_PIXEL_ID: "123456789012345",
  META_CAPI_TOKEN: "meta-token-value",
};

function session(overrides: Partial<CheckoutSessionLike> = {}): CheckoutSessionLike {
  return {
    id: "cs_test_abc",
    amount_total: 699,
    currency: "usd",
    payment_status: "paid",
    mode: "subscription",
    customer_details: { email: " Test@Example.com " },
    metadata: {
      tub_plan: "pro_monthly",
      tub_xid: STEAM_HASH,
      tub_ua: "Mozilla/5.0 test",
      tub_ip: "203.0.113.7",
      utm_source: "meta",
      utm_medium: "paid_social",
      utm_campaign: "tu_w1_meta_seeda",
      gclid: "gclid-1",
      fbc: "fb.1.1700000000000.IwAR1",
      fbp: "fb.1.1700000000000.99",
      ga_client_id: "111.222",
      ga_session_id: "1700000000",
    },
    ...overrides,
  };
}

function conversion(overrides: Partial<CheckoutSessionLike> = {}): PurchaseConversion {
  const conv = purchaseConversionFromSession(session(overrides), { eventCreatedSec: 1_700_000_100, plan: "pro_monthly" });
  if (!conv) throw new Error("expected a conversion");
  return conv;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("serverTrackingConfig", () => {
  it("is fully disabled when no env var is set", () => {
    expect(serverTrackingConfig({})).toEqual({ ga4Mp: null, metaCapi: null });
  });

  it("needs both the id and the secret for each server-side tracker", () => {
    expect(serverTrackingConfig({ GA4_MEASUREMENT_ID: "G-NEWPROP123" }).ga4Mp).toBeNull();
    expect(serverTrackingConfig({ GA4_API_SECRET: "s" }).ga4Mp).toBeNull();
    expect(serverTrackingConfig({ META_PIXEL_ID: "123456789012345" }).metaCapi).toBeNull();
    expect(serverTrackingConfig({ META_CAPI_TOKEN: "t" }).metaCapi).toBeNull();
    const full = serverTrackingConfig(FULL_ENV);
    expect(full.ga4Mp?.measurementId).toBe("G-NEWPROP123");
    expect(full.metaCapi?.pixelId).toBe("123456789012345");
    expect(full.metaCapi?.testEventCode).toBeNull();
  });

  it("ignores malformed ids", () => {
    expect(serverTrackingConfig({ ...FULL_ENV, GA4_MEASUREMENT_ID: "nope", META_PIXEL_ID: "abc" })).toEqual({ ga4Mp: null, metaCapi: null });
  });

  it("reads the optional QA switches", () => {
    const cfg = serverTrackingConfig({ ...FULL_ENV, META_TEST_EVENT_CODE: "TEST123", GA4_DEBUG_MODE: "1" });
    expect(cfg.metaCapi?.testEventCode).toBe("TEST123");
    expect(cfg.ga4Mp?.debug).toBe(true);
  });
});

describe("hashing (Meta CAPI customer information spec)", () => {
  it("normalizes email (trim + lowercase) before SHA-256", () => {
    expect(hashEmail(" Test@Example.com ")).toBe(EMAIL_HASH);
    expect(hashEmail("")).toBeNull();
    expect(hashEmail(null)).toBeNull();
  });

  it("hashes external ids with SHA-256 hex", () => {
    expect(hashExternalId("76561198000000000")).toBe(STEAM_HASH);
    expect(hashExternalId("  ")).toBeNull();
  });
});

describe("checkoutTrackingMetadata", () => {
  const args = {
    checkoutPlan: "pro-yearly",
    attribution: { utm_source: "google", gclid: "g1", email: "leak@example.com" },
    steamId: "76561198000000000",
    userAgent: "Mozilla/5.0 test",
    ip: "203.0.113.7",
  };

  it("adds no metadata when no server-side tracker is configured", () => {
    expect(checkoutTrackingMetadata({ ...args, config: serverTrackingConfig({}) })).toBeUndefined();
  });

  it("carries plan, hashed external id, request context, and whitelisted attribution", () => {
    const md = checkoutTrackingMetadata({ ...args, config: serverTrackingConfig(FULL_ENV) });
    expect(md).toEqual({
      tub_plan: "yearly",
      tub_xid: STEAM_HASH,
      tub_ua: "Mozilla/5.0 test",
      tub_ip: "203.0.113.7",
      utm_source: "google",
      gclid: "g1",
    });
    expect(JSON.stringify(md)).not.toContain("76561198000000000");
    expect(JSON.stringify(md)).not.toContain("leak@example.com");
  });

  it("keeps every value within Stripe's 500-character metadata limit", () => {
    const md = checkoutTrackingMetadata({ ...args, userAgent: "u".repeat(2000), config: serverTrackingConfig(FULL_ENV) });
    for (const value of Object.values(md ?? {})) expect(value.length).toBeLessThanOrEqual(500);
  });
});

describe("checkoutSessionTrackingFields", () => {
  it("tells the success page to skip its GA4 purchase only when the Measurement Protocol sends it", () => {
    expect(checkoutSessionTrackingFields(serverTrackingConfig({}))).toEqual({});
    expect(checkoutSessionTrackingFields(serverTrackingConfig({ META_PIXEL_ID: "123456789012345", META_CAPI_TOKEN: "t" }))).toEqual({});
    expect(checkoutSessionTrackingFields(serverTrackingConfig(FULL_ENV))).toEqual({ ga4_server_side: true });
  });
});

describe("purchaseConversionFromSession", () => {
  it("returns null unless the session is paid", () => {
    expect(purchaseConversionFromSession(session({ payment_status: "unpaid" }), { eventCreatedSec: 1, plan: "pro_monthly" })).toBeNull();
    expect(purchaseConversionFromSession(session({ payment_status: "no_payment_required" }), { eventCreatedSec: 1, plan: "pro_monthly" })).toBeNull();
  });

  it("uses the shared purchase event id and integer-cent amounts", () => {
    const conv = conversion({ amount_total: 559 });
    expect(conv.eventId).toBe(purchaseEventId("cs_test_abc"));
    expect(conv.valueCents).toBe(559);
    expect(conv.priceCents).toBe(699);
    expect(conv.currency).toBe("USD");
    expect(conv.emailHash).toBe(EMAIL_HASH);
  });
});

describe("resolvePurchasePlan", () => {
  it("prefers the plan stamped at checkout", async () => {
    const list = vi.fn(async () => ["price_x"]);
    expect(await resolvePurchasePlan(session(), list, {})).toBe("pro_monthly");
    expect(list).not.toHaveBeenCalled();
  });

  it("falls back to line-item prices, then to the checkout mode", async () => {
    const env = { STRIPE_PRO_PRICE_ID: "price_m", STRIPE_PRO_YEARLY_PRICE_ID: "price_y", STRIPE_PRO_LIFETIME_PRICE_ID: "price_l" };
    const bare = session({ metadata: null });
    expect(await resolvePurchasePlan(bare, async () => ["price_y"], env)).toBe("yearly");
    expect(await resolvePurchasePlan(bare, async () => ["price_l"], env)).toBe("lifetime");
    expect(await resolvePurchasePlan(bare, async () => { throw new Error("stripe down"); }, env)).toBe("pro_monthly");
    expect(await resolvePurchasePlan(session({ metadata: null, mode: "payment" }), async () => [], env)).toBe("lifetime");
  });
});

describe("metaPurchaseRequest", () => {
  it("builds a website Purchase with hashed user data and the shared event_id", () => {
    const cfg = serverTrackingConfig({ ...FULL_ENV, META_TEST_EVENT_CODE: "TEST123" });
    const req = metaPurchaseRequest(conversion(), cfg.metaCapi!, "https://tradeupbot.app");
    expect(req.url).toBe("https://graph.facebook.com/v24.0/123456789012345/events");
    expect(req.url).not.toContain("meta-token-value");
    expect(req.body).toEqual({
      data: [{
        event_name: "Purchase",
        event_time: 1_700_000_100,
        event_id: "purchase_cs_test_abc",
        action_source: "website",
        event_source_url: "https://tradeupbot.app/",
        user_data: {
          em: [EMAIL_HASH],
          external_id: [STEAM_HASH],
          client_ip_address: "203.0.113.7",
          client_user_agent: "Mozilla/5.0 test",
          fbc: "fb.1.1700000000000.IwAR1",
          fbp: "fb.1.1700000000000.99",
        },
        custom_data: {
          currency: "USD",
          value: 6.99,
          content_name: "pro_monthly",
          plan: "pro_monthly",
          price_usd: 6.99,
          utm_source: "meta",
          utm_medium: "paid_social",
          utm_campaign: "tu_w1_meta_seeda",
          gclid: "gclid-1",
        },
      }],
      access_token: "meta-token-value",
      test_event_code: "TEST123",
    });
  });

  it("never sends a raw email", () => {
    const req = metaPurchaseRequest(conversion(), serverTrackingConfig(FULL_ENV).metaCapi!, "https://tradeupbot.app");
    expect(JSON.stringify(req.body).toLowerCase()).not.toContain("test@example.com");
  });
});

describe("ga4PurchaseRequest", () => {
  it("builds a Measurement Protocol purchase tied to the browser's GA client and session", () => {
    const req = ga4PurchaseRequest(conversion(), serverTrackingConfig(FULL_ENV).ga4Mp!);
    expect(req.url).toBe("https://www.google-analytics.com/mp/collect?measurement_id=G-NEWPROP123&api_secret=ga4-secret-value");
    expect(req.body).toEqual({
      client_id: "111.222",
      timestamp_micros: 1_700_000_100_000_000,
      events: [{
        name: "purchase",
        params: {
          transaction_id: "cs_test_abc",
          value: 6.99,
          currency: "USD",
          plan: "pro_monthly",
          price_usd: 6.99,
          items: [{ item_id: "pro_monthly", item_name: "pro_monthly", price: 6.99, quantity: 1 }],
          session_id: "1700000000",
          engagement_time_msec: 1,
          utm_source: "meta",
          utm_medium: "paid_social",
          utm_campaign: "tu_w1_meta_seeda",
          gclid: "gclid-1",
        },
      }],
    });
  });

  it("still reports revenue with a stable synthetic client id when the GA cookie was missing", () => {
    const md = { ...session().metadata };
    delete md.ga_client_id;
    delete md.ga_session_id;
    const a = ga4PurchaseRequest(conversion({ metadata: md }), serverTrackingConfig(FULL_ENV).ga4Mp!);
    const b = ga4PurchaseRequest(conversion({ metadata: md }), serverTrackingConfig(FULL_ENV).ga4Mp!);
    expect(a.body.client_id).toMatch(/^\d+\.\d+$/);
    expect(a.body.client_id).toBe(b.body.client_id);
    expect(a.body.events[0].params.session_id).toBeUndefined();
  });

  it("flags events for DebugView when GA4_DEBUG_MODE is on", () => {
    const req = ga4PurchaseRequest(conversion(), serverTrackingConfig({ ...FULL_ENV, GA4_DEBUG_MODE: "1" }).ga4Mp!);
    expect(req.body.events[0].params.debug_mode).toBe(true);
  });
});

describe("sendPurchaseConversions", () => {
  it("makes no network call when trackers are unset", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await sendPurchaseConversions(conversion(), serverTrackingConfig({}), { fetchImpl, baseUrl: "https://tradeupbot.app" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toEqual({ meta: "skipped", ga4: "skipped" });
  });

  it("posts to both endpoints when configured", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    const log = vi.fn();
    const result = await sendPurchaseConversions(conversion(), serverTrackingConfig(FULL_ENV), { fetchImpl, baseUrl: "https://tradeupbot.app", log });
    expect(result).toEqual({ meta: "ok", ga4: "ok" });
    const urls = fetchImpl.mock.calls.map(([url]) => String(url));
    expect(urls.some((u) => u.startsWith("https://graph.facebook.com/"))).toBe(true);
    expect(urls.some((u) => u.startsWith("https://www.google-analytics.com/mp/collect"))).toBe(true);
  });

  it("resolves (never rejects) on network errors, HTTP errors, and hangs", async () => {
    const cfg = serverTrackingConfig(FULL_ENV);
    const log = vi.fn();
    const reject = vi.fn<typeof fetch>(async () => { throw new Error("ECONNRESET 203.0.113.7"); });
    await expect(sendPurchaseConversions(conversion(), cfg, { fetchImpl: reject, baseUrl: "https://x", log })).resolves.toEqual({ meta: "error", ga4: "error" });
    const http500 = vi.fn<typeof fetch>(async () => new Response("bad", { status: 500 }));
    await expect(sendPurchaseConversions(conversion(), cfg, { fetchImpl: http500, baseUrl: "https://x", log })).resolves.toEqual({ meta: "http_500", ga4: "http_500" });
    const hang = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));
    await expect(sendPurchaseConversions(conversion(), cfg, { fetchImpl: hang, baseUrl: "https://x", log, timeoutMs: 20 })).resolves.toEqual({ meta: "timeout", ga4: "timeout" });
  });

  it("never logs tokens, secrets, emails, IPs, or hashes", async () => {
    const log = vi.fn();
    const reject = vi.fn<typeof fetch>(async () => { throw new Error("fail for 203.0.113.7 test@example.com"); });
    await sendPurchaseConversions(conversion(), serverTrackingConfig(FULL_ENV), { fetchImpl: reject, baseUrl: "https://x", log });
    const logged = JSON.stringify(log.mock.calls);
    expect(log).toHaveBeenCalled();
    for (const secret of ["meta-token-value", "ga4-secret-value", "test@example.com", "203.0.113.7", EMAIL_HASH, STEAM_HASH, "Mozilla"]) {
      expect(logged).not.toContain(secret);
    }
  });
});

describe("trackCheckoutCompleted", () => {
  it("does nothing (no Stripe call, no fetch) when trackers are unset", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const list = vi.fn(async () => [] as string[]);
    await trackCheckoutCompleted({ session: session(), eventCreatedSec: 1, listLineItemPriceIds: list, env: {}, fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });

  it("skips unpaid sessions", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await trackCheckoutCompleted({ session: session({ payment_status: "unpaid" }), eventCreatedSec: 1, listLineItemPriceIds: async () => [], env: FULL_ENV, fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends a Purchase with the shared event id when configured", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    await trackCheckoutCompleted({ session: session(), eventCreatedSec: 1_700_000_100, listLineItemPriceIds: async () => [], env: FULL_ENV, fetchImpl, log: vi.fn() });
    const metaCall = fetchImpl.mock.calls.find(([url]) => String(url).includes("graph.facebook.com"));
    const body: unknown = JSON.parse(String(metaCall?.[1]?.body));
    expect(JSON.stringify(body)).toContain('"event_id":"purchase_cs_test_abc"');
  });

  it("never throws or rejects, even when its inputs blow up", async () => {
    const bad = {
      session: session(),
      eventCreatedSec: 1,
      listLineItemPriceIds: async () => { throw new Error("stripe"); },
      env: FULL_ENV,
      fetchImpl: vi.fn<typeof fetch>(() => { throw new Error("sync fetch throw"); }),
      log: vi.fn(),
    };
    await expect(trackCheckoutCompleted(bad)).resolves.toBeUndefined();
    const logThrows = { ...bad, log: () => { throw new Error("logger broke"); } };
    await expect(trackCheckoutCompleted(logThrows)).resolves.toBeUndefined();
  });
});

describe("trackingCspSources", () => {
  it("adds nothing when unset", () => {
    expect(trackingCspSources({})).toEqual({ scriptSrc: [], connectSrc: [], imgSrc: [] });
  });

  it("allows Meta Pixel hosts only when META_PIXEL_ID is set", () => {
    const csp = trackingCspSources({ META_PIXEL_ID: "123456789012345" });
    expect(csp.scriptSrc).toContain("https://connect.facebook.net");
    expect(csp.connectSrc).toContain("https://www.facebook.com");
    expect(csp.imgSrc).toContain("https://www.facebook.com");
  });

  it("allows GA4 regional collection hosts only when GA4_MEASUREMENT_ID is set", () => {
    const csp = trackingCspSources({ GA4_MEASUREMENT_ID: "G-NEWPROP123" });
    expect(csp.connectSrc).toContain("https://*.google-analytics.com");
    expect(csp.imgSrc).toContain("https://*.google-analytics.com");
    expect(csp.scriptSrc).toEqual([]);
  });
});
