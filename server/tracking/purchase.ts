// Server-side purchase conversion: Meta Conversions API `Purchase` + GA4 Measurement
// Protocol `purchase`, fired from the Stripe webhook. Every entry point here resolves and
// never throws — a tracking failure must never fail the webhook.
import {
  PLAN_PRICE_CENTS,
  campaignParams,
  centsToUsd,
  purchaseEventId,
  sanitizeAttribution,
  trackedPlan,
  type Attribution,
  type AttributionUrlParam,
  type TrackedPlan,
} from "../../shared/tracking.js";
import {
  serverTrackingConfig,
  serverTrackingEnabled,
  type Ga4MpConfig,
  type MetaCapiConfig,
  type ServerTrackingConfig,
  type TrackingEnv,
} from "./config.js";
import { hashEmail, isSha256Hex, sha256Hex } from "./hash.js";

const META_GRAPH_VERSION = "v24.0";
const DEFAULT_TIMEOUT_MS = 4000;

/** The fields read from a Stripe Checkout Session (a `Stripe.Checkout.Session` satisfies this). */
export interface CheckoutSessionLike {
  id: string;
  amount_total: number | null;
  currency: string | null;
  payment_status: string;
  mode: string | null;
  metadata: Record<string, string> | null;
  customer_details?: { email?: string | null } | null;
}

export interface PurchaseConversion {
  eventId: string;
  transactionId: string;
  plan: TrackedPlan;
  valueCents: number;
  priceCents: number;
  currency: string;
  eventTimeSec: number;
  emailHash: string | null;
  externalIdHash: string | null;
  userAgent: string | null;
  ip: string | null;
  attribution: Attribution;
}

export type SendOutcome = "skipped" | "ok" | "timeout" | "error" | `http_${number}`;

