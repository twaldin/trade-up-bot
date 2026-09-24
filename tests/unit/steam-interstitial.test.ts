import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authHref } from "../../src/lib/ref.js";
import { PLAN_FOR, PRO_FEATURES, PRO_PRICE, proPriceLine } from "../../src/preview/lib/pro-pricing.js";
import {
  INTERSTITIAL_COPY,
  createInterstitialTracker,
  type InterstitialContext,
} from "../../src/preview/lib/steam-interstitial.js";
import { SteamInterstitial } from "../../src/preview/components/SteamInterstitial.js";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(dir, rel), "utf8");
const pricing = read("../../src/preview/pages/PreviewPricing.tsx");
const share = read("../../src/preview/pages/PreviewShare.tsx");
const component = read("../../src/preview/components/SteamInterstitial.tsx");
const staticSeo = read("../../server/static-seo-pages.ts");

type Call = [string, Record<string, string | boolean>];

function recorder() {
  const calls: Call[] = [];
  return { calls, track: (name: string, params: Record<string, string | boolean>) => { calls.push([name, params]); } };
}

function stubWindow(pathname: string, storedRef?: string) {
  const store = new Map<string, string>();
  if (storedRef) store.set("tub_ref", storedRef);
  Object.assign(globalThis, {
    window: {
      location: { pathname, search: "" },
      localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } },
    },
  });
}

function render(context: InterstitialContext | null): string {
  return renderToStaticMarkup(
    createElement(MemoryRouter, null,
      createElement(SteamInterstitial, { context, onContinue: () => {}, onDismiss: () => {}, returnFocusTo: { current: null } }),
    ),
  );
}

const hrefOf = (html: string) => (html.match(/<a[^>]*class="[^"]*preview-sheet__go[^"]*"[^>]*href="([^"]*)"/)?.[1] ?? html.match(/<a[^>]*href="([^"]*)"[^>]*class="[^"]*preview-sheet__go/)?.[1] ?? "").replaceAll("&amp;", "&");
const textOf = (html: string) => html.replace(/<[^>]+>/g, "").replaceAll("&#x27;", "'").replaceAll("&amp;", "&");

describe("Pro price strings are the /pricing Pro card strings", () => {
  it("renders the exact per-tab price line", () => {
    expect(proPriceLine("monthly")).toBe("$6.99/mo");
    expect(proPriceLine("yearly")).toBe("$5/mo · billed $59.99/year");
    expect(proPriceLine("lifetime")).toBe("$74.99 one-time");
  });

  it("keeps the values the server-rendered /pricing HTML lists", () => {
    expect(staticSeo).toContain("$6.99/month");
    expect(staticSeo).toContain("$59.99/year");
    expect(staticSeo).toContain("$74.99");
    expect(PRO_PRICE.monthly.amount).toBe("$6.99");
    expect(PRO_PRICE.yearly.note).toBe("billed $59.99/year");
    expect(PRO_PRICE.lifetime.amount).toBe("$74.99");
  });

  it("keeps plan ids for /api/subscribe unchanged", () => {
    expect(PLAN_FOR).toEqual({ monthly: "pro", yearly: "pro-yearly", lifetime: "pro-lifetime" });
  });

  it("drives the Pro card and the modal from the same constants", () => {
    expect(pricing).toContain("PRO_PRICE.monthly.amount");
    expect(pricing).toContain("PRO_PRICE.yearly.note");
    expect(pricing).toContain("PRO_PRICE.lifetime.unit");
    expect(pricing).toContain("PRO_FEATURES.map");
    expect(component).toContain("proPriceParts(");
    expect(component).toContain("PRO_FEATURES.map");
    expect(PRO_FEATURES).toEqual([
      "Real-time data (no delay)",
      "Claim system (30 min lock)",
      "Up to 5 active claims",
      "Verify availability (20/hr)",
      "Claims (10/hr)",
    ]);
  });

  it("quotes the cancel line from the /pricing FAQ", () => {
    const faqCancel = "Your access continues until the end of the current billing period. No cancellation fees.";
    expect(pricing).toContain(faqCancel);
    expect(INTERSTITIAL_COPY.pro.cancel).toContain(faqCancel);
  });
});

