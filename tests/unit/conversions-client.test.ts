import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import {
  collectionSlugFromPath,
  trackCalculatorComplete,
  trackCheckoutStart,
  trackPurchaseComplete,
  trackTradeUpDetailOpen,
  trackVerifyClick,
} from "../../src/lib/conversions.js";
import { captureAttributionFromUrl } from "../../src/lib/attribution.js";
import { installBrowser, navigate } from "../helpers/browser-stub.js";
import { purchaseEventId } from "../../shared/tracking.js";

const GA4 = "G-NEWPROP123";
const PIXEL = "123456789012345";
const purchaseArgs = { sessionId: "cs_test_123", checkoutPlan: "pro", transactionId: "cs_test_123", value: 6.99, currency: "USD" };

let gtag: Mock<NonNullable<typeof globalThis.gtag>>;
let fbq: Mock<NonNullable<typeof globalThis.fbq>>;

beforeEach(() => {
  gtag = vi.fn<NonNullable<typeof globalThis.gtag>>();
  fbq = vi.fn<NonNullable<typeof globalThis.fbq>>();
  globalThis.gtag = gtag;
  globalThis.fbq = fbq;
  globalThis.tubTracking = undefined;
});

afterEach(() => {
  globalThis.gtag = undefined;
  globalThis.fbq = undefined;
  globalThis.tubTracking = undefined;
  vi.unstubAllGlobals();
});

describe("with every tracking env var unset (production today)", () => {
  beforeEach(() => { installBrowser({ pathname: "/pricing", search: "?utm_source=meta" }); });

  it("checkout keeps the legacy begin_checkout event and sends no extra checkout body", () => {
    expect(trackCheckoutStart("pro")).toBeNull();
    expect(gtag.mock.calls).toEqual([["event", "begin_checkout", { item_name: "pro" }]]);
  });

  it("trade-up page keeps the legacy tradeup_view event", () => {
    trackTradeUpDetailOpen({ collectionSlug: null, legacyTradeUpId: 42 });
    expect(gtag.mock.calls).toEqual([["event", "tradeup_view", { tradeup_id: "42" }]]);
  });

  it("new-only hooks stay silent", () => {
    trackTradeUpDetailOpen({ collectionSlug: "dreams-nightmares" });
    trackCalculatorComplete();
    trackVerifyClick();
    expect(gtag).not.toHaveBeenCalled();
  });

  it("does not keep UTMs or fire calculator_complete while tracking is unset", () => {
    const browser = installBrowser({
      pathname: "/",
      search: "?utm_source=google&utm_medium=cpc&utm_campaign=tu_w1_search_calc&utm_matchtype=e&gclid=Cj0K",
    });
    captureAttributionFromUrl();
    navigate(browser, "/calculator", "");
    trackCalculatorComplete();
    expect(browser.localStorage.data.size).toBe(0);
    expect(gtag).not.toHaveBeenCalled();
    expect(fbq).not.toHaveBeenCalled();
  });

  it("success page keeps the legacy client-side GA4 purchase payload", () => {
    trackPurchaseComplete({ ...purchaseArgs, ga4ServerSide: false });
    expect(gtag.mock.calls).toEqual([["event", "purchase", {
      transaction_id: "cs_test_123", value: 6.99, currency: "USD", items: 1, item_name: "pro",
    }]]);
  });

  it("never calls the Meta Pixel, even if something else defined fbq", () => {
    trackCheckoutStart("pro");
    trackCalculatorComplete();
    trackTradeUpDetailOpen({ collectionSlug: null });
    trackVerifyClick();
    trackPurchaseComplete({ ...purchaseArgs, ga4ServerSide: false });
    expect(fbq).not.toHaveBeenCalled();
  });
});

