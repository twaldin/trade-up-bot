// Post-checkout GA4 purchase reporting. Verifies the Stripe session server-side (amount,
// ownership) before firing, and dedupes per session id so a refresh can't double-count.
import { trackPurchase } from "./analytics.js";

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
    const data: { transaction_id: string; value: number; currency: string } = await res.json();
    trackPurchase({
      transactionId: data.transaction_id,
      value: data.value,
      currency: data.currency,
      tier,
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
