import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import {
  collectionSlugFromPath,
  trackCalculatorComplete,
  checkoutAttributionBody,
  trackBeginCheckout,
  trackPricingView,
  trackAuthReturn,
  trackSteamContinue,
  trackPurchaseComplete,
  trackSpaPageView,
  shouldTrackSpaPageView,
  trackTradeUpDetailOpen,
  trackVerifyClick,
  trackClaimTradeUp,
  trackVerifyComplete,
  trackCtaClick,
  trackUpgradeCta,
  readActivationSurface,
} from "../../src/lib/conversions.js";
import { captureAttributionFromUrl } from "../../src/lib/attribution.js";
import { installBrowser, navigate } from "../helpers/browser-stub.js";
import { purchaseEventId } from "../../shared/tracking.js";
import { reportReturnLogin } from "../../src/lib/auth-return.js";

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
    expect(checkoutAttributionBody()).toBeNull();
    trackBeginCheckout("pro", 6.99);
    expect(gtag.mock.calls).toEqual([["event", "begin_checkout", { item_name: "pro" }]]);
  });

  it("trade-up page keeps the legacy tradeup_view event", () => {
    trackTradeUpDetailOpen({ collectionSlug: null, legacyTradeUpId: 42 });
    expect(gtag.mock.calls).toEqual([["event", "tradeup_view", { tradeup_id: "42" }]]);
  });

  it("new-only hooks stay silent", () => {
    trackTradeUpDetailOpen({ collectionSlug: "dreams-nightmares" });
    trackCalculatorComplete("custom");
    trackVerifyClick("pro");
    trackCtaClick("home_hero_calculator");
    trackUpgradeCta("landing_plan_tile");
    trackClaimTradeUp({ surface: "share", tradeUpId: 1 });
    const silentResult = {
      all_active: true,
      inputs: [{ status: "active", listing_id: "listing-1", current_price: 100, original_price: 90 }],
      steam_id: "76561198000000000",
      email: "person@example.com",
    };
    trackVerifyComplete({ surface: "account", tradeUpId: 1, result: silentResult });
    expect(gtag).not.toHaveBeenCalled();
    expect(fbq).not.toHaveBeenCalled();
  });

  it("does not keep UTMs or fire calculator_complete while tracking is unset", () => {
    const browser = installBrowser({
      pathname: "/",
      search: "?utm_source=google&utm_medium=cpc&utm_campaign=tu_w1_search_calc&utm_matchtype=e&gclid=Cj0K",
    });
    captureAttributionFromUrl();
    navigate(browser, "/calculator", "");
    trackCalculatorComplete("custom");
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
    trackBeginCheckout("pro", 6.99);
    trackCalculatorComplete("custom");
    trackTradeUpDetailOpen({ collectionSlug: null });
    trackVerifyClick("pro");
    trackPurchaseComplete({ ...purchaseArgs, ga4ServerSide: false });
    expect(fbq).not.toHaveBeenCalled();
  });
});

