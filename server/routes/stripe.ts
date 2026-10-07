// Stripe subscription management: checkout, webhook, portal.

import { Router } from "express";
import type { Request, Response } from "express";
import Stripe from "stripe";
import { requireAuth, invalidateAllUserCache, invalidateUserCache, type User } from "../auth.js";
import { syncDiscordRoles } from "../discord-rest.js";
import {
  applyStripeWebhookEvent,
  claimStripeWebhookEvent,
  ensureStripeWebhookEvents,
  type StripeClient,
  type StripePool,
} from "../stripe-entitlement.js";
import {
  checkoutSessionTrackingFields,
  checkoutTrackingMetadata,
  serverTrackingConfig,
  singleSteamId,
  trackCheckoutCompleted,
} from "../tracking.js";

// Read at request time, not module load (env may not be loaded yet)
function getPlan(plan: string): { priceId: string; name: string; mode: "subscription" | "payment" } | null {
  if (plan === "pro") return { priceId: process.env.STRIPE_PRO_PRICE_ID || "", name: "Pro", mode: "subscription" };
  if (plan === "pro-yearly") return { priceId: process.env.STRIPE_PRO_YEARLY_PRICE_ID || "", name: "Pro Yearly", mode: "subscription" };
  if (plan === "pro-lifetime") return { priceId: process.env.STRIPE_PRO_LIFETIME_PRICE_ID || "", name: "Pro Lifetime", mode: "payment" };
  return null;
}

const checkoutLocks = new Map<string, Promise<void>>();

/** Serialize checkout for one user inside this process. Redis is not required for the API. */
function withCheckoutLock<T>(steamId: string, fn: () => Promise<T>): Promise<T> {
  const prev = checkoutLocks.get(steamId) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const settled = run.then(() => undefined, () => undefined);
  checkoutLocks.set(steamId, settled);
  void settled.finally(() => {
    if (checkoutLocks.get(steamId) === settled) checkoutLocks.delete(steamId);
  });
  return run;
}