describe("GA4 key events (GA4_MEASUREMENT_ID set)", () => {
  beforeEach(() => {
    globalThis.tubTracking = { ga4MeasurementId: GA4 };
  });

  it("checkout_start replaces begin_checkout and carries plan, price, and the landing attribution", () => {
    installBrowser({ pathname: "/calculator", search: "?utm_source=google&utm_medium=cpc&utm_campaign=tu_w1_search_calc&utm_term=trade+up&gclid=Cj0K" });
    captureAttributionFromUrl();
    const body = trackCheckoutStart("pro-yearly");
    expect(gtag.mock.calls).toEqual([["event", "checkout_start", {
      plan: "yearly",
      price_usd: 59.99,
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "tu_w1_search_calc",
      utm_term: "trade up",
      gclid: "Cj0K",
      send_to: GA4,
    }]]);
    expect(body?.attribution).toMatchObject({ utm_source: "google", gclid: "Cj0K" });
  });

  it("keeps the Google final-URL suffix when the SPA navigates into /calculator", () => {
    const browser = installBrowser({
      pathname: "/",
      search: "?utm_source=google&utm_medium=cpc&utm_campaign=tu_w1_search_calc&utm_content=adgroup1&utm_term=cs2+trade+up&utm_matchtype=e&gclid=Cj0K",
    });
    captureAttributionFromUrl();
    navigate(browser, "/calculator", "");
    trackCalculatorComplete();
    expect(gtag).toHaveBeenCalledWith("event", "calculator_complete", {
      page_path: "/calculator",
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "tu_w1_search_calc",
      utm_content: "adgroup1",
      utm_term: "cs2 trade up",
      utm_matchtype: "e",
      gclid: "Cj0K",
      send_to: GA4,
    });
  });

  it("calculator_complete keeps the Google final-URL suffix after the SPA drops the query", () => {
    const browser = installBrowser({
      pathname: "/calculator",
      search: "?utm_source=google&utm_medium=cpc&utm_campaign=tu_w1_search_calc&utm_content=adgroup1&utm_term=cs2+trade+up&utm_matchtype=e&gclid=Cj0K",
    });
    captureAttributionFromUrl();
    navigate(browser, "/calculator", "");
    trackCalculatorComplete();
    expect(gtag).toHaveBeenCalledWith("event", "calculator_complete", {
      page_path: "/calculator",
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "tu_w1_search_calc",
      utm_content: "adgroup1",
      utm_term: "cs2 trade up",
      utm_matchtype: "e",
      gclid: "Cj0K",
      send_to: GA4,
    });
  });

  it("calculator_complete and verify_click carry page_path", () => {
    installBrowser({ pathname: "/calculator" });
    trackCalculatorComplete();
    installBrowser({ pathname: "/trade-ups/42" });
    trackVerifyClick();
    expect(gtag.mock.calls).toEqual([
      ["event", "calculator_complete", { page_path: "/calculator", send_to: GA4 }],
      ["event", "verify_click", { page_path: "/trade-ups/42", send_to: GA4 }],
    ]);
  });

  it("trade_up_detail_open replaces tradeup_view and only sets collection_slug inside a collection", () => {
    installBrowser({ pathname: "/trade-ups/collection/dreams-nightmares" });
    trackTradeUpDetailOpen({ collectionSlug: "dreams-nightmares", legacyTradeUpId: 42 });
    installBrowser({ pathname: "/trade-ups" });
    trackTradeUpDetailOpen({ collectionSlug: null });
    expect(gtag.mock.calls).toEqual([
      ["event", "trade_up_detail_open", { page_path: "/trade-ups/collection/dreams-nightmares", collection_slug: "dreams-nightmares", send_to: GA4 }],
      ["event", "trade_up_detail_open", { page_path: "/trade-ups", send_to: GA4 }],
    ]);
  });

  it("purchase fires once client-side with plan and price when the server is not sending it", () => {
    installBrowser({ pathname: "/" });
    trackPurchaseComplete({ ...purchaseArgs, ga4ServerSide: false });
    expect(gtag.mock.calls).toEqual([["event", "purchase", {
      transaction_id: "cs_test_123", value: 6.99, currency: "USD", plan: "pro_monthly", price_usd: 6.99, send_to: GA4,
    }]]);
  });

  it("purchase is skipped client-side when the Measurement Protocol already sends it", () => {
    installBrowser({ pathname: "/" });
    trackPurchaseComplete({ ...purchaseArgs, ga4ServerSide: true });
    expect(gtag).not.toHaveBeenCalled();
  });

  it("does not throw when gtag is blocked", () => {
    globalThis.gtag = undefined;
    installBrowser({ pathname: "/calculator" });
    expect(() => trackCalculatorComplete()).not.toThrow();
  });
});

