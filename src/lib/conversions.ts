// Browser conversion events, fanned out to GA4 and the Meta Pixel.
// GA4 key events to mark in admin: begin_checkout, purchase, sign_up, calculator_complete, and claim_trade_up.
// view_item, login, verify_click, verify_complete, cta_click, and upgrade_cta_click are measured but are not key events. Never checkout_start.
// claim_trade_up and verify_complete `surface`: share (shared trade-up), account (my trade-ups), board (the live board).
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
import { newEventId, pixelEvent, pixelPageView, type FbqParams } from "./meta-pixel.js";
import { clientTracking } from "./tracking-config.js";

function pagePath(): string {
  return typeof window !== "undefined" ? window.location.pathname : "/";
}

type Ga4Value = string | number | GtagItem[] | (() => void);

function sendGa4(name: string, params: Record<string, Ga4Value>): boolean {
  const id = clientTracking().ga4MeasurementId;
  if (!id) return false;
  trackEvent(name, { ...params, send_to: id });
  return true;
}

/** How long a checkout hit may take before the Stripe redirect proceeds anyway. */
export const CHECKOUT_SEND_TIMEOUT_MS = 500;

function planItem(plan: TrackedPlan, value: number): GtagItem {
  return { item_id: plan, item_name: plan, price: value, quantity: 1 };
}

/** Attribution for the /api/subscribe body. Null when tracking is off, so the body stays `{ plan }`. */
export function checkoutAttributionBody(): { attribution: Attribution } | null {
  return clientTracking().enabled ? { attribution: checkoutAttribution() } : null;
}

/**
 * Checkout start, only after /api/subscribe returns 2xx. `value` is USD.
 * PR 164's checkout.ts should call checkoutAttributionBody() before the fetch and this after res.ok.
 */
function beginCheckoutParams(plan: string, value: number): Record<string, Ga4Value> {
  const tracked = trackedPlan(plan);
  const campaign = campaignParams(checkoutAttribution());
  if (!clientTracking().ga4MeasurementId || !tracked) return { item_name: plan };
  return {
    currency: "USD",
    value,
    items: [planItem(tracked, value)],
    plan: tracked,
    price_usd: value,
    ...campaign,
  };
}

/**
 * Checkout start, only after /api/subscribe returns 2xx. `value` is USD.
 * The hit uses beacon transport. The promise resolves on gtag's send callback
 * or after a short timeout, so the caller can redirect without dropping it.
 */
export function trackBeginCheckout(plan: string, value: number): Promise<void> {
  const tracked = trackedPlan(plan);
  const campaign = campaignParams(checkoutAttribution());
  if (tracked) {
    pixelEvent("begin_checkout", {
      value,
      currency: "USD",
      content_name: tracked,
      ...campaign,
    }, newEventId("checkout"));
  }
  const params = beginCheckoutParams(plan, value);
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    if (typeof gtag !== "function") {
      finish();
      return;
    }
    const timer = setTimeout(finish, CHECKOUT_SEND_TIMEOUT_MS);
    const event_callback = () => {
      clearTimeout(timer);
      finish();
    };
    const hit = { ...params, transport_type: "beacon", event_callback, event_timeout: CHECKOUT_SEND_TIMEOUT_MS };
    if (!clientTracking().ga4MeasurementId || !tracked) trackEvent("begin_checkout", hit);
    else sendGa4("begin_checkout", hit);
  });
}

/** Calculator returned a result. `source` is the example loader or a hand-entered contract. */
export function trackCalculatorComplete(source: "example" | "custom"): void {
  const params = { page_path: pagePath(), source, ...campaignParams(storedAttribution()) };
  sendGa4("calculator_complete", params);
  pixelEvent("calculator_complete", params, newEventId("calc"));
}