export function stripeRouter(
  pool: StripePool,
  // Tests pass Checkout line-item fixtures here. Production calls Stripe.
  deps?: {
    listLineItems?: (sessionId: string) => Promise<{ data: Array<{ price?: { id?: string } | null }> }>;
  },
): Router {
  const router = Router();
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    console.log("Stripe not configured — subscription routes disabled");
    return router;
  }

  const stripe = new Stripe(stripeKey);
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
  const listCheckoutLineItems = deps?.listLineItems ?? (async (sessionId: string) => {
    const items = await stripe.checkout.sessions.listLineItems(sessionId);
    return {
      data: items.data.map((item) => ({ price: item.price ? { id: item.price.id } : null })),
    };
  });

  // Create checkout session for upgrading
  router.post("/api/subscribe", requireAuth, async (req: Request, res: Response) => {
    const user = req.user as User;
    const plan = req.body?.plan as string;
    if (!plan || !getPlan(plan)) {
      res.status(400).json({ error: "Invalid plan. Use pro, pro-yearly, or pro-lifetime." });
      return;
    }

    try {
      await withCheckoutLock(user.steam_id, async () => {
        // Read tier fresh. The cached Passport user can lag a webhook, and a second checkout
        // would double-charge someone who already has Pro or lifetime.
        const { rows } = await pool.query<{ tier: string; lifetime: boolean; stripe_customer_id: string | null }>(
          "SELECT tier, lifetime, stripe_customer_id FROM users WHERE steam_id = $1",
          [user.steam_id],
        );
        const row = rows[0];
        const alreadyPro = row?.tier === "pro" || row?.lifetime === true;
        if (alreadyPro) {
          const buyingLifetime = plan === "pro-lifetime" && row?.lifetime !== true;
          res.status(409).json({
            error: buyingLifetime
              ? "Cancel your current plan in Manage subscription first, then buy Lifetime."
              : "You already have Pro access. Manage your subscription instead of starting a new checkout.",
          });
          return;
        }

        // A past_due or unpaid subscription is stored as tier free, so the tier check above
        // misses it. Refuse checkout while any subscription is still open.
        let customerId: string | null = row?.stripe_customer_id || user.stripe_customer_id || null;
        if (customerId) {
          const listed = await stripe.subscriptions.list({ customer: customerId, status: "all" });
          const failedPayment = listed.data.some((sub) => sub.status === "past_due" || sub.status === "unpaid");
          const open = listed.data.some((sub) =>
            sub.status === "active" || sub.status === "trialing" || sub.status === "past_due"
            || sub.status === "unpaid" || sub.status === "incomplete",
          );
          if (open) {
            res.status(409).json({
              error: plan === "pro-lifetime"
                ? "Cancel your current plan in Manage subscription first, then buy Lifetime."
                : failedPayment
                  ? "Your last payment didn't go through. Update your payment method in Manage subscription."
                  : "You already have a subscription. Use Manage subscription instead of starting a new checkout.",
            });
            return;
          }
        }

        if (!customerId) {
          const customer = await stripe.customers.create({
            metadata: { steam_id: user.steam_id, display_name: user.display_name },
          });
          customerId = customer.id;
          await pool.query("UPDATE users SET stripe_customer_id = $1 WHERE steam_id = $2", [customerId, user.steam_id]);
          invalidateUserCache(user.steam_id);
        }

        const planInfo = getPlan(plan)!;
        const bucket = Math.floor(Date.now() / (10 * 60 * 1000));
        const realIp = req.headers["x-real-ip"];
        const trackingMetadata = checkoutTrackingMetadata({
          config: serverTrackingConfig(),
          checkoutPlan: plan,
          attribution: req.body?.attribution,
          steamId: user.steam_id,
          userAgent: req.headers["user-agent"],
          ip: typeof realIp === "string" && realIp ? realIp : req.ip,
        });
        const session = await stripe.checkout.sessions.create({
          customer: customerId,
          mode: planInfo.mode,
          line_items: [{ price: planInfo.priceId, quantity: 1 }],
          allow_promotion_codes: true,
          success_url: `${process.env.BASE_URL}/?upgraded=${plan}&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.BASE_URL}/?cancelled=true`,
          ...(trackingMetadata ? { metadata: trackingMetadata } : {}),
        }, { idempotencyKey: `checkout_${user.steam_id}_${plan}_${bucket}` });

        res.json({ url: session.url });
      });
    } catch (err: any) {
      console.error("Stripe checkout error:", err.message);
      if (!res.headersSent) res.status(500).json({ error: "Failed to create checkout session" });
    }
  });

  // Verified checkout lookup — the post-checkout return page calls this to fire a GA4
  // `purchase` event with a SERVER-confirmed amount (the ?upgraded query alone is forgeable).
  router.get("/api/checkout-session/:id", requireAuth, async (req: Request, res: Response) => {
    const user = req.user as User;
    try {
      // Read the customer id FRESH from the DB — the cached Passport user can be stale for a
      // first-time buyer whose customer id was created during this same checkout flow.
      // Kept inside try so a DB rejection returns a controlled response (Express 4 won't
      // catch an async rejection otherwise).
      const { rows } = await pool.query<{ stripe_customer_id: string | null }>(
        "SELECT stripe_customer_id FROM users WHERE steam_id = $1",
        [user.steam_id],
      );
      const customerId: string | null = rows[0]?.stripe_customer_id ?? null;
      if (!customerId) {
        res.status(404).json({ error: "No checkout session" });
        return;
      }
      const cs = await stripe.checkout.sessions.retrieve(String(req.params.id));
      // Ownership + payment guards: only the buyer can read it, and only once paid.
      if (cs.customer !== customerId) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      if (cs.payment_status !== "paid") {
        res.status(409).json({ error: "Not paid" });
        return;
      }
      res.json({
        transaction_id: cs.id,
        value: (cs.amount_total ?? 0) / 100,
        currency: (cs.currency ?? "usd").toUpperCase(),
        ...checkoutSessionTrackingFields(serverTrackingConfig()),
      });
    } catch {
      res.status(404).json({ error: "Checkout session not found" });
    }
  });

  // Customer portal (manage subscription, cancel, update payment)
  router.post("/api/billing-portal", requireAuth, async (req: Request, res: Response) => {
    const user = req.user as User;
    if (!user.stripe_customer_id) {
      res.status(400).json({ error: "Your Pro access was granted directly; there's no billing to manage." });
      return;
    }

    try {
      const session = await stripe.billingPortal.sessions.create({
        customer: user.stripe_customer_id,
        return_url: `${process.env.BASE_URL}/`,
      });
      res.json({ url: session.url });
    } catch (err: any) {
      console.error("Stripe portal error:", err.message);
      res.status(500).json({ error: "Failed to create portal session" });
    }
  });

  // Webhook: Stripe notifies us of subscription changes
  router.post("/api/stripe-webhook", async (req: Request, res: Response) => {
    if (!webhookSecret) {
      console.error("Stripe webhook secret not configured");
      res.status(500).json({ error: "Webhook not configured" });
      return;
    }

    const sig = req.headers["stripe-signature"] as string | undefined;
    if (!sig) {
      res.status(400).json({ error: "Missing stripe-signature header" });
      return;
    }

    let event: Stripe.Event;

    try {
      // req.body is a raw Buffer from express.raw() middleware
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err: any) {
      console.error("Webhook signature verification failed:", err.message);
      res.status(400).send("Webhook Error");
      return;
    }

    let client: StripeClient | undefined;
    let begun = false;
    try {
      await ensureStripeWebhookEvents(pool);
      client = await pool.connect();
      await client.query("BEGIN");
      begun = true;
      const claimed = await claimStripeWebhookEvent(client, event.id, event.type);
      if (!claimed) {
        await client.query("COMMIT");
        begun = false;
        res.json({ received: true });
        return;
      }

      const effect = await applyStripeWebhookEvent(client, listCheckoutLineItems, event);
      await client.query("COMMIT");
      begun = false;

      if (effect.invalidate) invalidateAllUserCache();
      if (effect.discord) {
        syncDiscordRoles(effect.discord.discordId, effect.discord.tier).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`Discord role sync failed: ${message}`);
        });
      }

      if (event.type === "checkout.session.completed") {
        try {
          const cs = event.data.object as Stripe.Checkout.Session;
          void trackCheckoutCompleted({
            session: cs,
            eventCreatedSec: event.created,
            listLineItemPriceIds: async () => {
              const items = await listCheckoutLineItems(cs.id);
              return items.data.flatMap((item) => (item.price?.id ? [item.price.id] : []));
            },
            lookupSteamId: async (customerId) => {
              try {
                const { rows } = await pool.query<{ steam_id: string }>(
                  "SELECT steam_id FROM users WHERE stripe_customer_id = $1",
                  [customerId],
                );
                return singleSteamId(rows);
              } catch {
                return null;
              }
            },
          });
        } catch {
          // Conversion tracking is best-effort; it must never fail the webhook.
        }
      }

      res.json({ received: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Stripe webhook handler failed:", message);
      if (begun && client) {
        await client.query("ROLLBACK").catch((rollbackErr: unknown) => {
          const rollbackMessage = rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
          console.error("Stripe webhook rollback failed:", rollbackMessage);
        });
      }
      if (!res.headersSent) res.status(500).json({ error: "Webhook handler failed" });
    } finally {
      client?.release();
    }
  });

  return router;
}
