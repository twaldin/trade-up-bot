// Whether a retrieved Checkout Session may back a browser GA4 purchase.
// The return URL's session id is caller-supplied, so payment and ownership are decided here.

export interface CheckoutOwnershipSession {
  id: string;
  customer: string | { id: string } | null;
  payment_status: string;
  amount_total: number | null;
  currency: string | null;
}

export interface ConfirmedCheckoutBody {
  transaction_id: string;
  value: number;
  currency: string;
}

export type CheckoutGate =
  | { ok: true; body: ConfirmedCheckoutBody }
  | { ok: false; status: 403 | 409 };

/** Stripe returns `customer` as an id string unless the field was expanded. */
export function checkoutCustomerId(customer: string | { id: string } | null): string | null {
  if (typeof customer === "string") return customer.length > 0 ? customer : null;
  if (customer === null) return null;
  return customer.id.length > 0 ? customer.id : null;
}

/**
 * Paid checkout that belongs to this user's Stripe customer.
 * Anything else stays a non-2xx so the browser does not emit `purchase`.
 */
export function gatePaidCheckout(session: CheckoutOwnershipSession, userCustomerId: string): CheckoutGate {
  const sessionCustomer = checkoutCustomerId(session.customer);
  if (sessionCustomer !== userCustomerId) return { ok: false, status: 403 };
  if (session.payment_status !== "paid") return { ok: false, status: 409 };
  return {
    ok: true,
    body: {
      transaction_id: session.id,
      value: (session.amount_total ?? 0) / 100,
      currency: (session.currency ?? "usd").toUpperCase(),
    },
  };
}