export function purchaseConversionFromSession(
  session: CheckoutSessionLike,
  opts: { eventCreatedSec: number; plan: TrackedPlan },
): PurchaseConversion | null {
  if (session.payment_status !== "paid") return null;
  const metadata = session.metadata ?? {};
  return {
    eventId: purchaseEventId(session.id),
    transactionId: session.id,
    plan: opts.plan,
    valueCents: session.amount_total ?? PLAN_PRICE_CENTS[opts.plan],
    priceCents: PLAN_PRICE_CENTS[opts.plan],
    currency: (session.currency ?? "usd").toUpperCase(),
    eventTimeSec: opts.eventCreatedSec,
    emailHash: hashEmail(session.customer_details?.email),
    externalIdHash: isSha256Hex(metadata.tub_xid) ? metadata.tub_xid : null,
    userAgent: metadata.tub_ua || null,
    ip: metadata.tub_ip || null,
    attribution: sanitizeAttribution(metadata),
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(onTimeout()), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Plan stamped at checkout, else the line-item price, else the checkout mode. */
export async function resolvePurchasePlan(
  session: CheckoutSessionLike,
  listLineItemPriceIds: () => Promise<string[]>,
  env: TrackingEnv,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<TrackedPlan> {
  const stamped = trackedPlan(session.metadata?.tub_plan);
  if (stamped) return stamped;
  const byPrice: Array<[string | undefined, TrackedPlan]> = [
    [env.STRIPE_PRO_LIFETIME_PRICE_ID, "lifetime"],
    [env.STRIPE_PRO_YEARLY_PRICE_ID, "yearly"],
    [env.STRIPE_PRO_PRICE_ID, "pro_monthly"],
  ];
  try {
    const priceIds = await withTimeout(Promise.resolve().then(listLineItemPriceIds), timeoutMs, () => []);
    for (const [priceId, plan] of byPrice) {
      if (priceId && priceIds.includes(priceId)) return plan;
    }
  } catch {
    // Stripe lookup failed — fall through to the mode-based guess.
  }
  return session.mode === "payment" ? "lifetime" : "pro_monthly";
}

export interface MetaEventsBody {
  data: Array<{
    event_name: "Purchase";
    event_time: number;
    event_id: string;
    action_source: "website";
    event_source_url: string;
    user_data: {
      em?: string[];
      external_id?: string[];
      client_ip_address?: string;
      client_user_agent?: string;
      fbc?: string;
      fbp?: string;
    };
    custom_data: {
      currency: string;
      value: number;
      content_name: TrackedPlan;
      plan: TrackedPlan;
      price_usd: number;
    } & Partial<Record<AttributionUrlParam, string>>;
  }>;
  access_token: string;
  test_event_code?: string;
}

export function metaPurchaseRequest(conv: PurchaseConversion, capi: MetaCapiConfig, baseUrl: string): { url: string; body: MetaEventsBody } {
  const userData: MetaEventsBody["data"][number]["user_data"] = {};
  if (conv.emailHash) userData.em = [conv.emailHash];
  if (conv.externalIdHash) userData.external_id = [conv.externalIdHash];
  if (conv.ip) userData.client_ip_address = conv.ip;
  if (conv.userAgent) userData.client_user_agent = conv.userAgent;
  if (conv.attribution.fbc) userData.fbc = conv.attribution.fbc;
  if (conv.attribution.fbp) userData.fbp = conv.attribution.fbp;
  const body: MetaEventsBody = {
    data: [{
      event_name: "Purchase",
      event_time: conv.eventTimeSec,
      event_id: conv.eventId,
      action_source: "website",
      event_source_url: `${baseUrl.replace(/\/+$/, "")}/`,
      user_data: userData,
      custom_data: {
        currency: conv.currency,
        value: centsToUsd(conv.valueCents),
        content_name: conv.plan,
        plan: conv.plan,
        price_usd: centsToUsd(conv.priceCents),
        ...campaignParams(conv.attribution),
      },
    }],
    access_token: capi.accessToken,
  };
  if (capi.testEventCode) body.test_event_code = capi.testEventCode;
  return { url: `https://graph.facebook.com/${META_GRAPH_VERSION}/${capi.pixelId}/events`, body };
}

type Ga4PurchaseParams = {
  transaction_id: string;
  value: number;
  currency: string;
  plan: TrackedPlan;
  price_usd: number;
  items: Array<{ item_id: TrackedPlan; item_name: TrackedPlan; price: number; quantity: number }>;
  engagement_time_msec: number;
  session_id?: string;
  debug_mode?: boolean;
} & Partial<Record<AttributionUrlParam, string>>;

export interface Ga4MpBody {
  client_id: string;
  timestamp_micros: number;
  events: Array<{ name: "purchase"; params: Ga4PurchaseParams }>;
}

// GA4 requires a client_id; without the browser's _ga cookie, derive a stable one from the
// transaction so Stripe retries map to the same pseudo-user (revenue still lands, unattributed).
function ga4ClientId(conv: PurchaseConversion): string {
  const fromCookie = conv.attribution.ga_client_id;
  if (fromCookie && /^\d+\.\d+$/.test(fromCookie)) return fromCookie;
  return `${parseInt(sha256Hex(conv.transactionId).slice(0, 8), 16)}.${conv.eventTimeSec}`;
}

export function ga4PurchaseRequest(conv: PurchaseConversion, mp: Ga4MpConfig): { url: string; body: Ga4MpBody } {
  const value = centsToUsd(conv.valueCents);
  const params: Ga4PurchaseParams = {
    transaction_id: conv.transactionId,
    value,
    currency: conv.currency,
    plan: conv.plan,
    price_usd: centsToUsd(conv.priceCents),
    items: [{ item_id: conv.plan, item_name: conv.plan, price: value, quantity: 1 }],
    engagement_time_msec: 1,
    ...campaignParams(conv.attribution),
  };
  const sessionId = conv.attribution.ga_session_id;
  if (sessionId && /^\d+$/.test(sessionId)) params.session_id = sessionId;
  if (mp.debug) params.debug_mode = true;
  const query = `measurement_id=${encodeURIComponent(mp.measurementId)}&api_secret=${encodeURIComponent(mp.apiSecret)}`;
  return {
    url: `https://www.google-analytics.com/mp/collect?${query}`,
    body: { client_id: ga4ClientId(conv), timestamp_micros: conv.eventTimeSec * 1_000_000, events: [{ name: "purchase", params }] },
  };
}

async function postJson(url: string, body: object, fetchImpl: typeof fetch, timeoutMs: number): Promise<SendOutcome> {
  const controller = new AbortController();
  const request = (async (): Promise<SendOutcome> => {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    void res.body?.cancel().catch(() => {});
    return res.ok ? "ok" : `http_${res.status}`;
  })().catch((): SendOutcome => "error");
  return withTimeout(request, timeoutMs, (): SendOutcome => {
    controller.abort();
    return "timeout";
  });
}

function safeLog(log: (message: string) => void, message: string): void {
  try {
    log(message);
  } catch {
    // A broken logger must not break tracking, and tracking must not break the webhook.
  }
}

/** Sends to every configured endpoint. Resolves with per-endpoint outcomes; never rejects. */
export async function sendPurchaseConversions(
  conv: PurchaseConversion,
  config: ServerTrackingConfig,
  deps: { fetchImpl?: typeof fetch; baseUrl: string; log?: (message: string) => void; timeoutMs?: number },
): Promise<{ meta: SendOutcome; ga4: SendOutcome }> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const log = deps.log ?? ((message: string) => console.warn(message));
  const send = (req: { url: string; body: object } | null): Promise<SendOutcome> =>
    req ? postJson(req.url, req.body, fetchImpl, timeoutMs) : Promise.resolve("skipped");
  try {
    const [meta, ga4] = await Promise.all([
      send(config.metaCapi ? metaPurchaseRequest(conv, config.metaCapi, deps.baseUrl) : null),
      send(config.ga4Mp ? ga4PurchaseRequest(conv, config.ga4Mp) : null),
    ]);
    if (meta !== "skipped" || ga4 !== "skipped") {
      // Outcomes only: never the URL (GA4 secret), body (token, hashes), or error text.
      safeLog(log, `[tracking] purchase conversion: meta_capi=${meta} ga4_mp=${ga4}`);
    }
    return { meta, ga4 };
  } catch {
    return { meta: "error", ga4: "error" };
  }
}

export interface TrackCheckoutCompletedArgs {
  session: CheckoutSessionLike;
  eventCreatedSec: number;
  listLineItemPriceIds: () => Promise<string[]>;
  env?: TrackingEnv;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
  timeoutMs?: number;
}

/**
 * Webhook side-effect for `checkout.session.completed`. Fire-and-forget: callers should not
 * await it. The returned promise always resolves, and the call never throws synchronously.
 */
export function trackCheckoutCompleted(args: TrackCheckoutCompletedArgs): Promise<void> {
  try {
    const env = args.env ?? process.env;
    const config = serverTrackingConfig(env);
    if (!serverTrackingEnabled(config) || args.session.payment_status !== "paid") return Promise.resolve();
    return (async () => {
      const plan = await resolvePurchasePlan(args.session, args.listLineItemPriceIds, env, args.timeoutMs);
      const conv = purchaseConversionFromSession(args.session, { eventCreatedSec: args.eventCreatedSec, plan });
      if (!conv) return;
      await sendPurchaseConversions(conv, config, {
        fetchImpl: args.fetchImpl,
        baseUrl: env.BASE_URL || "https://tradeupbot.app",
        log: args.log,
        timeoutMs: args.timeoutMs,
      });
    })().catch(() => {});
  } catch {
    return Promise.resolve();
  }
}
