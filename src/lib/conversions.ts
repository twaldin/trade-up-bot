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
} from "../../shared/tracking.js";
import { trackEvent, trackPurchase } from "./analytics.js";
import { checkoutAttribution, storedAttribution } from "./attribution.js";
import { newEventId, pixelEvent, type FbqParams } from "./meta-pixel.js";
import { clientTracking } from "./tracking-config.js";

function pagePath(): string {
  return typeof window !== "undefined" ? window.location.pathname : "/";
}

function ga4KeyEvent(name: string, params: Record<string, string | number>): boolean {
  const id = clientTracking().ga4MeasurementId;
  if (!id) return false;
  trackEvent(name, { ...params, send_to: id });
  return true;
}

/**
 * Pricing "Go Pro" click. Returns extra /api/subscribe body fields (attribution for the
 * webhook's purchase conversion), or null when tracking is off so the request is unchanged.
 */
export function trackCheckoutStart(checkoutPlan: string): { attribution: Attribution } | null {
  const tracking = clientTracking();
  const plan = trackedPlan(checkoutPlan);
  const attribution = checkoutAttribution();
  const campaign = campaignParams(attribution);
  if (!tracking.ga4MeasurementId) {
    trackEvent("begin_checkout", { item_name: checkoutPlan });
  }
  if (plan) {
    const priceUsd = centsToUsd(PLAN_PRICE_CENTS[plan]);
    ga4KeyEvent("checkout_start", { plan, price_usd: priceUsd, ...campaign });
    pixelEvent("checkout_start", { value: priceUsd, currency: "USD", content_name: plan, plan, price_usd: priceUsd, ...campaign }, newEventId("checkout"));
  }
  return tracking.enabled ? { attribution } : null;
}

/** Calculator returned a result (floats + fees). Landing UTMs and click ids ride along. */
export function trackCalculatorComplete(): void {
  const params = { page_path: pagePath(), ...campaignParams(storedAttribution()) };
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

/** User clicked Verify. */
export function trackVerifyClick(): void {
  const params = { page_path: pagePath() };
  ga4KeyEvent("verify_click", params);
  pixelEvent("verify_click", params, newEventId("verify"));
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
    const sent = ga4KeyEvent("purchase", {
      transaction_id: args.transactionId,
      value: args.value,
      currency: args.currency,
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