describe("Meta Pixel events (META_PIXEL_ID set)", () => {
  beforeEach(() => {
    globalThis.tubTracking = { metaPixelId: PIXEL };
  });

  it("checkout_start maps to InitiateCheckout with value in USD", () => {
    installBrowser({ pathname: "/pricing", search: "?utm_source=meta&utm_medium=paid_social&fbclid=IwAR1" });
    captureAttributionFromUrl();
    trackCheckoutStart("pro-lifetime");
    expect(fbq).toHaveBeenCalledTimes(1);
    const [cmd, name, params, options] = fbq.mock.calls[0];
    expect([cmd, name]).toEqual(["track", "InitiateCheckout"]);
    expect(params).toEqual({
      value: 74.99, currency: "USD", content_name: "lifetime", plan: "lifetime", price_usd: 74.99,
      utm_source: "meta", utm_medium: "paid_social", fbclid: "IwAR1",
    });
    expect(options?.eventID).toMatch(/^checkout_[0-9a-f-]{36}$/);
  });

  it("purchase maps to Purchase with the same event id the server sends to CAPI", () => {
    installBrowser({ pathname: "/" });
    trackPurchaseComplete({ ...purchaseArgs, ga4ServerSide: true });
    expect(fbq.mock.calls).toEqual([[
      "track", "Purchase",
      { value: 6.99, currency: "USD", content_name: "pro_monthly", plan: "pro_monthly", price_usd: 6.99 },
      { eventID: purchaseEventId("cs_test_123") },
    ]]);
  });

  it("the other key events are custom events", () => {
    installBrowser({ pathname: "/calculator" });
    trackCalculatorComplete();
    installBrowser({ pathname: "/collections/dreams-nightmares" });
    trackTradeUpDetailOpen({ collectionSlug: "dreams-nightmares" });
    installBrowser({ pathname: "/trade-ups/42" });
    trackVerifyClick();
    expect(fbq.mock.calls.map(([cmd, name, params]) => [cmd, name, params])).toEqual([
      ["trackCustom", "CalculatorComplete", { page_path: "/calculator" }],
      ["trackCustom", "TradeUpDetailOpen", { page_path: "/collections/dreams-nightmares", collection_slug: "dreams-nightmares" }],
      ["trackCustom", "VerifyClick", { page_path: "/trade-ups/42" }],
    ]);
  });

  it("GA4 stays on legacy events when only the Pixel is configured", () => {
    installBrowser({ pathname: "/pricing" });
    trackCheckoutStart("pro");
    expect(gtag.mock.calls).toEqual([["event", "begin_checkout", { item_name: "pro" }]]);
  });

  it("does not throw when the Pixel is blocked", () => {
    globalThis.fbq = undefined;
    installBrowser({ pathname: "/pricing" });
    expect(() => trackCheckoutStart("pro")).not.toThrow();
  });
});

describe("collectionSlugFromPath", () => {
  it("reads the slug from collection hubs only", () => {
    expect(collectionSlugFromPath("/trade-ups/collection/dreams-nightmares")).toBe("dreams-nightmares");
    expect(collectionSlugFromPath("/collections/the-anubis-collection")).toBe("the-anubis-collection");
    expect(collectionSlugFromPath("/trade-ups")).toBeNull();
    expect(collectionSlugFromPath("/trade-ups/42")).toBeNull();
    expect(collectionSlugFromPath("/collections")).toBeNull();
  });
});