/** A user opened one ranked trade-up. `collectionSlug` is set only inside a collection hub. */
export function trackTradeUpDetailOpen(opts: { collectionSlug: string | null; legacyTradeUpId?: number }): void {
  const params: Record<string, string> = { page_path: pagePath() };
  if (opts.collectionSlug) params.collection_slug = opts.collectionSlug;
  if (!sendGa4("trade_up_detail_open", params) && opts.legacyTradeUpId != null) {
    trackEvent("tradeup_view", { tradeup_id: String(opts.legacyTradeUpId) });
  }
  pixelEvent("trade_up_detail_open", { ...params, content_type: "trade_up" }, newEventId("detail"));
}

export type VerifySurface = "board_card" | "expanded" | "share_bar" | "pro";

/** User clicked Verify. Prospects hit the card, the expanded button, and the share bar. */
export function trackVerifyClick(surface: VerifySurface): void {
  const params = { page_path: pagePath(), surface };
  sendGa4("verify_click", params);
  pixelEvent("verify_click", params, newEventId("verify"));
}

/** Allowlist for claim_trade_up and verify_complete. A scoreboard reader must accept every value here, including board. */
export const ACTIVATION_SURFACES = ["share", "account", "board"] as const;
export type ActivationSurface = (typeof ACTIVATION_SURFACES)[number];

/** Scoreboard reader. Unknown surfaces are not activation events. */
export function readActivationSurface(value: unknown): ActivationSurface | null {
  if (typeof value !== "string") return null;
  for (const surface of ACTIVATION_SURFACES) {
    if (surface === value) return surface;
  }
  return null;
}

export type VerifyCompleteStatus = "all_active" | "partial" | "stale";

/** Verify payload fields the kit already renders. Extra listing and price fields are ignored. */
export interface ActivationVerifyResult {
  all_active?: boolean;
  inputs?: ReadonlyArray<{ status: string }>;
}

/** Once per event + trade_up_id for this tab. A dropped call (no GA4 id, or gtag blocked) does not consume the slot. */
const sentActivation = new Set<string>();

/**
 * Listing outcome for `verify_complete`, from the verify JSON the UI already has.
 * `all_active` (or every real row still active) → all_active.
 * Every real row sold or delisted → stale. Anything else (a mix, or errors) → partial.
 * Theoretical rows are not real listings. Prices are not part of the status.
 */
export function verifyCompleteStatus(result: ActivationVerifyResult): VerifyCompleteStatus {
  if (result.all_active === true) return "all_active";
  const real = (result.inputs ?? []).filter((row) => row.status !== "theoretical");
  if (real.length > 0 && real.every((row) => row.status === "active")) return "all_active";
  if (real.length > 0 && real.every((row) => row.status === "sold" || row.status === "delisted")) return "stale";
  return "partial";
}

function sendActivation(
  event: "claim_trade_up" | "verify_complete",
  tradeUpId: number | string,
  surface: ActivationSurface,
  status?: VerifyCompleteStatus,
): void {
  const known = readActivationSurface(surface);
  if (!known) return;
  const trade_up_id = String(tradeUpId);
  const key = `${event}:${trade_up_id}`;
  if (sentActivation.has(key)) return;
  const measurementId = clientTracking().ga4MeasurementId;
  if (!measurementId || typeof globalThis.gtag !== "function") return;
  sentActivation.add(key);
  const params: Record<string, string> = { page_path: pagePath(), surface: known, trade_up_id };
  if (status) params.status = status;
  try {
    trackEvent(event, { ...params, send_to: measurementId });
  } catch {
    // gtag failed after a real claim or verify. The UI must still show success.
  }
}

/**
 * Successful Claim (POST 2xx). This is the activation event — mark `claim_trade_up` as a GA4 key event.
 * No Meta Pixel event. No-op when the GA4 id is unset or gtag has not loaded.
 */
export function trackClaimTradeUp(args: { surface: ActivationSurface; tradeUpId: number | string }): void {
  sendActivation("claim_trade_up", args.tradeUpId, args.surface);
}

/**
 * Successful Verify (POST 2xx). Supporting event, not a GA4 key event. `verify_click` is unchanged.
 * No Meta Pixel event. No-op when the GA4 id is unset or gtag has not loaded.
 */
