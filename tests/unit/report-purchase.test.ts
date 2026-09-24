import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { reportPurchase } from "../../src/lib/purchase.js";
import { installBrowser } from "../helpers/browser-stub.js";

let gtag: Mock<NonNullable<typeof globalThis.gtag>>;
let fbq: Mock<NonNullable<typeof globalThis.fbq>>;

function stubCheckoutSession(body: Record<string, unknown>, status = 200) {
  const fetchSpy = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

beforeEach(() => {
  gtag = vi.fn<NonNullable<typeof globalThis.gtag>>();
  fbq = vi.fn<NonNullable<typeof globalThis.fbq>>();
  globalThis.gtag = gtag;
  globalThis.fbq = fbq;
  installBrowser({ pathname: "/", search: "?upgraded=pro&session_id=cs_test_1" });
});

afterEach(() => {
  globalThis.gtag = undefined;
  globalThis.fbq = undefined;
  globalThis.tubTracking = undefined;
  vi.unstubAllGlobals();
});

describe("reportPurchase", () => {
  it("fires the legacy GA4 purchase once per session when nothing is configured", async () => {
    stubCheckoutSession({ transaction_id: "cs_test_1", value: 6.99, currency: "USD" });
    await reportPurchase("pro", "cs_test_1");
    await reportPurchase("pro", "cs_test_1");
    expect(gtag).toHaveBeenCalledTimes(1);
    expect(gtag.mock.calls[0][1]).toBe("purchase");
    expect(fbq).not.toHaveBeenCalled();
  });

  it("leaves GA4 purchase to the webhook when the server says it sends it, but still fires the Pixel", async () => {
    globalThis.tubTracking = { ga4MeasurementId: "G-NEWPROP123", metaPixelId: "123456789012345" };
    stubCheckoutSession({ transaction_id: "cs_test_1", value: 6.99, currency: "USD", ga4_server_side: true });
    await reportPurchase("pro", "cs_test_1");
    expect(gtag).not.toHaveBeenCalled();
    expect(fbq).toHaveBeenCalledWith("track", "Purchase", expect.objectContaining({ value: 6.99 }), { eventID: "purchase_cs_test_1" });
  });

  it("reports nothing for an unverified session", async () => {
    globalThis.tubTracking = { ga4MeasurementId: "G-NEWPROP123", metaPixelId: "123456789012345" };
    stubCheckoutSession({ error: "Not paid" }, 409);
    await reportPurchase("pro", "cs_test_1");
    expect(gtag).not.toHaveBeenCalled();
    expect(fbq).not.toHaveBeenCalled();
  });
});
