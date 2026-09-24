import { trackEvent } from "../../lib/analytics.js";

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
    track?: (name: string, params: Record<string, string>) => void;
    go?: (url: string) => void;
  } = {},
): Promise<CheckoutResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const track = deps.track ?? trackEvent;
  const go = deps.go ?? ((url: string) => { window.location.href = url; });
  const res = await fetchImpl("/api/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ plan }),
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
  track("begin_checkout", { item_name: plan });
  if (data.url) go(data.url);
  return { ok: true, status: res.status, url: data.url };
}