describe("interstitial GA4 events", () => {
  it("fires one pro view, then steam_continue then sign_up_start{pricing}", () => {
    const { calls, track } = recorder();
    const tracker = createInterstitialTracker(track);
    expect(tracker.open({ surface: "pricing_go_pro", billing: "yearly" })).toBe(true);
    tracker.continue();
    tracker.continue();
    tracker.dismiss("cancel");
    const pro = { source_surface: "pricing_go_pro", intent: "pro", logged_in: false, billing: "yearly" };
    expect(calls).toEqual([
      ["pro_interstitial_view", pro],
      ["steam_continue", pro],
      ["sign_up_start", { location: "pricing" }],
    ]);
  });

  it("fires one claim view, then steam_continue then sign_up_start{share_verify}", () => {
    const { calls, track } = recorder();
    const tracker = createInterstitialTracker(track);
    tracker.open({ surface: "share_verify" });
    tracker.continue();
    const claim = { source_surface: "share_verify", intent: "claim", logged_in: false };
    expect(calls).toEqual([
      ["claim_interstitial_view", claim],
      ["steam_continue", claim],
      ["sign_up_start", { location: "share_verify" }],
    ]);
  });

  it("fires exactly one interstitial_dismiss per open, with the method", () => {
    for (const method of ["cancel", "esc", "close", "backdrop"] as const) {
      const { calls, track } = recorder();
      const tracker = createInterstitialTracker(track);
      tracker.open({ surface: "pricing_go_pro", billing: "monthly" });
      tracker.dismiss(method);
      tracker.dismiss("esc");
      tracker.continue();
      expect(calls).toEqual([
        ["pro_interstitial_view", { source_surface: "pricing_go_pro", intent: "pro", logged_in: false, billing: "monthly" }],
        ["interstitial_dismiss", { source_surface: "pricing_go_pro", intent: "pro", logged_in: false, method }],
      ]);
    }
  });

  it("ignores a second open while the modal is already open", () => {
    const { calls, track } = recorder();
    const tracker = createInterstitialTracker(track);
    expect(tracker.open({ surface: "share_verify" })).toBe(true);
    expect(tracker.open({ surface: "share_verify" })).toBe(false);
    expect(calls.filter(([name]) => name === "claim_interstitial_view")).toHaveLength(1);
  });

  it("starts a fresh open after a dismiss", () => {
    const { calls, track } = recorder();
    const tracker = createInterstitialTracker(track);
    tracker.open({ surface: "share_verify" });
    tracker.dismiss("esc");
    expect(tracker.open({ surface: "share_verify" })).toBe(true);
    tracker.continue();
    expect(calls.map(([name]) => name)).toEqual([
      "claim_interstitial_view",
      "interstitial_dismiss",
      "claim_interstitial_view",
      "steam_continue",
      "sign_up_start",
    ]);
  });

  it("fires nothing when a bfcache return resets the modal", () => {
    const { calls, track } = recorder();
    const tracker = createInterstitialTracker(track);
    tracker.open({ surface: "pricing_go_pro", billing: "monthly" });
    tracker.continue();
    tracker.reset();
    tracker.dismiss("esc");
    expect(calls.map(([name]) => name)).toEqual(["pro_interstitial_view", "steam_continue", "sign_up_start"]);
  });

  it("does nothing before an open", () => {
    const { calls, track } = recorder();
    const tracker = createInterstitialTracker(track);
    tracker.continue();
    tracker.dismiss("esc");
    expect(calls).toEqual([]);
  });
});

