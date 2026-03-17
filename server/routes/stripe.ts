// Stripe subscription management: checkout, webhook, portal.

import { Router } from "express";
import type { Request, Response } from "express";
import Stripe from "stripe";
import Database from "better-sqlite3";
import { requireAuth, type User } from "../auth.js";

// Read at request time, not module load (env may not be loaded yet)
function getPlan(plan: string): { priceId: string; name: string } | null {
  if (plan === "basic") return { priceId: process.env.STRIPE_BASIC_PRICE_ID || "", name: "Basic" };
  if (plan === "pro") return { priceId: process.env.STRIPE_PRO_PRICE_ID || "", name: "Pro" };
  return null;
}

export function stripeRouter(db: Database.Database): Router {
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
      res.status(400).json({ error: "Invalid plan. Use 'basic' or 'pro'." });
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
        db.prepare("UPDATE users SET stripe_customer_id = ? WHERE steam_id = ?").run(customerId, user.steam_id);
      }

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "subscription",
        line_items: [{ price: getPlan(plan)!.priceId, quantity: 1 }],
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
    const sig = req.headers["stripe-signature"] as string;
    let event: Stripe.Event;

    try {
      // For webhook verification, need raw body
      const rawBody = (req as any).rawBody || JSON.stringify(req.body);
      event = webhookSecret
        ? stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)
        : req.body as Stripe.Event;
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

        // Map price ID → tier
        let tier = "free";
        if (status === "active" || status === "trialing") {
          if (priceId === getPlan("pro")!.priceId) tier = "pro";
          else if (priceId === getPlan("basic")!.priceId) tier = "basic";
        }

        db.prepare("UPDATE users SET tier = ? WHERE stripe_customer_id = ?").run(tier, customerId);
        console.log(`Stripe: customer ${customerId} → ${tier}`);
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;
        db.prepare("UPDATE users SET tier = 'free' WHERE stripe_customer_id = ?").run(customerId);
        console.log(`Stripe: customer ${customerId} → free (cancelled)`);
        break;
      }
    }

    res.json({ received: true });
  });

  return router;
}
