// Typed GA4 event wrapper. No-op when gtag has not loaded (SSR, crawler, or ad-blocked),
// so call sites never need to guard. `gtag` is a global defined by the gtag.js snippet in
// index.html, so we reference the global binding directly.

type GtagParams = Record<string, string | number | boolean>;

declare global {
  // eslint-disable-next-line no-var
  var gtag: ((command: string, eventName: string, params?: GtagParams) => void) | undefined;
}

/** Fire a GA4 event. Silently no-ops if gtag has not loaded. */
export function trackEvent(name: string, params?: GtagParams): void {
  if (typeof gtag === "function") gtag("event", name, params);
}

/** Fire a GA4 `purchase` event with verified Stripe values (server-confirmed amount). */
export function trackPurchase(args: {
  transactionId: string;
  value: number;
  currency: string;
  tier: string;
}): void {
  trackEvent("purchase", {
    transaction_id: args.transactionId,
    value: args.value,
    currency: args.currency,
    items: 1,
    item_name: args.tier,
  });
}