describe("GA4 events (GA4_MEASUREMENT_ID set)", () => {
  beforeEach(() => {
    globalThis.tubTracking = { ga4MeasurementId: GA4 };
  });

  it("begin_checkout carries plan, price_usd, and the landing attribution", () => {
    installBrowser({ pathname: "/calculator", search: "?utm_source=google&utm_medium=cpc&utm_campaign=tu_w1_search_calc&utm_term=trade+up&gclid=Cj0K" });
    captureAttributionFromUrl();
    const body = checkoutAttributionBody();
    trackBeginCheckout("pro-yearly", 59.99);
    expect(gtag.mock.calls).toEqual([["event", "begin_checkout", {
      currency: "USD",
      value: 59.99,
      items: [{ item_id: "yearly", item_name: "yearly", price: 59.99, quantity: 1 }],
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
    trackCalculatorComplete("custom");
    expect(gtag).toHaveBeenCalledWith("event", "calculator_complete", {
      page_path: "/calculator",
      source: "custom",
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
    trackCalculatorComplete("custom");
    expect(gtag).toHaveBeenCalledWith("event", "calculator_complete", {
      page_path: "/calculator",
      source: "custom",
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
    trackCalculatorComplete("custom");
    installBrowser({ pathname: "/trade-ups/42" });
    trackVerifyClick("pro");
    expect(gtag.mock.calls).toEqual([
      ["event", "calculator_complete", { page_path: "/calculator", source: "custom", send_to: GA4 }],
      ["event", "verify_click", { page_path: "/trade-ups/42", surface: "pro", send_to: GA4 }],
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
      transaction_id: "cs_test_123",
      value: 6.99,
      currency: "USD",
      items: [{ item_id: "pro_monthly", item_name: "pro_monthly", price: 6.99, quantity: 1 }],
      plan: "pro_monthly",
      price_usd: 6.99,
      send_to: GA4,
    }]]);
  });

  it("purchase is skipped client-side when the Measurement Protocol already sends it", () => {
    installBrowser({ pathname: "/" });
    trackPurchaseComplete({ ...purchaseArgs, ga4ServerSide: true });
    expect(gtag).not.toHaveBeenCalled();
  });

  it("sign_up and login include page_path and are not the only events named as key events", () => {
    installBrowser({ pathname: "/trade-ups/42" });
    trackAuthReturn("sign_up", "reg_abc");
    trackAuthReturn("login", null);
    expect(gtag.mock.calls).toEqual([
      ["event", "sign_up", { method: "steam", page_path: "/trade-ups/42", send_to: GA4 }],
      ["event", "login", { method: "steam", page_path: "/trade-ups/42", send_to: GA4 }],
    ]);
  });

  it("cta_click names the hero calculator and carries no prices or ids", () => {
    installBrowser({ pathname: "/" });
    trackCtaClick("home_hero_calculator");
    expect(gtag.mock.calls).toEqual([
      ["event", "cta_click", { cta: "home_hero_calculator", page_path: "/", send_to: GA4 }],
    ]);
    const params = gtag.mock.calls[0][2] as Record<string, unknown>;
    expect(params).not.toHaveProperty("value");
    expect(params).not.toHaveProperty("listing_id");
    expect(params).not.toHaveProperty("price");
  });

  it("cta_click names the detail collection link and carries no prices or ids", () => {
    installBrowser({ pathname: "/trade-ups/42" });
    trackCtaClick("detail_collection");
    expect(gtag.mock.calls).toEqual([
      ["event", "cta_click", { cta: "detail_collection", page_path: "/trade-ups/42", send_to: GA4 }],
    ]);
    const params = gtag.mock.calls[0][2] as Record<string, unknown>;
    expect(params).not.toHaveProperty("value");
    expect(params).not.toHaveProperty("listing_id");
    expect(params).not.toHaveProperty("price");
  });

  it("upgrade_cta_click names the board claim control and carries no prices or ids", () => {
    installBrowser({ pathname: "/trade-ups" });
    trackUpgradeCta("board_claim");
    expect(gtag.mock.calls).toEqual([
      ["event", "upgrade_cta_click", { cta: "board_claim", page_path: "/trade-ups", send_to: GA4 }],
    ]);
    expect(fbq).not.toHaveBeenCalled();
    const params = gtag.mock.calls[0][2] as Record<string, unknown>;
    expect(params).not.toHaveProperty("value");
    expect(params).not.toHaveProperty("price");
    expect(params).not.toHaveProperty("listing_id");
  });

  it("reads board as a claim surface and rejects anything outside the spec", () => {
    expect(readActivationSurface("share")).toBe("share");
    expect(readActivationSurface("account")).toBe("account");
    expect(readActivationSurface("board")).toBe("board");
    expect(readActivationSurface("pricing")).toBeNull();
    expect(readActivationSurface(null)).toBeNull();
  });

  it("cta_click no-ops when gtag has not loaded", () => {
    globalThis.gtag = undefined;
    installBrowser({ pathname: "/" });
    expect(() => trackCtaClick("home_hero_calculator")).not.toThrow();
  });

  it("upgrade_cta_click names the control and carries no prices or ids", () => {
    installBrowser({ pathname: "/trade-ups/42" });
    trackUpgradeCta("share_bar");
    trackUpgradeCta("landing_plan_tile");
    trackUpgradeCta("nav_pricing");
    expect(gtag.mock.calls).toEqual([
      ["event", "upgrade_cta_click", { cta: "share_bar", page_path: "/trade-ups/42", send_to: GA4 }],
      ["event", "upgrade_cta_click", { cta: "landing_plan_tile", page_path: "/trade-ups/42", send_to: GA4 }],
      ["event", "upgrade_cta_click", { cta: "nav_pricing", page_path: "/trade-ups/42", send_to: GA4 }],
    ]);
    for (const call of gtag.mock.calls) {
      const params = call[2] as Record<string, unknown>;
      expect(params).not.toHaveProperty("value");
      expect(params).not.toHaveProperty("price");
      expect(params).not.toHaveProperty("listing_id");
    }
    expect(fbq).not.toHaveBeenCalled();
  });

  it("upgrade_cta_click stays off the pixel even when a pixel id is set", () => {
    globalThis.tubTracking = { ga4MeasurementId: GA4, metaPixelId: PIXEL };
    installBrowser({ pathname: "/" });
    trackUpgradeCta("nav_pricing");
    expect(gtag.mock.calls).toEqual([
      ["event", "upgrade_cta_click", { cta: "nav_pricing", page_path: "/", send_to: GA4 }],
    ]);
    expect(fbq).not.toHaveBeenCalled();
  });

  it("upgrade_cta_click no-ops without a measurement id and does not throw when gtag is blocked", () => {
    globalThis.tubTracking = undefined;
    installBrowser({ pathname: "/" });
    trackUpgradeCta("landing_plan_tile");
    expect(gtag).not.toHaveBeenCalled();
    globalThis.tubTracking = { ga4MeasurementId: GA4 };
    globalThis.gtag = () => { throw new Error("blocked"); };
    expect(() => trackUpgradeCta("share_bar")).not.toThrow();
  });

  it("does not throw when gtag is blocked", () => {
    globalThis.gtag = undefined;
    installBrowser({ pathname: "/calculator" });
    expect(() => trackCalculatorComplete("custom")).not.toThrow();
    expect(() => {
      trackClaimTradeUp({ surface: "share", tradeUpId: 8112 });
      trackVerifyComplete({ surface: "account", tradeUpId: 8112, result: { all_active: true } });
    }).not.toThrow();
    globalThis.gtag = () => { throw new Error("blocked"); };
    expect(() => trackClaimTradeUp({ surface: "share", tradeUpId: 8114 })).not.toThrow();
  });
});

describe("claim_trade_up and verify_complete", () => {
  const forbidden = ["steam_id", "email", "listing_id", "listing_ids", "price", "price_cents", "current_price", "original_price", "value", "skin_name"];

  function expectNoForbiddenFields(): void {
    for (const call of gtag.mock.calls) {
      const params = call[2] as Record<string, unknown>;
      for (const key of forbidden) expect(params).not.toHaveProperty(key);
    }
    expect(JSON.stringify(gtag.mock.calls)).not.toMatch(/steam_id|listing_id|@example|current_price|original_price|price_cents/);
    expect(fbq).not.toHaveBeenCalled();
  }

  it("fires each success event once with page_path, surface, trade_up_id, and send_to", () => {
    globalThis.tubTracking = { ga4MeasurementId: GA4 };
    installBrowser({ pathname: "/trade-ups/8101" });
    trackClaimTradeUp({ surface: "share", tradeUpId: 8101 });
    installBrowser({ pathname: "/my-trade-ups" });
    trackVerifyComplete({
      surface: "account",
      tradeUpId: "8102",
      result: { all_active: false, inputs: [{ status: "active" }, { status: "sold" }] },
    });
    expect(gtag).toHaveBeenCalledTimes(2);
    expect(gtag.mock.calls).toEqual([
      ["event", "claim_trade_up", {
        page_path: "/trade-ups/8101",
        surface: "share",
        trade_up_id: "8101",
        send_to: GA4,
      }],
      ["event", "verify_complete", {
        page_path: "/my-trade-ups",
        surface: "account",
        trade_up_id: "8102",
        status: "partial",
        send_to: GA4,
      }],
    ]);
    expectNoForbiddenFields();
  });

  it("derives all_active and stale from the verify payload and drops listing and price fields", () => {
    globalThis.tubTracking = { ga4MeasurementId: GA4, metaPixelId: PIXEL };
    installBrowser({ pathname: "/trade-ups/8103" });
    const activeWithPrices = {
      all_active: true,
      any_price_changed: true,
      steam_id: "76561198000000000",
      email: "person@example.com",
      inputs: [{
        status: "active",
        listing_id: "csfloat-99",
        skin_name: "AK-47 | Redline",
        current_price: 1234,
        original_price: 1000,
      }],
    };
    const allGone = {
      all_active: false,
      inputs: [
        { status: "theoretical", listing_id: "theor-1" },
        { status: "sold", listing_id: "csfloat-1", original_price: 50 },
        { status: "delisted", listing_id: "csfloat-2", original_price: 75 },
      ],
    };
    const errored = { all_active: false, inputs: [{ status: "error", listing_id: "csfloat-3" }] };
    trackVerifyComplete({ surface: "share", tradeUpId: 8103, result: activeWithPrices });
    trackVerifyComplete({ surface: "share", tradeUpId: 8108, result: allGone });
    trackVerifyComplete({ surface: "account", tradeUpId: 8109, result: errored });
    expect(gtag.mock.calls.map((call) => [call[1], (call[2] as { status?: string }).status])).toEqual([
      ["verify_complete", "all_active"],
      ["verify_complete", "stale"],
      ["verify_complete", "partial"],
    ]);
    expect(Object.keys(gtag.mock.calls[0][2] as object).sort()).toEqual(
      ["page_path", "send_to", "status", "surface", "trade_up_id"],
    );
    expectNoForbiddenFields();
  });

  it("does not emit a second event for the same event and trade_up_id", () => {
    globalThis.tubTracking = { ga4MeasurementId: GA4 };
    installBrowser({ pathname: "/trade-ups/8105" });
    trackClaimTradeUp({ surface: "share", tradeUpId: "8105" });
    trackClaimTradeUp({ surface: "account", tradeUpId: 8105 });
    trackVerifyComplete({
      surface: "share",
      tradeUpId: 8106,
      result: { all_active: true, inputs: [{ status: "active" }] },
    });
    trackVerifyComplete({
      surface: "account",
      tradeUpId: "8106",
      result: { all_active: false, inputs: [{ status: "sold" }] },
    });
    trackClaimTradeUp({ surface: "account", tradeUpId: 8110 });
    const claims = gtag.mock.calls.filter((call) => call[1] === "claim_trade_up");
    const verifies = gtag.mock.calls.filter((call) => call[1] === "verify_complete");
    expect(claims).toHaveLength(2);
    expect(claims.map((call) => (call[2] as { trade_up_id: string }).trade_up_id)).toEqual(["8105", "8110"]);
    expect(verifies).toHaveLength(1);
    expect(verifies[0]?.[2]).toMatchObject({ trade_up_id: "8106", status: "all_active", surface: "share" });
    trackClaimTradeUp({ surface: "board", tradeUpId: 8201 });
    expect(gtag.mock.calls.filter((call) => call[1] === "claim_trade_up" && (call[2] as { surface?: string }).surface === "board")).toEqual([[
      "event",
      "claim_trade_up",
      expect.objectContaining({ surface: "board", trade_up_id: "8201", send_to: GA4 }),
    ]]);
  });

  it("stays a no-op while GA4 is unset or gtag is missing, then fires once the tracker is available", () => {
    installBrowser({ pathname: "/trade-ups/8111" });
    trackClaimTradeUp({ surface: "share", tradeUpId: 8111 });
    trackVerifyComplete({ surface: "account", tradeUpId: 8111, result: { all_active: true } });
    expect(gtag).not.toHaveBeenCalled();

    globalThis.tubTracking = { ga4MeasurementId: GA4, metaPixelId: PIXEL };
    globalThis.gtag = undefined;
    expect(() => {
      trackClaimTradeUp({ surface: "share", tradeUpId: 8111 });
      trackVerifyComplete({ surface: "share", tradeUpId: 8113, result: { all_active: false, inputs: [{ status: "sold" }] } });
    }).not.toThrow();
    expect(fbq).not.toHaveBeenCalled();

    globalThis.gtag = gtag;
    trackClaimTradeUp({ surface: "account", tradeUpId: 8111 });
    trackVerifyComplete({ surface: "share", tradeUpId: 8113, result: { all_active: false, inputs: [{ status: "sold" }] } });
    expect(gtag.mock.calls).toEqual([
      ["event", "claim_trade_up", {
        page_path: "/trade-ups/8111",
        surface: "account",
        trade_up_id: "8111",
        send_to: GA4,
      }],
      ["event", "verify_complete", {
        page_path: "/trade-ups/8111",
        surface: "share",
        trade_up_id: "8113",
        status: "stale",
        send_to: GA4,
      }],
    ]);
    expect(fbq).not.toHaveBeenCalled();
  });
});

describe("Meta Pixel events (META_PIXEL_ID set)", () => {
  beforeEach(() => {
    globalThis.tubTracking = { metaPixelId: PIXEL };
  });

  it("begin_checkout maps to InitiateCheckout with value in USD", () => {
    installBrowser({ pathname: "/pricing", search: "?utm_source=meta&utm_medium=paid_social&fbclid=IwAR1" });
    captureAttributionFromUrl();
    trackBeginCheckout("pro-lifetime", 74.99);
    expect(fbq).toHaveBeenCalledTimes(1);
    const [cmd, name, params, options] = fbq.mock.calls[0];
    expect([cmd, name]).toEqual(["track", "InitiateCheckout"]);
    expect(params).toEqual({
      value: 74.99, currency: "USD", content_name: "lifetime",
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

  it("calculator, detail, and verify events reach the Pixel", () => {
    installBrowser({ pathname: "/calculator" });
    trackCalculatorComplete("custom");
    installBrowser({ pathname: "/collections/dreams-nightmares" });
    trackTradeUpDetailOpen({ collectionSlug: "dreams-nightmares" });
    installBrowser({ pathname: "/trade-ups/42" });
    trackVerifyClick("pro");
    expect(fbq.mock.calls.map(([cmd, name, params]) => [cmd, name, params])).toEqual([
      ["trackCustom", "CalculatorComplete", { page_path: "/calculator", source: "custom" }],
      ["track", "ViewContent", { page_path: "/collections/dreams-nightmares", collection_slug: "dreams-nightmares", content_type: "trade_up" }],
      ["trackCustom", "VerifyClick", { page_path: "/trade-ups/42", surface: "pro" }],
    ]);
  });

  it("GA4 stays on legacy events when only the Pixel is configured", () => {
    installBrowser({ pathname: "/pricing" });
    trackBeginCheckout("pro", 6.99);
    expect(gtag.mock.calls).toEqual([["event", "begin_checkout", { item_name: "pro" }]]);
  });

  it("does not throw when the Pixel is blocked", () => {
    globalThis.fbq = undefined;
    installBrowser({ pathname: "/pricing" });
    expect(() => trackBeginCheckout("pro", 6.99)).not.toThrow();
  });

  it("does not fire Login when the event id is null or undefined", () => {
    installBrowser({ pathname: "/trade-ups" });
    trackAuthReturn("login", null);
    trackAuthReturn("login", undefined);
    expect(fbq).not.toHaveBeenCalled();
  });

  it("sign_up and login share the server event id and omit identity fields", () => {
    installBrowser({ pathname: "/trade-ups" });
    trackAuthReturn("sign_up", "reg_abc");
    trackAuthReturn("login", "login_abc");
    expect(fbq.mock.calls).toEqual([
      ["track", "CompleteRegistration", { status: "complete" }, { eventID: "reg_abc" }],
      ["trackCustom", "Login", { status: "complete" }, { eventID: "login_abc" }],
    ]);
    expect(JSON.stringify(fbq.mock.calls)).not.toMatch(/steam|email|@|display_name/i);
  });

  it("fires one PageView per client navigation and does not add a GA4 page_view", () => {
    installBrowser({ pathname: "/pricing" });
    expect(shouldTrackSpaPageView(null, "/pricing")).toBe(false);
    expect(shouldTrackSpaPageView("/pricing", "/pricing")).toBe(false);
    expect(shouldTrackSpaPageView("/pricing", "/trade-ups")).toBe(true);
    trackSpaPageView();
    trackSpaPageView();
    expect(fbq.mock.calls).toEqual([
      ["track", "PageView"],
      ["track", "PageView"],
    ]);
    expect(gtag).not.toHaveBeenCalled();
  });
});

describe("Meta Pixel with the id unset", () => {
  it("page view and login do not call fbq and do not throw", () => {
    installBrowser({ pathname: "/" });
    expect(() => {
      trackSpaPageView();
      trackAuthReturn("login", "login_abc");
      trackAuthReturn("sign_up", "reg_abc");
    }).not.toThrow();
    expect(fbq).not.toHaveBeenCalled();
  });
});

describe("return sign-in", () => {
  const steamId = "76561198000000000";
  const nonce = "ab".repeat(16);

  it("sends one GA4 login and zero Pixel Logins in a GA4-only build", async () => {
    globalThis.tubTracking = { ga4MeasurementId: GA4 };
    installBrowser({ pathname: "/pricing" });
    await reportReturnLogin(async () => ({ steam_id: steamId }), null);
    expect(gtag.mock.calls.filter((call) => call[1] === "login")).toEqual([
      ["event", "login", { method: "steam", page_path: "/pricing", send_to: GA4 }],
    ]);
    expect(fbq).not.toHaveBeenCalled();
  });

  it("sends one GA4 login and one Pixel Login when the nonce is accepted", async () => {
    globalThis.tubTracking = { ga4MeasurementId: GA4, metaPixelId: PIXEL };
    installBrowser({ pathname: "/pricing" });
    await reportReturnLogin(async () => ({ steam_id: steamId }), nonce, async () => true);
    expect(gtag.mock.calls.filter((call) => call[1] === "login")).toHaveLength(1);
    const pixel = fbq.mock.calls.filter((call) => call[1] === "Login");
    expect(pixel).toHaveLength(1);
    expect(pixel[0][0]).toBe("trackCustom");
    expect(pixel[0][3]?.eventID).toMatch(new RegExp(`^login_[0-9a-f]{64}_${nonce}$`));
  });

  it("still sends GA4 login when auth fails or the nonce is rejected, and no Pixel Login", async () => {
    globalThis.tubTracking = { ga4MeasurementId: GA4, metaPixelId: PIXEL };
    installBrowser({ pathname: "/pricing" });
    await reportReturnLogin(async () => { throw new Error("down"); }, nonce);
    await reportReturnLogin(async () => ({ steam_id: steamId }), nonce, async () => false);
    expect(gtag.mock.calls.filter((call) => call[1] === "login")).toHaveLength(2);
    expect(fbq).not.toHaveBeenCalled();
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
