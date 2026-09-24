// Post-checkout purchase reporting. Verifies the Stripe session server-side (amount,
// ownership) before firing. localStorage dedupes across tabs; the in-flight set stops two
// tabs that read storage before either write from both reporting.
import { trackPurchaseComplete } from "./conversions.js";

const FIRED_PREFIX = "tub_purchase_";
const PENDING_TTL_MS = 60_000;
const inflight = new Set<string>();

function pendingIsFresh(value: string, now: number): boolean {
  if (!value.startsWith("pending:")) return false;
  const started = Number(value.slice("pending:".length));
  return Number.isFinite(started) && now - started < PENDING_TTL_MS;
}

function claim(sessionId: string): boolean {
  const firedKey = FIRED_PREFIX + sessionId;
  if (inflight.has(sessionId)) return false;
  try {
    const existing = window.localStorage.getItem(firedKey);
    if (existing === "1" || (existing != null && pendingIsFresh(existing, Date.now()))) return false;
    window.localStorage.setItem(firedKey, `pending:${Date.now()}`);
  } catch {
    // storage blocked — the in-memory set still covers this document
  }
  inflight.add(sessionId);
  return true;
}

export async function reportPurchase(tier: string, sessionId: string): Promise<void> {
  if (!claim(sessionId)) return;
  const firedKey = FIRED_PREFIX + sessionId;
  try {
    const res = await fetch(`/api/checkout-session/${encodeURIComponent(sessionId)}`, {
      credentials: "include",
    });
    if (!res.ok) {
      try { window.localStorage.removeItem(firedKey); } catch { /* ignore */ }
      return;
    }
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
      window.localStorage.setItem(firedKey, "1");
    } catch {
      // ignore — dedup is best-effort
    }
  } catch {
    try { window.localStorage.removeItem(firedKey); } catch { /* ignore */ }
  } finally {
    inflight.delete(sessionId);
  }
}