describe("SteamInterstitial markup", () => {
  beforeEach(() => stubWindow("/pricing"));
  afterEach(() => { Reflect.deleteProperty(globalThis, "window"); });

  it("Continue with Steam is today's authHref(window.location.pathname), byte for byte", () => {
    const html = render({ surface: "pricing_go_pro", billing: "monthly" });
    expect(hrefOf(html)).toBe("/auth/steam?return=%2Fpricing");
    expect(hrefOf(html)).toBe(authHref("/pricing"));
    expect(html).toMatch(/<a[^>]*rel="nofollow"[^>]*>|<a[^>]*preview-sheet__go[^>]*rel="nofollow"/);
    expect(textOf(html)).toContain("Continue with Steam");
  });

  it("carries a stored ref exactly like today", () => {
    stubWindow("/pricing", "abc");
    expect(hrefOf(render({ surface: "pricing_go_pro", billing: "monthly" }))).toBe("/auth/steam?return=%2Fpricing&ref=abc");
    stubWindow("/trade-ups/123", "abc");
    expect(hrefOf(render({ surface: "share_verify" }))).toBe("/auth/steam?return=%2Ftrade-ups%2F123&ref=abc");
  });

  it("returns a trade-up visitor to the same trade-up", () => {
    stubWindow("/trade-ups/776913115");
    expect(hrefOf(render({ surface: "share_verify" }))).toBe("/auth/steam?return=%2Ftrade-ups%2F776913115");
  });

  it("is a labelled modal dialog", () => {
    const html = render({ surface: "pricing_go_pro", billing: "monthly" });
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    const labelled = html.match(/aria-labelledby="([^"]+)"/)?.[1];
    const described = html.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(labelled).toBeTruthy();
    expect(described).toBeTruthy();
    expect(html).toContain(`id="${labelled}"`);
    expect(html).toContain(`id="${described}"`);
    expect(html).toMatch(/aria-label="Close"/);
  });

  it("follows the billing tab for the price and cancel lines", () => {
    const monthly = textOf(render({ surface: "pricing_go_pro", billing: "monthly" }));
    const yearly = textOf(render({ surface: "pricing_go_pro", billing: "yearly" }));
    const lifetime = textOf(render({ surface: "pricing_go_pro", billing: "lifetime" }));
    expect(monthly).toContain("Go Pro");
    expect(monthly).toContain("$6.99/mo");
    expect(yearly).toContain("$5/mo · billed $59.99/year");
    expect(lifetime).toContain("$74.99 one-time");
    expect(monthly).toContain(INTERSTITIAL_COPY.pro.cancel);
    expect(yearly).toContain(INTERSTITIAL_COPY.pro.cancel);
    expect(lifetime).not.toContain(INTERSTITIAL_COPY.pro.cancel);
    expect(lifetime).toContain("Lifetime Pro access for a single one-time payment.");
    expect(monthly).not.toContain("Lifetime Pro access for a single one-time payment.");
    for (const feature of PRO_FEATURES) expect(monthly).toContain(feature);
    expect(monthly).toContain("Free stays free, with a 3-hour data delay.");
    expect(monthly).toContain(INTERSTITIAL_COPY.steamWhy);
    expect(monthly).toContain("After sign-in you'll come back to Pricing to pick a plan. Checkout is by Stripe; card details never touch our servers.");
    expect(monthly).toContain("Not now");
  });

  it("explains Verify and Claim with the Pro price on the trade-up modal", () => {
    stubWindow("/trade-ups/1");
    const html = render({ surface: "share_verify" });
    const text = textOf(html);
    expect(text).toContain("Verify and claim this trade-up");
    expect(text).toContain("Verify calls each marketplace's API to confirm every input listing still exists and at what price.");
    expect(text).toContain("Claim hides this trade-up's listings from other TradeUpBot users for 30 minutes. Anyone shopping the marketplace directly can still buy the inputs.");
    expect(text).toContain("Verify and Claim are Pro features: $6.99/mo (Verify 20/hr, Claims 10/hr, up to 5 active). Signing in is free.");
    expect(html).toContain('href="/pricing"');
    expect(text).toContain("Compare plans");
    expect(text).toContain(INTERSTITIAL_COPY.steamWhy);
    expect(text).toContain("After sign-in you'll come back to this trade-up.");
  });

  it("renders no content while closed", () => {
    const html = render(null);
    expect(html).not.toContain("/auth/steam");
    expect(html).toContain("<dialog");
  });

  it("navigates only through the link: no onClick redirect", () => {
    expect(component).toContain("href={authHref(window.location.pathname)}");
    expect(component).not.toMatch(/window\.location\.(href|assign|replace)/);
    expect(component).toContain("pageshow");
    expect(component).toContain("persisted");
  });
});

describe("entry points open the interstitial instead of going straight to Steam", () => {
  it("Go Pro opens the modal for logged-out visitors and keeps checkout for logged-in users", () => {
    expect(pricing).toContain('surface: "pricing_go_pro"');
    expect(pricing).toContain("subscribe(PLAN_FOR[billing])");
    expect(pricing).toContain("<SteamInterstitial");
  });

  it("Free 'Get started' still fires sign_up_start{pricing} and goes straight to Steam", () => {
    expect(pricing).toContain('trackEvent("sign_up_start", { location: "pricing" })');
    expect(pricing).toContain("window.location.href = authHref(window.location.pathname)");
    expect(pricing).toMatch(/onClick=\{login\}>Get started</);
  });

  it("the share sign-in button opens the claim modal and no longer links to Steam itself", () => {
    expect(share).toContain('surface: "share_verify"');
    expect(share).toContain("Verify or claim this trade-up");
    expect(share).not.toContain("authHref(");
    expect(share).not.toContain('"sign_up_start"');
    expect(share).toContain("<SteamInterstitial");
  });
});
