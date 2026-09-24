// What checkout carries forward for the purchase conversion. Stripe session metadata is
// the only channel from /api/subscribe to the webhook, so attribution rides there.
import { cleanAttributionValue, sanitizeAttribution, trackedPlan } from "../../shared/tracking.js";
import { serverTrackingEnabled, type ServerTrackingConfig } from "./config.js";
import { hashExternalId } from "./hash.js";

const STRIPE_METADATA_VALUE_MAX = 500;

function cleanUserAgent(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, STRIPE_METADATA_VALUE_MAX);
  return cleaned ? cleaned : null;
}

function cleanIp(value: unknown): string | null {
  const cleaned = cleanAttributionValue(value);
  return cleaned && /^[0-9A-Fa-f:.]{3,45}$/.test(cleaned) ? cleaned : null;
}

/**
 * Stripe checkout-session metadata for the purchase conversion, or `undefined` when no
 * server-side tracker is configured (so the session is created exactly as before).
 */
export function checkoutTrackingMetadata(args: {
  config: ServerTrackingConfig;
  checkoutPlan: string;
  attribution: unknown;
  steamId: string;
  userAgent?: string | null;
  ip?: string | null;
}): Record<string, string> | undefined {
  if (!serverTrackingEnabled(args.config)) return undefined;
  try {
    const metadata: Record<string, string> = {};
    const plan = trackedPlan(args.checkoutPlan);
    if (plan) metadata.tub_plan = plan;
    const xid = hashExternalId(args.steamId);
    if (xid) metadata.tub_xid = xid;
    const ua = cleanUserAgent(args.userAgent);
    if (ua) metadata.tub_ua = ua;
    const ip = cleanIp(args.ip);
    if (ip) metadata.tub_ip = ip;
    return { ...metadata, ...sanitizeAttribution(args.attribution) };
  } catch {
    return undefined;
  }
}

/** Extra fields for GET /api/checkout-session so the success page never double-sends GA4 purchase. */
export function checkoutSessionTrackingFields(config: ServerTrackingConfig): { ga4_server_side?: true } {
  return config.ga4Mp ? { ga4_server_side: true } : {};
}
