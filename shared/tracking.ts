// Conversion-tracking vocabulary shared by the browser (GA4 gtag + Meta Pixel) and the
// server (GA4 Measurement Protocol + Meta Conversions API). Event names and plan values
// follow the signed event-tracking spec; amounts stay integer cents until the wire.

export type TrackedPlan = "pro_monthly" | "yearly" | "lifetime";

export const PLAN_PRICE_CENTS: Readonly<Record<TrackedPlan, number>> = {
  pro_monthly: 699,
  yearly: 5999,
  lifetime: 7499,
};

const CHECKOUT_PLAN_TO_TRACKED: Readonly<Record<string, TrackedPlan>> = {
  pro: "pro_monthly",
  "pro-yearly": "yearly",
  "pro-lifetime": "lifetime",
  pro_monthly: "pro_monthly",
  yearly: "yearly",
  lifetime: "lifetime",
};

/** Map a checkout plan id (`pro`, `pro-yearly`, `pro-lifetime`) to the spec plan name. */
export function trackedPlan(plan: unknown): TrackedPlan | null {
  if (typeof plan !== "string") return null;
  return Object.hasOwn(CHECKOUT_PLAN_TO_TRACKED, plan) ? CHECKOUT_PLAN_TO_TRACKED[plan] : null;
}

/** Ad platforms and GA4 take currency units; this is the only cents → dollars step. */
export function centsToUsd(cents: number): number {
  return Math.round(cents) / 100;
}

/** Shared by the browser Pixel `eventID` and the CAPI `event_id` so Meta dedupes the pair. */
export function purchaseEventId(checkoutSessionId: string): string {
  return `purchase_${checkoutSessionId}`;
}

export type KeyEvent = "purchase" | "checkout_start" | "calculator_complete" | "trade_up_detail_open" | "verify_click";

export const META_EVENTS: Readonly<Record<KeyEvent, { kind: "standard" | "custom"; name: string }>> = {
  purchase: { kind: "standard", name: "Purchase" },
  checkout_start: { kind: "standard", name: "InitiateCheckout" },
  calculator_complete: { kind: "custom", name: "CalculatorComplete" },
  trade_up_detail_open: { kind: "custom", name: "TradeUpDetailOpen" },
  verify_click: { kind: "custom", name: "VerifyClick" },
};

/** Landing-URL params kept on first landing and attached to key events. `utm_matchtype` is part of the Google Ads final-URL suffix. */
export const ATTRIBUTION_URL_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "utm_matchtype",
  "gclid",
  "fbclid",
] as const;

export const ATTRIBUTION_KEYS = [
  ...ATTRIBUTION_URL_PARAMS,
  "fbc",
  "fbp",
  "ga_client_id",
  "ga_session_id",
] as const;

export type AttributionUrlParam = (typeof ATTRIBUTION_URL_PARAMS)[number];
export type AttributionKey = (typeof ATTRIBUTION_KEYS)[number];
export type Attribution = Partial<Record<AttributionKey, string>>;

// Stripe metadata values cap at 500 chars; real UTMs and click ids are far shorter.
export const ATTRIBUTION_VALUE_MAX = 200;

export function cleanAttributionValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, ATTRIBUTION_VALUE_MAX);
  return cleaned.length > 0 ? cleaned : null;
}

/** Whitelist + clean an untrusted attribution object (request body, localStorage). */
export function sanitizeAttribution(input: unknown): Attribution {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Attribution = {};
  for (const key of ATTRIBUTION_KEYS) {
    const value = cleanAttributionValue(Reflect.get(input, key));
    if (value) out[key] = value;
  }
  return out;
}

/** Only the landing-URL campaign params (what gets attached to event params / custom_data). */
export function campaignParams(attribution: Attribution): Partial<Record<AttributionUrlParam, string>> {
  const out: Partial<Record<AttributionUrlParam, string>> = {};
  for (const key of ATTRIBUTION_URL_PARAMS) {
    const value = attribution[key];
    if (value) out[key] = value;
  }
  return out;
}

/** Meta's click-id cookie format, used when the Pixel was not loaded to set `_fbc` itself. */
export function fbcFromFbclid(fbclid: string, nowMs: number): string {
  return `fb.1.${nowMs}.${fbclid}`;
}

export function isValidGa4MeasurementId(value: unknown): value is string {
  return typeof value === "string" && /^G-[A-Z0-9]{4,16}$/.test(value);
}

export function isValidMetaPixelId(value: unknown): value is string {
  return typeof value === "string" && /^\d{6,20}$/.test(value);
}

export function isValidDomainVerification(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(value);
}
