import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  ATTRIBUTION_URL_PARAMS,
  META_EVENTS,
  PLAN_PRICE_CENTS,
  centsToUsd,
  fbcFromFbclid,
  isValidDomainVerification,
  isValidGa4MeasurementId,
  isValidMetaPixelId,
  purchaseEventId,
  sanitizeAttribution,
  trackedPlan,
} from "../../shared/tracking.js";

describe("trackedPlan", () => {
  it("maps checkout plan ids to the spec plan names", () => {
    expect(trackedPlan("pro")).toBe("pro_monthly");
    expect(trackedPlan("pro-yearly")).toBe("yearly");
    expect(trackedPlan("pro-lifetime")).toBe("lifetime");
  });

  it("accepts spec plan names unchanged", () => {
    expect(trackedPlan("pro_monthly")).toBe("pro_monthly");
    expect(trackedPlan("yearly")).toBe("yearly");
    expect(trackedPlan("lifetime")).toBe("lifetime");
  });

  it("returns null for anything else", () => {
    expect(trackedPlan("basic")).toBeNull();
    expect(trackedPlan("")).toBeNull();
    expect(trackedPlan(undefined)).toBeNull();
    expect(trackedPlan(42)).toBeNull();
  });
});

describe("plan prices", () => {
  it("stores list prices as integer cents and matches the signed spec in USD", () => {
    for (const cents of Object.values(PLAN_PRICE_CENTS)) expect(Number.isInteger(cents)).toBe(true);
    expect(centsToUsd(PLAN_PRICE_CENTS.pro_monthly)).toBe(6.99);
    expect(centsToUsd(PLAN_PRICE_CENTS.yearly)).toBe(59.99);
    expect(centsToUsd(PLAN_PRICE_CENTS.lifetime)).toBe(74.99);
  });

  it("centsToUsd round-trips any integer cent amount", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 10_000_000 }), (cents) => {
      expect(Math.round(centsToUsd(cents) * 100)).toBe(cents);
    }));
  });
});

describe("purchaseEventId", () => {
  it("is deterministic per checkout session so the Pixel and CAPI share it", () => {
    expect(purchaseEventId("cs_test_123")).toBe("purchase_cs_test_123");
    expect(purchaseEventId("cs_test_123")).toBe(purchaseEventId("cs_test_123"));
    expect(purchaseEventId("cs_a")).not.toBe(purchaseEventId("cs_b"));
  });
});

describe("META_EVENTS", () => {
  it("maps checkout_start and purchase to Meta standard events and the rest to custom events", () => {
    expect(META_EVENTS.checkout_start).toEqual({ kind: "standard", name: "InitiateCheckout" });
    expect(META_EVENTS.purchase).toEqual({ kind: "standard", name: "Purchase" });
    expect(META_EVENTS.calculator_complete.kind).toBe("custom");
    expect(META_EVENTS.trade_up_detail_open.kind).toBe("custom");
    expect(META_EVENTS.verify_click.kind).toBe("custom");
  });

  it("uses custom event names Meta accepts (letters, digits, underscores, <= 50 chars)", () => {
    for (const { name } of Object.values(META_EVENTS)) expect(name).toMatch(/^[A-Za-z0-9_]{1,50}$/);
  });
});

describe("sanitizeAttribution", () => {
  it("keeps only whitelisted string keys", () => {
    expect(sanitizeAttribution({
      utm_source: "meta",
      utm_medium: "paid_social",
      gclid: "abc",
      fbp: "fb.1.1.2",
      email: "x@example.com",
      nested: { a: 1 },
      utm_term: 5,
    })).toEqual({ utm_source: "meta", utm_medium: "paid_social", gclid: "abc", fbp: "fb.1.1.2" });
  });

  it("trims, strips control characters, drops empties, and caps length", () => {
    const out = sanitizeAttribution({ utm_campaign: "  tu_w1\u0000_meta \n", utm_content: "   ", utm_term: "x".repeat(900) });
    expect(out.utm_campaign).toBe("tu_w1_meta");
    expect(out.utm_content).toBeUndefined();
    expect(out.utm_term?.length).toBe(200);
  });

  it("returns an empty object for non-objects", () => {
    expect(sanitizeAttribution(null)).toEqual({});
    expect(sanitizeAttribution("utm_source=x")).toEqual({});
    expect(sanitizeAttribution(["a"])).toEqual({});
  });

  it("never emits values over the Stripe metadata limit", () => {
    fc.assert(fc.property(fc.dictionary(fc.constantFrom(...ATTRIBUTION_URL_PARAMS), fc.string({ maxLength: 2000 })), (input) => {
      for (const value of Object.values(sanitizeAttribution(input))) expect(value.length).toBeLessThanOrEqual(200);
    }));
  });
});

describe("fbcFromFbclid", () => {
  it("builds Meta's fb.1.<ms>.<fbclid> format", () => {
    expect(fbcFromFbclid("IwAR123", 1_700_000_000_000)).toBe("fb.1.1700000000000.IwAR123");
  });
});

describe("ID validators", () => {
  it("accepts well-formed ids and rejects anything that could break out of HTML", () => {
    expect(isValidGa4MeasurementId("G-EKWRB4FE37")).toBe(true);
    expect(isValidGa4MeasurementId("UA-123-1")).toBe(false);
    expect(isValidGa4MeasurementId("G-ABC'</script>")).toBe(false);
    expect(isValidMetaPixelId("123456789012345")).toBe(true);
    expect(isValidMetaPixelId("12ab")).toBe(false);
    expect(isValidDomainVerification("abcdef0123456789abcdef01234567")).toBe(true);
    expect(isValidDomainVerification("a\" onload=\"x")).toBe(false);
    expect(isValidGa4MeasurementId(undefined)).toBe(false);
    expect(isValidMetaPixelId("")).toBe(false);
  });
});
