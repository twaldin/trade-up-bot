import { describe, it, expect, vi, afterEach } from "vitest";
import { trackDiscordCta, trackEvent, trackPurchase } from "../../src/lib/analytics.js";

afterEach(() => {
  globalThis.gtag = undefined;
});

describe("trackEvent", () => {
  it("forwards name + params to gtag when present", () => {
    const spy = vi.fn();
    globalThis.gtag = spy;
    trackEvent("sign_up_start", { location: "nav" });
    expect(spy).toHaveBeenCalledWith("event", "sign_up_start", { location: "nav" });
  });

  it("does not throw when gtag is absent", () => {
    globalThis.gtag = undefined;
    expect(() => trackEvent("calculator_run")).not.toThrow();
  });
});

describe("trackDiscordCta", () => {
  it("fires a click event with site Discord UTM fields", () => {
    const spy = vi.fn();
    globalThis.gtag = spy;
    trackDiscordCta("home");
    expect(spy).toHaveBeenCalledWith("event", "click", {
      utm_source: "site",
      utm_medium: "cta",
      utm_campaign: "discord",
      utm_content: "home",
    });
    trackDiscordCta("footer");
    expect(spy).toHaveBeenCalledWith("event", "click", {
      utm_source: "site",
      utm_medium: "cta",
      utm_campaign: "discord",
      utm_content: "footer",
    });
  });
});

describe("trackPurchase", () => {
  it("emits a GA4 purchase event with verified values", () => {
    const spy = vi.fn();
    globalThis.gtag = spy;
    trackPurchase({ transactionId: "cs_123", value: 6.99, currency: "USD", tier: "pro" });
    expect(spy).toHaveBeenCalledWith("event", "purchase", {
      transaction_id: "cs_123",
      value: 6.99,
      currency: "USD",
      items: 1,
      item_name: "pro",
    });
  });
});
