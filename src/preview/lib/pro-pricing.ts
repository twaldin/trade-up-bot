// Pro plan strings shared by the /pricing Pro card and the Steam interstitial, so the
// modal can never quote a different price than the card. Values mirror the Stripe prices
// and server/static-seo-pages.ts; change them only together.

export type BillingInterval = "monthly" | "yearly" | "lifetime";

export const PLAN_FOR: Record<BillingInterval, string> = {
  monthly: "pro",
  yearly: "pro-yearly",
  lifetime: "pro-lifetime",
};

export interface ProPrice {
  amount: string;
  unit: string;
  note?: string;
}

export const PRO_PRICE: Record<BillingInterval, ProPrice> = {
  monthly: { amount: "$6.99", unit: "/mo" },
  yearly: { amount: "$5", unit: "/mo", note: "billed $59.99/year" },
  lifetime: { amount: "$74.99", unit: " one-time" },
};

/** The price line split into the headline amount and the rest, e.g. "$5" + "/mo · billed $59.99/year". */
export function proPriceParts(billing: BillingInterval): { amount: string; rest: string } {
  const price = PRO_PRICE[billing];
  return { amount: price.amount, rest: `${price.unit}${price.note ? ` · ${price.note}` : ""}` };
}

export function proPriceLine(billing: BillingInterval): string {
  const { amount, rest } = proPriceParts(billing);
  return `${amount}${rest}`;
}

/** The Pro card's feature list after "Everything in Free", in card order. */
export const PRO_FEATURES = [
  "Real-time data (no delay)",
  "Claim system (30 min lock)",
  "Up to 5 active claims",
  "Verify availability (20/hr)",
  "Claims (10/hr)",
] as const;
