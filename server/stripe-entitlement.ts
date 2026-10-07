// Stripe webhook entitlement rules. Prices and products stay in the subscribe route.
// This module decides when a checkout may grant lifetime Pro, and when a
// subscription event is allowed to change tier.

import type Stripe from "stripe";

export type LifetimeCheckoutAction = "grant" | "revoke" | "ignore";

export interface StripeQueryResult<T> {
  rows: T[];
  rowCount: number | null;
}

export interface StripeQueryable {
  query<T = Record<string, unknown>>(
    queryText: string,
    values?: unknown[],
  ): Promise<StripeQueryResult<T>>;
}

export interface StripeClient extends StripeQueryable {
  release(): void;
}

export interface StripePool extends StripeQueryable {
  connect(): Promise<StripeClient>;
}

export interface WebhookEffect {
  discord: { discordId: string; tier: string } | null;
  invalidate: boolean;
}

export interface SubscriptionPrices {
  pro: string;
  yearly?: string;
  basic?: string;
}

export interface TierGuardUser {
  lifetime: boolean;
  is_admin: boolean;
}

const NO_EFFECT: WebhookEffect = { discord: null, invalidate: false };

export const STRIPE_WEBHOOK_EVENTS_DDL = `CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`;

const eventsTableReady = new WeakMap<StripePool, Promise<void>>();

/**
 * A completed Checkout Session grants lifetime only after Stripe has nothing
 * left to collect: `paid`, or `no_payment_required` (a 100% coupon). `unpaid`
 * is a delayed method and waits for async_payment_succeeded. Failure revokes.
 */
export function lifetimeCheckoutAction(
  eventType: string,
  paymentStatus: string | null | undefined,
): LifetimeCheckoutAction {
  if (eventType === "checkout.session.async_payment_succeeded") return "grant";
  if (eventType === "checkout.session.async_payment_failed") return "revoke";
  if (eventType !== "checkout.session.completed") return "ignore";
  if (paymentStatus === "paid" || paymentStatus === "no_payment_required") return "grant";
  return "ignore";
}

/** Active and trialing pro, yearly, and grandfathered basic prices map to pro. */
export function tierFromSubscription(
  status: string,
  priceId: string | undefined,
  prices: SubscriptionPrices,
): "pro" | "free" {
  if (status !== "active" && status !== "trialing") return "free";
  if (priceId === prices.pro) return "pro";
  if (prices.yearly && priceId === prices.yearly) return "pro";
  if (prices.basic && priceId === prices.basic) return "pro";
  return "free";
}

export function tierForSubscriptionEvent(
  eventType: string,
  status: string,
  priceId: string | undefined,
  prices: SubscriptionPrices,
): "pro" | "free" {
  if (eventType === "customer.subscription.deleted") return "free";
  return tierFromSubscription(status, priceId, prices);
}

/**
 * After a lifetime payment fails, drop the lifetime flag and derive tier again.
 * An admin keeps their current tier. An active or trialing paid price stays pro.
 * Everyone else goes free.
 */
export function tierAfterLifetimeRevoke(
  user: { is_admin: boolean; tier: string },
  subscriptions: ReadonlyArray<{ status: string; priceId?: string }>,
  prices: SubscriptionPrices,
): string {
  const stillPro = subscriptions.some(
    (sub) => tierFromSubscription(sub.status, sub.priceId, prices) === "pro",
  );
  if (stillPro) return "pro";
  if (user.is_admin) return user.tier;
  return "free";
}

/** Lifetime and admin are never written down to free by a subscription webhook. */
export function subscriptionTierChangeAllowed(
  user: TierGuardUser | undefined,
  nextTier: "pro" | "free",
): boolean {
  if (nextTier === "pro") return true;
  if (!user) return true;
  return !user.lifetime && !user.is_admin;
}

export function ensureStripeWebhookEvents(pool: StripePool): Promise<void> {
  const pending = eventsTableReady.get(pool);
  if (pending) return pending;
  const created = pool.query(STRIPE_WEBHOOK_EVENTS_DDL).then(() => undefined, (err: unknown) => {
    eventsTableReady.delete(pool);
    throw err;
  });
  eventsTableReady.set(pool, created);
  return created;
}

/** True when this delivery is the first time we have seen the event id. */
export async function claimStripeWebhookEvent(
  client: StripeQueryable,
  id: string,
  type: string,
): Promise<boolean> {
  const result = await client.query<{ id: string }>(
    "INSERT INTO stripe_webhook_events (id, type) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id",
    [id, type],
  );
  return (result.rowCount ?? result.rows.length) > 0;
}

export async function applyStripeWebhookEvent(
  client: StripeQueryable,
  listLineItems: (sessionId: string) => Promise<{ data: Array<{ price?: { id?: string } | null }> }>,
  event: Stripe.Event,
  listSubscriptions?: (customerId: string) => Promise<Array<{ status: string; priceId?: string }>>,
): Promise<WebhookEffect> {
  if (isSubscriptionEvent(event.type)) return applySubscriptionEvent(client, event);
  if (isCheckoutEvent(event.type)) return applyCheckoutEvent(client, listLineItems, event, listSubscriptions);
  return NO_EFFECT;
}

function isSubscriptionEvent(eventType: string): boolean {
  return eventType === "customer.subscription.created"
    || eventType === "customer.subscription.updated"
    || eventType === "customer.subscription.deleted";
}