export function trackVerifyComplete(args: {
  surface: ActivationSurface;
  tradeUpId: number | string;
  result: ActivationVerifyResult;
}): void {
  sendActivation("verify_complete", args.tradeUpId, args.surface, verifyCompleteStatus(args.result));
}

export type CtaId = "home_hero_calculator" | "home_hero_tradeup" | "intent_board" | "calculator_board" | "detail_collection";

export type UpgradeCtaId =
  | "board_delay"
  | "landing_delay"
  | "share_upgrade"
  | "intent_pro"
  | "pricing_go_pro"
  | "redacted_links"
  | "landing_plan_tile"
  | "share_bar"
  | "nav_pricing"
  | "board_claim";

/** Delay-gap gates also send Meta `UpgradeCtaClick`. The other controls stay on GA4 only. */
const PIXEL_UPGRADE_CTAS: ReadonlySet<string> = new Set<UpgradeCtaId>([
  "board_delay",
  "landing_delay",
  "share_upgrade",
  "intent_pro",
  "pricing_go_pro",
  "redacted_links",
]);

/**
 * Click on a Pro upgrade control.
 * GA4 `upgrade_cta_click`. Delay-gap gates also send Meta custom `UpgradeCtaClick`.
 * Landing plan tile, share bar, nav Pricing, and the board claim stay off the Pixel.
 * No prices, listing ids, or PII.
 * Checkout itself stays `begin_checkout` / InitiateCheckout, fired only after /api/subscribe returns 2xx.
 */
export function trackUpgradeCta(cta: UpgradeCtaId): void {
  const params = { cta, page_path: pagePath() };
  // Go Pro navigates to Stripe as soon as /api/subscribe returns. Beacon survives that load.
  const hit = cta === "pricing_go_pro" ? { ...params, transport_type: "beacon" } : params;
  try {
    sendGa4("upgrade_cta_click", hit);
    if (PIXEL_UPGRADE_CTAS.has(cta)) pixelEvent("upgrade_cta_click", params, newEventId("upgrade"));
  } catch {
    // A blocked tag must not swallow the click.
  }
}

/** In-app CTA click. No PII, listing ids, or prices. No-op until GA4 is configured and gtag has loaded. */
export function trackCtaClick(cta: CtaId): void {
  sendGa4("cta_click", { cta, page_path: pagePath() });
}

/** Landing board failed or was throttled. GA4 only — the pixel stays off. */
export function trackLandingLoadError(kind: "error" | "rate_limited"): void {
  sendGa4("landing_load_error", { kind, page_path: pagePath() });
}

/** /pricing rendered. */
export function trackPricingView(): void {
  const items = (Object.keys(PLAN_PRICE_CENTS) as TrackedPlan[]).map((plan) => planItem(plan, centsToUsd(PLAN_PRICE_CENTS[plan])));
  sendGa4("view_item", { currency: "USD", value: centsToUsd(PLAN_PRICE_CENTS.pro_monthly), items });
  pixelEvent("view_item", { content_name: "pricing", content_type: "product" }, newEventId("pricing"));
}

/** Steam callback return. Pixel events fire only with the id CAPI already used. */
export function trackAuthReturn(kind: "sign_up" | "login", eventId?: string | null): void {
  sendGa4(kind, { method: "steam", page_path: pagePath() });
  if (kind === "sign_up") {
    if (eventId) pixelEvent("sign_up", { status: "complete" }, eventId);
    return;
  }
  if (eventId) pixelEvent("login", { status: "complete" }, eventId);
}

/**
 * Client-side route change. The gtag config already records each history page view, and the
 * Pixel base code records the document load, so this only sends Meta PageView — once per path.
 */
export function shouldTrackSpaPageView(previousPath: string | null, nextPath: string): boolean {
  return previousPath !== null && previousPath !== nextPath;
}

export function trackSpaPageView(): void {
  pixelPageView();
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
    const sent = sendGa4("purchase", {
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
