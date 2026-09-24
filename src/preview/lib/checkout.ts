import { checkoutAttributionBody, trackBeginCheckout } from "../../lib/conversions.js";
import { PLAN_PRICE_CENTS, centsToUsd, trackedPlan } from "../../../shared/tracking.js";

export interface CheckoutResult {
  ok: boolean;
  status: number;
  url?: string;
  error?: string;
}

/**
 * POST /api/subscribe. begin_checkout fires only after a 2xx response, so a 409
 * (already Pro, or an open Stripe subscription) never counts as a started checkout.
 */
export async function runCheckout(
  plan: string,
  deps: {
    fetchImpl?: typeof fetch;
    go?: (url: string) => void;
  } = {},
): Promise<CheckoutResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const go = deps.go ?? ((url: string) => { window.location.href = url; });
  const extra = checkoutAttributionBody();
  const res = await fetchImpl("/api/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: extra ? JSON.stringify({ plan, ...extra }) : JSON.stringify({ plan }),
  });
  let data: { url?: string; error?: string } = {};
  try {
    data = await res.json() as { url?: string; error?: string };
  } catch {
    data = {};
  }
  if (!res.ok) {
    return { ok: false, status: res.status, error: data.error || "Checkout failed" };
  }
  const named = trackedPlan(plan);
  trackBeginCheckout(plan, named ? centsToUsd(PLAN_PRICE_CENTS[named]) : 0);
  if (data.url) go(data.url);
  return { ok: true, status: res.status, url: data.url };
}
