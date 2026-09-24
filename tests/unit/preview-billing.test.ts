import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BILLING_PORTAL_API, hasProAccess, openBillingPortal } from "../../src/preview/lib/billing.js";
import { INTERSTITIAL_COPY } from "../../src/preview/lib/steam-interstitial.js";
import { ManageSubscription } from "../../src/preview/components/ManageSubscription.js";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(dir, rel), "utf8");
const pricing = read("../../src/preview/pages/PreviewPricing.tsx");
const account = read("../../src/preview/pages/PreviewAccount.tsx");

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("Pro access", () => {
  it("covers Pro subscribers and lifetime buyers only", () => {
    expect(hasProAccess(null)).toBe(false);
    expect(hasProAccess(undefined)).toBe(false);
    expect(hasProAccess({ tier: "free" })).toBe(false);
    expect(hasProAccess({ tier: "free", lifetime: false })).toBe(false);
    expect(hasProAccess({ tier: "pro" })).toBe(true);
    expect(hasProAccess({ tier: "pro", lifetime: true })).toBe(true);
    expect(hasProAccess({ tier: "free", lifetime: true })).toBe(true);
  });
});

describe("openBillingPortal", () => {
  it("POSTs the existing billing-portal endpoint with the session cookie and follows the url", async () => {
    const fetchImpl = vi.fn(async () => json(200, { url: "https://billing.stripe.com/p/session/test_123" }));
    const go = vi.fn();
    await expect(openBillingPortal(fetchImpl, go)).resolves.toBeNull();
    expect(BILLING_PORTAL_API).toBe("/api/billing-portal");
    expect(fetchImpl).toHaveBeenCalledWith("/api/billing-portal", { method: "POST", credentials: "include" });
    expect(go).toHaveBeenCalledWith("https://billing.stripe.com/p/session/test_123");
  });

  it("returns the server error and does not navigate when there is no Stripe customer", async () => {
    const go = vi.fn();
    await expect(openBillingPortal(async () => json(400, { error: "No subscription found" }), go)).resolves.toBe("No subscription found");
    expect(go).not.toHaveBeenCalled();
  });

  it("returns a fallback message on network or parse failure", async () => {
    const go = vi.fn();
    await expect(openBillingPortal(async () => { throw new Error("offline"); }, go)).resolves.toBe("Could not open billing. Try again.");
    await expect(openBillingPortal(async () => new Response("<html>", { status: 502 }), go)).resolves.toBe("Could not open billing. Try again.");
    expect(go).not.toHaveBeenCalled();
  });
});

describe("Manage subscription entry points", () => {
  it("renders a Manage subscription button", () => {
    const html = renderToStaticMarkup(createElement(ManageSubscription));
    expect(html).toContain(">Manage subscription<");
    expect(html).toContain('type="button"');
  });

  it("shows on /pricing and on the account page for Pro users only", () => {
    expect(pricing).toContain("<ManageSubscription");
    expect(pricing).toMatch(/hasProAccess\(user\)[\s\S]{0,120}<ManageSubscription/);
    expect(account).toContain("<ManageSubscription");
    expect(account).toMatch(/hasProAccess\(user\)[\s\S]{0,120}<ManageSubscription/);
  });

  it("disables Current plan so an existing Pro user cannot start checkout", () => {
    expect(pricing).toContain("disabled={user === undefined || hasProAccess(user)}");
    expect(pricing).toContain("if (user === undefined || hasProAccess(user)) return;");
    expect(pricing).toContain('hasProAccess(user) ? "Current plan" : "Go Pro"');
    expect(pricing).toContain('user === undefined ? "Checking…"');
  });

  it("cancel copy names Manage subscription instead of a missing account menu", () => {
    expect(INTERSTITIAL_COPY.pro.cancel).toBe("Cancel anytime from Manage subscription. Your access continues until the end of the current billing period. No cancellation fees.");
    expect(pricing).toContain("Manage subscription");
    expect(pricing).not.toContain("account menu");
  });
});
