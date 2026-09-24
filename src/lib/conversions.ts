// The five ad key events (event-tracking spec), fanned out to GA4 and the Meta Pixel.
// While GA4_MEASUREMENT_ID is unset the existing GA4 events fire exactly as before
// (begin_checkout, tradeup_view, legacy purchase); once set, the spec event replaces the
// legacy one at the same hook, so nothing is double-counted.
import {
  PLAN_PRICE_CENTS,
  campaignParams,
  centsToUsd,
  purchaseEventId,
  trackedPlan,
  type Attribution,
  type TrackedPlan,
} from "../../shared/tracking.js";
import { trackEvent, trackPurchase, type GtagItem } from "./analytics.js";
import { checkoutAttribution, storedAttribution } from "./attribution.js";
import { newEventId, pixelEvent, type FbqParams } from "./meta-pixel.js";
import { clientTracking } from "./tracking-config.js";

function pagePath(): string {
  return typeof window !== "undefined" ? window.location.pathname : "/";
}

function ga4KeyEvent(name: string, params: Record<string, string | number | GtagItem[]>): boolean {
  const id = clientTracking().ga4MeasurementId;
  if (!id) return false;
  trackEvent(name, { ...params, send_to: id });
  return true;
}

function planItem(plan: TrackedPlan, value: number): GtagItem {
  return { item_id: plan, item_name: plan, price: value, quantity: 1 };
}

/**
 * Checkout start. `value` is USD. Returns attribution for /api/subscribe, or null when
 * tracking is off so the request body stays `{ plan }`.
 * PR 164's shared checkout function should call this. Until that lands, /pricing does.
 */
export function trackBeginCheckout(plan: string, value: number): { attribution: Attribution } | null {
  const tracking = clientTracking();
  const tracked = trackedPlan(plan);
  const attribution = checkoutAttribution();
  const campaign = campaignParams(attribution);
  if (!tracking.ga4MeasurementId) {
    trackEvent("begin_checkout", { item_name: plan });
  } else if (tracked) {
    ga4KeyEvent("begin_checkout", {
      currency: "USD",
      value,
      items: [planItem(tracked, value)],
      ...campaign,
    });
  }
  if (tracked) {
    pixelEvent("begin_checkout", {
      value,
      currency: "USD",
      content_name: tracked,
      ...campaign,
    }, newEventId("checkout"));
  }
  return tracking.enabled ? { attribution } : null;
}

/** Calculator returned a result. `source` is the example loader or a hand-entered contract. */
export function trackCalculatorComplete(source: "example" | "custom"): void {
  const params = { page_path: pagePath(), source, ...campaignParams(storedAttribution()) };
  ga4KeyEvent("calculator_complete", params);
  pixelEvent("calculator_complete", params, newEventId("calc"));
}

/** A user opened one ranked trade-up. `collectionSlug` is set only inside a collection hub. */
export function trackTradeUpDetailOpen(opts: { collectionSlug: string | null; legacyTradeUpId?: number }): void {
  const params: Record<string, string> = { page_path: pagePath() };
  if (opts.collectionSlug) params.collection_slug = opts.collectionSlug;
  if (!ga4KeyEvent("trade_up_detail_open", params) && opts.legacyTradeUpId != null) {
    trackEvent("tradeup_view", { tradeup_id: String(opts.legacyTradeUpId) });
  }
  pixelEvent("trade_up_detail_open", params, newEventId("detail"));
}

export type VerifySurface = "board_card" | "expanded" | "share_bar" | "pro";

/** User clicked Verify. Prospects hit the card, the expanded button, and the share bar. */
export function trackVerifyClick(surface: VerifySurface): void {
  const params = { page_path: pagePath(), surface };
  ga4KeyEvent("verify_click", params);
  pixelEvent("verify_click", params, newEventId("verify"));
}

/** /pricing rendered. */
export function trackPricingView(): void {
  const items = (Object.keys(PLAN_PRICE_CENTS) as TrackedPlan[]).map((plan) => planItem(plan, centsToUsd(PLAN_PRICE_CENTS[plan])));
  ga4KeyEvent("view_item", { currency: "USD", value: centsToUsd(PLAN_PRICE_CENTS.pro_monthly), items });
  pixelEvent("view_item", { content_name: "pricing", content_type: "product" }, newEventId("pricing"));
}

/** Steam callback return. New accounts also fire Meta CompleteRegistration with the server's event id. */
export function trackAuthReturn(kind: "sign_up" | "login", eventId: string | null): void {
  ga4KeyEvent(kind, { method: "steam" });
  if (kind === "sign_up" && eventId) pixelEvent("sign_up", { status: "complete" }, eventId);
}

/**
 * PR 164's steam_continue click. Meta Lead. No-op until META_PIXEL_ID is set.
 * 164 is not on main yet; call this from that click when it lands.
 */
export function trackSteamContinue(): void {
  pixelEvent("lead", { content_name: "steam_continue" }, newEventId("lead"));
}

/**
 * Success page, after the server verified the Stripe session. GA4 `purchase` goes out here
 * only when the server is NOT sending it via the Measurement Protocol (`ga4ServerSide`).
 * The Pixel `Purchase` always fires here with the event id CAPI uses, so Meta dedupes.
 */
export function trackPurchaseComplete(args: {
  sessionId: string;
  checkoutPlan: string;
  transactionId: string;
  value: number;
  currency: string;
  ga4ServerSide: boolean;
}): void {
  const plan = trackedPlan(args.checkoutPlan);
  const planParams: FbqParams = plan ? { plan, price_usd: centsToUsd(PLAN_PRICE_CENTS[plan]) } : {};
  const campaign = campaignParams(storedAttribution());
  if (!args.ga4ServerSide) {
    const items = plan ? [planItem(plan, args.value)] : [];
    const sent = ga4KeyEvent("purchase", {
      transaction_id: args.transactionId,
      value: args.value,
      currency: args.currency,
      ...(items.length > 0 ? { items } : {}),
      ...planParams,
      ...campaign,
    });
    if (!sent) {
      trackPurchase({ transactionId: args.transactionId, value: args.value, currency: args.currency, tier: args.checkoutPlan });
    }
  }
  pixelEvent(
    "purchase",
    { value: args.value, currency: args.currency, ...(plan ? { content_name: plan } : {}), ...planParams, ...campaign },
    purchaseEventId(args.sessionId),
  );
}

/** Collection hub slug for the current path, or null on the default board and detail pages. */
export function collectionSlugFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/trade-ups\/collection\/([^/]+)\/?$/) ?? pathname.match(/^\/collections\/([^/]+)\/?$/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}
