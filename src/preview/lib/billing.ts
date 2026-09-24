/** Existing Stripe customer-portal endpoint (server/routes/stripe.ts). Cancellation happens in the portal. */
export const BILLING_PORTAL_API = "/api/billing-portal";

const FALLBACK_ERROR = "Could not open billing. Try again.";

export { hasProAccess } from "../../../shared/pro-access.js";

/** Opens the Stripe billing portal for the signed-in user. Resolves to an error message, or null once redirecting. */
export async function openBillingPortal(
  fetchImpl: typeof fetch = fetch,
  go: (url: string) => void = (url) => window.location.assign(url),
): Promise<string | null> {
  try {
    const res = await fetchImpl(BILLING_PORTAL_API, { method: "POST", credentials: "include" });
    const data = await res.json() as { url?: string; error?: string };
    if (res.ok && data.url) {
      go(data.url);
      return null;
    }
    return data.error || FALLBACK_ERROR;
  } catch {
    return FALLBACK_ERROR;
  }
}
