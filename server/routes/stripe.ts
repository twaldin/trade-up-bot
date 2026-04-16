// Stripe subscription management: checkout, webhook, portal.

import { Router } from "express";
import type { Request, Response } from "express";
import Stripe from "stripe";
import pg from "pg";
import { requireAuth, invalidateAllUserCache, type User } from "../auth.js";
import { syncDiscordRoles } from "../discord-rest.js";

// Read at request time, not module load (env may not be loaded yet)
function getPlan(plan: string): { priceId: string; name: string; mode: "subscription" | "payment" } | null {
  if (plan === "pro") return { priceId: process.env.STRIPE_PRO_PRICE_ID || "", name: "Pro", mode: "subscription" };
  if (plan === "pro-yearly") return { priceId: process.env.STRIPE_PRO_YEARLY_PRICE_ID || "", name: "Pro Yearly", mode: "subscription" };
  if (plan === "pro-lifetime") return { priceId: process.env.STRIPE_PRO_LIFETIME_PRICE_ID || "", name: "Pro Lifetime", mode: "payment" };
  return null;
}

export function stripeRouter(pool: pg.Pool): Router {
  const router = Router();
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    console.log("Stripe not configured — subscription routes disabled");
    return router;
  }

  const stripe = new Stripe(stripeKey);
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";

  // Create checkout session for upgrading
  router.post("/api/subscribe", requireAuth, async (req: Request, res: Response) => {
    const user = req.user as User;
    const plan = req.body?.plan as string;
    if (!plan || !getPlan(plan)) {
      res.status(400).json({ error: "Invalid plan. Use pro, pro-yearly, or pro-lifetime." });
      return;
    }

    try {
      // Create or reuse Stripe customer
      let customerId = user.stripe_customer_id;
      if (!customerId) {
        const customer = await stripe.customers.create({
          metadata: { steam_id: user.steam_id, display_name: user.display_name },
        });
        customerId = customer.id;
        await pool.query("UPDATE users SET stripe_customer_id = $1 WHERE steam_id = $2", [customerId, user.steam_id]);
      }

      const planInfo = getPlan(plan)!;
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: planInfo.mode,
        line_items: [{ price: planInfo.priceId, quantity: 1 }],
        allow_promotion_codes: true,
        success_url: `${process.env.BASE_URL}/?upgraded=${plan}`,
        cancel_url: `${process.env.BASE_URL}/?cancelled=true`,
      });

      res.json({ url: session.url });
    } catch (err: any) {
      console.error("Stripe checkout error:", err.message);
      res.status(500).json({ error: "Failed to create checkout session" });
    }
  });

  // Customer portal (manage subscription, cancel, update payment)
  router.post("/api/billing-portal", requireAuth, async (req: Request, res: Response) => {
    const user = req.user as User;
    if (!user.stripe_customer_id) {
      res.status(400).json({ error: "No subscription found" });
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

    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;
        const status = sub.status;
        const priceId = sub.items.data[0]?.price?.id;

        // Map price ID -> tier (basic and yearly grandfathered/mapped to pro)
        let tier = "free";
        if (status === "active" || status === "trialing") {
          const basicPriceId = process.env.STRIPE_BASIC_PRICE_ID;
          const yearlyPriceId = process.env.STRIPE_PRO_YEARLY_PRICE_ID;
          if (priceId === getPlan("pro")!.priceId) tier = "pro";
          else if (yearlyPriceId && priceId === yearlyPriceId) tier = "pro";
          else if (basicPriceId && priceId === basicPriceId) tier = "pro";
        }

        await pool.query("UPDATE users SET tier = $1 WHERE stripe_customer_id = $2", [tier, customerId]);
        // Invalidate user cache so tier change is immediate (no 60s stale window)
        invalidateAllUserCache();
        console.log(`Stripe: customer ${customerId} -> ${tier}`);

        // Sync Discord role if user has linked their account
        pool.query("SELECT discord_id FROM users WHERE stripe_customer_id = $1", [customerId])
          .then(({ rows }) => {
            if (rows[0]?.discord_id) {
              syncDiscordRoles(rows[0].discord_id, tier).catch(err =>
                console.error(`Discord role sync failed: ${err.message}`));
            }
          })
          .catch(() => {}); // non-blocking
        break;
      }

      case "checkout.session.completed": {
        const cs = event.data.object as Stripe.Checkout.Session;
        const lifetimePriceId = process.env.STRIPE_PRO_LIFETIME_PRICE_ID;
        if (!lifetimePriceId || !cs.customer) break;

        const lineItems = await stripe.checkout.sessions.listLineItems(cs.id);
        const hasLifetime = lineItems.data.some(item => item.price?.id === lifetimePriceId);
        if (!hasLifetime) break;

        const ltCustomerId = cs.customer as string;
        await pool.query("UPDATE users SET tier = 'pro', lifetime = true WHERE stripe_customer_id = $1", [ltCustomerId]);
        invalidateAllUserCache();
        console.log(`Stripe: customer ${ltCustomerId} -> pro (lifetime)`);

        pool.query("SELECT discord_id FROM users WHERE stripe_customer_id = $1", [ltCustomerId])
          .then(({ rows }) => {
            if (rows[0]?.discord_id) {
              syncDiscordRoles(rows[0].discord_id, "pro").catch(err =>
                console.error(`Discord role sync failed: ${err.message}`));
            }
          })
          .catch(() => {});
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;

        // Never downgrade lifetime users
        const { rows: userRows } = await pool.query(
          "SELECT lifetime, discord_id FROM users WHERE stripe_customer_id = $1", [customerId]
        );
        if (userRows[0]?.lifetime) {
          console.log(`Stripe: customer ${customerId} cancelled subscription but has lifetime — skipping downgrade`);
          break;
        }

        await pool.query("UPDATE users SET tier = 'free' WHERE stripe_customer_id = $1", [customerId]);
        invalidateAllUserCache();
        console.log(`Stripe: customer ${customerId} -> free (cancelled)`);

        // Sync Discord role
        if (userRows[0]?.discord_id) {
          syncDiscordRoles(userRows[0].discord_id, "free").catch(err =>
            console.error(`Discord role sync failed: ${err.message}`));
        }
        break;
      }
    }

    res.json({ received: true });
  });

  return router;
}
