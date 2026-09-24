import { describe, expect, it, vi, beforeEach, afterEach, type Mock } from "vitest";
import { runCheckout } from "../../src/preview/lib/checkout.js";
import { installBrowser } from "../helpers/browser-stub.js";

let gtag: Mock<NonNullable<typeof globalThis.gtag>>;
let fbq: Mock<NonNullable<typeof globalThis.fbq>>;

beforeEach(() => {
  gtag = vi.fn<NonNullable<typeof globalThis.gtag>>();
  fbq = vi.fn<NonNullable<typeof globalThis.fbq>>();
  globalThis.gtag = gtag;
  globalThis.fbq = fbq;
  installBrowser({ pathname: "/pricing" });
});

afterEach(() => {
  globalThis.gtag = undefined;
  globalThis.fbq = undefined;
  globalThis.tubTracking = undefined;
  vi.unstubAllGlobals();
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("runCheckout", () => {
  it("shows the 409 error and does not fire begin_checkout", async () => {
    globalThis.tubTracking = { ga4MeasurementId: "G-NEWPROP123", metaPixelId: "123456789012345" };
    const go = vi.fn();
    const fetchImpl = vi.fn(async () => json(409, { error: "You already have Pro access. Manage your subscription instead of starting a new checkout." }));
    const result = await runCheckout("pro", { fetchImpl, go });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(409);
    expect(result.error).toMatch(/Manage your subscription/);
    expect(gtag).not.toHaveBeenCalled();
    expect(fbq).not.toHaveBeenCalled();
    expect(go).not.toHaveBeenCalled();
    const sent = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(sent).toEqual({ plan: "pro", attribution: expect.any(Object) });
  });

  it("does not fire begin_checkout on a 500", async () => {
    const result = await runCheckout("pro-yearly", {
      fetchImpl: async () => json(500, { error: "Failed to create checkout session" }),
      go: vi.fn(),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Failed to create checkout session");
    expect(gtag).not.toHaveBeenCalled();
  });

  it("fires begin_checkout once and follows the url on success", async () => {
    globalThis.tubTracking = { ga4MeasurementId: "G-NEWPROP123", metaPixelId: "123456789012345" };
    const go = vi.fn();
    const result = await runCheckout("pro", {
      fetchImpl: async () => json(200, { url: "https://checkout.stripe.test/cs_ok" }),
      go,
    });
    expect(result.ok).toBe(true);
    expect(gtag).toHaveBeenCalledTimes(1);
    expect(gtag.mock.calls[0][2]).toMatchObject({ plan: "pro_monthly", price_usd: 6.99, currency: "USD", value: 6.99 });
    expect(fbq.mock.calls[0][1]).toBe("InitiateCheckout");
    expect(go).toHaveBeenCalledWith("https://checkout.stripe.test/cs_ok");
  });
});
