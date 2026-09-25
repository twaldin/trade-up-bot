import { describe, it, expect, afterEach } from "vitest";
import { vi } from "vitest";
import {
  attributionFromSearch,
  captureAttributionFromUrl,
  checkoutAttribution,
  gaClientIdFromCookie,
  gaSessionIdFromCookie,
  storedAttribution,
} from "../../src/lib/attribution.js";
import { installBrowser, navigate } from "../helpers/browser-stub.js";

const LANDING = "?utm_source=meta&utm_medium=paid_social&utm_campaign=tu_w1_meta_seeda&utm_content=float_vs_avg_static&fbclid=IwAR123";
const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

afterEach(() => {
  globalThis.tubTracking = undefined;
  vi.unstubAllGlobals();
});

describe("attributionFromSearch", () => {
  it("keeps the five UTM params, gclid, and fbclid, and derives fbc from fbclid", () => {
    expect(attributionFromSearch(`${LANDING}&utm_term=float&gclid=Cj0K&ref=creator&other=1`, NOW)).toEqual({
      utm_source: "meta",
      utm_medium: "paid_social",
      utm_campaign: "tu_w1_meta_seeda",
      utm_content: "float_vs_avg_static",
      utm_term: "float",
      gclid: "Cj0K",
      fbclid: "IwAR123",
      fbc: `fb.1.${NOW}.IwAR123`,
    });
  });

  it("keeps utm_matchtype from a Google Ads final URL", () => {
    expect(attributionFromSearch("?utm_source=google&utm_medium=cpc&utm_matchtype=e&gclid=Cj0K", NOW)).toMatchObject({
      utm_source: "google",
      utm_matchtype: "e",
      gclid: "Cj0K",
    });
  });

  it("returns null for an untagged URL", () => {
    expect(attributionFromSearch("", NOW)).toBeNull();
    expect(attributionFromSearch("?ref=creator&page=2", NOW)).toBeNull();
  });
});

describe("captureAttributionFromUrl", () => {
  it("does nothing while no tracker is configured", () => {
    const browser = installBrowser({ search: LANDING });
    captureAttributionFromUrl(NOW);
    expect(browser.localStorage.data.size).toBe(0);
  });

  it("persists the landing params across in-app navigation", () => {
    globalThis.tubTracking = { metaPixelId: "123456789012345" };
    const browser = installBrowser({ search: LANDING, pathname: "/calculator" });
    captureAttributionFromUrl(NOW);
    navigate(browser, "/pricing");
    captureAttributionFromUrl(NOW + 60_000);
    expect(storedAttribution(NOW + 60_000)).toMatchObject({ utm_source: "meta", utm_campaign: "tu_w1_meta_seeda", fbclid: "IwAR123" });
  });

  it("keeps the stored touch on a later direct visit", () => {
    globalThis.tubTracking = { ga4MeasurementId: "G-NEWPROP123" };
    const browser = installBrowser({ search: LANDING });
    captureAttributionFromUrl(NOW);
    navigate(browser, "/", "");
    captureAttributionFromUrl(NOW + 2 * DAY);
    expect(storedAttribution(NOW + 2 * DAY).utm_source).toBe("meta");
  });

  it("replaces the whole touch when a new tagged ad click lands", () => {
    globalThis.tubTracking = { ga4MeasurementId: "G-NEWPROP123" };
    const browser = installBrowser({ search: `${LANDING}&utm_term=old` });
    captureAttributionFromUrl(NOW);
    navigate(browser, "/calculator", "?utm_source=google&utm_medium=cpc&gclid=Cj0K");
    captureAttributionFromUrl(NOW + DAY);
    expect(storedAttribution(NOW + DAY)).toEqual({ utm_source: "google", utm_medium: "cpc", gclid: "Cj0K" });
  });

  it("expires the touch after 90 days", () => {
    globalThis.tubTracking = { ga4MeasurementId: "G-NEWPROP123" };
    installBrowser({ search: LANDING });
    captureAttributionFromUrl(NOW);
    expect(storedAttribution(NOW + 89 * DAY).utm_source).toBe("meta");
    expect(storedAttribution(NOW + 91 * DAY)).toEqual({});
  });

  it("tolerates corrupt storage", () => {
    globalThis.tubTracking = { ga4MeasurementId: "G-NEWPROP123" };
    const browser = installBrowser();
    browser.localStorage.setItem("tub_attribution", "{not json");
    expect(storedAttribution(NOW)).toEqual({});
  });
});

describe("GA cookie parsing", () => {
  it("reads the client id from _ga", () => {
    expect(gaClientIdFromCookie("GA1.1.1234567890.1700000000")).toBe("1234567890.1700000000");
    expect(gaClientIdFromCookie("garbage")).toBeNull();
    expect(gaClientIdFromCookie(null)).toBeNull();
  });

  it("reads the session id from both _ga_<id> cookie formats", () => {
    expect(gaSessionIdFromCookie("GS1.1.1700000000.3.1.1700000100.0.0.0")).toBe("1700000000");
    expect(gaSessionIdFromCookie("GS2.1.s1700000000$o3$g1$t1700000100$j0$l0$h0")).toBe("1700000000");
    expect(gaSessionIdFromCookie("nope")).toBeNull();
  });
});

describe("checkoutAttribution", () => {
  it("returns nothing while no tracker is configured", () => {
    installBrowser({ search: LANDING, cookie: "_fbp=fb.1.1.99; _ga=GA1.1.111.222" });
    expect(checkoutAttribution(NOW)).toEqual({});
  });

  it("merges the stored touch with Pixel and GA cookies (Pixel's _fbc wins)", () => {
    globalThis.tubTracking = { ga4MeasurementId: "G-NEWPROP123", metaPixelId: "123456789012345" };
    const browser = installBrowser({ search: LANDING });
    captureAttributionFromUrl(NOW);
    browser.document.cookie = "_fbp=fb.1.1700000000000.99; _fbc=fb.1.1700000000001.IwAR123; _ga=GA1.1.111.222; _ga_NEWPROP123=GS1.1.1700000000.1.1.1700000001.0.0.0";
    expect(checkoutAttribution(NOW)).toEqual({
      utm_source: "meta",
      utm_medium: "paid_social",
      utm_campaign: "tu_w1_meta_seeda",
      utm_content: "float_vs_avg_static",
      fbclid: "IwAR123",
      fbc: "fb.1.1700000000001.IwAR123",
      fbp: "fb.1.1700000000000.99",
      ga_client_id: "111.222",
      ga_session_id: "1700000000",
    });
  });
});