function isCheckoutEvent(eventType: string): boolean {
  return eventType === "checkout.session.completed"
    || eventType === "checkout.session.async_payment_succeeded"
    || eventType === "checkout.session.async_payment_failed";
}

function customerIdOf(customer: string | { id: string } | null | undefined): string | null {
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

function subscriptionPrices(): SubscriptionPrices {
  return {
    pro: process.env.STRIPE_PRO_PRICE_ID || "",
    yearly: process.env.STRIPE_PRO_YEARLY_PRICE_ID || "",
    basic: process.env.STRIPE_BASIC_PRICE_ID || "",
  };
}

async function applySubscriptionEvent(client: StripeQueryable, event: Stripe.Event): Promise<WebhookEffect> {
  const sub = event.data.object as Stripe.Subscription;
  const customerId = customerIdOf(sub.customer);
  if (!customerId) return NO_EFFECT;

  const nextTier = tierForSubscriptionEvent(
    event.type,
    sub.status,
    sub.items?.data[0]?.price?.id,
    subscriptionPrices(),
  );
  const { rows } = await client.query<{ lifetime: boolean; is_admin: boolean; discord_id: string | null }>(
    "SELECT lifetime, is_admin, discord_id FROM users WHERE stripe_customer_id = $1",
    [customerId],
  );
  const user = rows[0];
  const guardUser = user ? { lifetime: user.lifetime, is_admin: user.is_admin } : undefined;
  if (!subscriptionTierChangeAllowed(guardUser, nextTier)) {
    const reason = user?.lifetime ? "lifetime" : "admin";
    console.log(`Stripe: customer ${customerId} subscription event skipped — ${reason} is not downgraded`);
    return NO_EFFECT;
  }

  await client.query("UPDATE users SET tier = $1 WHERE stripe_customer_id = $2", [nextTier, customerId]);
  const label = event.type === "customer.subscription.deleted" ? `${nextTier} (cancelled)` : nextTier;
  console.log(`Stripe: customer ${customerId} -> ${label}`);
  return {
    discord: user?.discord_id ? { discordId: user.discord_id, tier: nextTier } : null,
    invalidate: true,
  };
}

async function applyCheckoutEvent(
  client: StripeQueryable,
  listLineItems: (sessionId: string) => Promise<{ data: Array<{ price?: { id?: string } | null }> }>,
  event: Stripe.Event,
  listSubscriptions?: (customerId: string) => Promise<Array<{ status: string; priceId?: string }>>,
): Promise<WebhookEffect> {
  const cs = event.data.object as Stripe.Checkout.Session;
  const action = lifetimeCheckoutAction(event.type, cs.payment_status);
  if (action === "ignore") {
    if (event.type === "checkout.session.completed" && cs.mode === "payment" && cs.payment_status === "unpaid") {
      console.log(`Stripe: checkout ${cs.id} unpaid — not granting lifetime`);
    }
    return NO_EFFECT;
  }

  const lifetimePriceId = process.env.STRIPE_PRO_LIFETIME_PRICE_ID || "";
  const customerId = customerIdOf(cs.customer);
  if (!lifetimePriceId || !customerId) return NO_EFFECT;

  const lineItems = await listLineItems(cs.id);
  const hasLifetime = lineItems.data.some((item) => item.price?.id === lifetimePriceId);
  if (!hasLifetime) return NO_EFFECT;

  if (action === "grant") {
    await client.query(
      "UPDATE users SET tier = 'pro', lifetime = true WHERE stripe_customer_id = $1",
      [customerId],
    );
    console.log(`Stripe: customer ${customerId} -> pro (lifetime)`);
    const discordId = await discordIdFor(client, customerId);
    return {
      discord: discordId ? { discordId, tier: "pro" } : null,
      invalidate: true,
    };
  }

  if (action === "revoke") {
    const { rows } = await client.query<{
      tier: string;
      lifetime: boolean;
      is_admin: boolean;
      discord_id: string | null;
    }>(
      "SELECT tier, lifetime, is_admin, discord_id FROM users WHERE stripe_customer_id = $1",
      [customerId],
    );
    const user = rows[0];
    if (!user?.lifetime) {
      console.log(`Stripe: checkout ${cs.id} async payment failed — no lifetime grant to revoke`);
      return NO_EFFECT;
    }
    const subscriptions = listSubscriptions ? await listSubscriptions(customerId) : [];
    const nextTier = tierAfterLifetimeRevoke(user, subscriptions, subscriptionPrices());
    const revoked = await client.query<{ discord_id: string | null }>(
      `UPDATE users SET lifetime = false, tier = $2
       WHERE stripe_customer_id = $1 AND lifetime = true
       RETURNING discord_id`,
      [customerId, nextTier],
    );
    if ((revoked.rowCount ?? revoked.rows.length) === 0) return NO_EFFECT;
    console.log(`Stripe: customer ${customerId} -> ${nextTier} (lifetime payment failed)`);
    const discordId = revoked.rows[0]?.discord_id ?? user.discord_id;
    return {
      discord: discordId ? { discordId, tier: nextTier } : null,
      invalidate: true,
    };
  }

  const unreachable: never = action;
  return unreachable;
}

async function discordIdFor(client: StripeQueryable, customerId: string): Promise<string | null> {
  const { rows } = await client.query<{ discord_id: string | null }>(
    "SELECT discord_id FROM users WHERE stripe_customer_id = $1",
    [customerId],
  );
  return rows[0]?.discord_id ?? null;
}
