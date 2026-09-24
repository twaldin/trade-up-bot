import { trackEvent } from "../../lib/analytics.js";
import { proPriceLine, type BillingInterval } from "./pro-pricing.js";

export type InterstitialContext =
  | { surface: "pricing_go_pro"; billing: BillingInterval }
  | { surface: "share_verify" };

export type InterstitialSurface = InterstitialContext["surface"];

/** "compare_plans" = left the modal through its /pricing link. */
export type DismissMethod = "cancel" | "esc" | "close" | "backdrop" | "compare_plans";

type EventParams = Record<string, string | boolean>;
type Track = (name: string, params: EventParams) => void;

export const INTERSTITIAL_COPY = {
  steamWhy: "TradeUpBot accounts use Steam sign-in (OpenID). You type your password on Steam's own site, never on ours. Steam shares only your public Steam ID, name and avatar with us.",
  continue: "Continue with Steam",
  notNow: "Not now",
  pro: {
    title: "Go Pro",
    unlocks: "Pro unlocks:",
    freeStays: "Free stays free, with a 3-hour data delay.",
    next: "After sign-in you'll come back to Pricing to pick a plan. Checkout is by Stripe; card details never touch our servers.",
    cancel: "Cancel anytime. Your access continues until the end of the current billing period. No cancellation fees.",
    lifetime: "Lifetime Pro access for a single one-time payment.",
  },
  claim: {
    title: "Verify and claim this trade-up",
    verify: "calls each marketplace's API to confirm every input listing still exists and at what price.",
    claim: "hides this trade-up's listings from other TradeUpBot users for 30 minutes. Anyone shopping the marketplace directly can still buy the inputs.",
    plan: `Verify and Claim are Pro features: ${proPriceLine("monthly")} (Verify 20/hr, Claims 10/hr, up to 5 active). Signing in is free.`,
    comparePlans: "Compare plans",
    next: "After sign-in you'll come back to this trade-up.",
  },
} as const;

const SIGN_UP_LOCATION: Record<InterstitialSurface, string> = {
  pricing_go_pro: "pricing",
  share_verify: "share_verify",
};

function baseParams(ctx: InterstitialContext): EventParams {
  return { source_surface: ctx.surface, intent: ctx.surface === "pricing_go_pro" ? "pro" : "claim", logged_in: false };
}

/** View and continue events also carry the billing tab for the Pro modal. */
function withBilling(ctx: InterstitialContext): EventParams {
  return ctx.surface === "pricing_go_pro" ? { ...baseParams(ctx), billing: ctx.billing } : baseParams(ctx);
}

function viewEvent(ctx: InterstitialContext): string {
  return ctx.surface === "pricing_go_pro" ? "pro_interstitial_view" : "claim_interstitial_view";
}

export interface InterstitialTracker {
  /** Fires the view event. Returns false (and fires nothing) if a modal is already open. */
  open(ctx: InterstitialContext): boolean;
  continue(): void;
  dismiss(method: DismissMethod): void;
  /** Forget the open modal without firing anything (bfcache restore). */
  reset(): void;
}

/**
 * Per-open event guard: each open fires one view, then exactly one of
 * steam_continue + sign_up_start or interstitial_dismiss.
 */
export function createInterstitialTracker(track: Track = trackEvent): InterstitialTracker {
  let current: InterstitialContext | null = null;
  let settled = true;
  return {
    open(ctx) {
      if (current && !settled) return false;
      current = ctx;
      settled = false;
      track(viewEvent(ctx), withBilling(ctx));
      return true;
    },
    continue() {
      if (!current || settled) return;
      settled = true;
      track("steam_continue", withBilling(current));
      track("sign_up_start", { location: SIGN_UP_LOCATION[current.surface] });
    },
    dismiss(method) {
      if (!current || settled) return;
      settled = true;
      track("interstitial_dismiss", { ...baseParams(current), method });
      current = null;
    },
    reset() {
      current = null;
      settled = true;
    },
  };
}
