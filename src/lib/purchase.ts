// Post-checkout purchase reporting. Verifies the Stripe session server-side (amount,
// ownership) before firing, and dedupes per session id so a refresh can't double-count.
import { trackPurchaseComplete } from "./conversions.js";

const FIRED_PREFIX = "tub_purchase_";

export async function reportPurchase(tier: string, sessionId: string): Promise<void> {
  const firedKey = FIRED_PREFIX + sessionId;
  try {
    if (window.sessionStorage.getItem(firedKey) === "1") return;
  } catch {
    // sessionStorage unavailable — proceed (worst case a rare double-count)
  }
  try {
    const res = await fetch(`/api/checkout-session/${encodeURIComponent(sessionId)}`, {
      credentials: "include",
    });
    if (!res.ok) return;
    const data: { transaction_id: string; value: number; currency: string; ga4_server_side?: boolean } = await res.json();
    trackPurchaseComplete({
      sessionId,
      checkoutPlan: tier,
      transactionId: data.transaction_id,
      value: data.value,
      currency: data.currency,
      ga4ServerSide: data.ga4_server_side === true,
    });
    try {
      window.sessionStorage.setItem(firedKey, "1");
    } catch {
      // ignore — dedup is best-effort
    }
  } catch {
    // verification failed — do not report an unverified purchase
  }
}
