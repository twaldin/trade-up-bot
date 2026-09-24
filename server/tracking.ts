// Barrel for server-side conversion tracking (GA4 Measurement Protocol + Meta CAPI).
export { serverTrackingConfig, serverTrackingEnabled } from "./tracking/config.js";
export type { Ga4MpConfig, MetaCapiConfig, ServerTrackingConfig, TrackingEnv } from "./tracking/config.js";
export { hashEmail, hashExternalId, sha256Hex } from "./tracking/hash.js";
export { checkoutSessionTrackingFields, checkoutTrackingMetadata } from "./tracking/checkout.js";
export {
  ga4PurchaseRequest,
  metaPurchaseRequest,
  purchaseConversionFromSession,
  resolvePurchasePlan,
  sendPurchaseConversions,
  trackCheckoutCompleted,
} from "./tracking/purchase.js";
export type { CheckoutSessionLike, PurchaseConversion, SendOutcome, TrackCheckoutCompletedArgs } from "./tracking/purchase.js";
export { trackingCspSources } from "./tracking/csp.js";
