import express from "express";
import request from "supertest";
import pg from "pg";
import Stripe from "stripe";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { STRIPE_WEBHOOK_EVENTS_DDL } from "../../server/stripe-entitlement.js";

const harness = vi.hoisted(() => ({
  listLineItems: vi.fn(async (_sessionId: string) => ({ data: [] as Array<{ price: { id: string } | null }> })),
  syncDiscordRoles: vi.fn(async (_discordId: string, _tier: string) => {}),
}));

vi.mock("../../server/discord-rest.js", () => ({
  syncDiscordRoles: harness.syncDiscordRoles,
}));

const { stripeRouter } = await import("../../server/routes/stripe.js");

const WEBHOOK_SECRET = "whsec_test_entitlement";
const LIFETIME_PRICE = "price_life_test";
const PRO_PRICE = "price_pro_test";
const YEARLY_PRICE = "price_year_test";
const BASIC_PRICE = "price_basic_test";

const base =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgresql://tradeupbot:tradeupbot_pg_2026@localhost:5432/tradeupbot_test";
const schema = `stripe_wh_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const sep = base.includes("?") ? "&" : "?";
const scoped = `${base}${sep}options=-c%20search_path%3D${schema}`;

const ENV_KEYS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRO_PRICE_ID",
  "STRIPE_PRO_YEARLY_PRICE_ID",
  "STRIPE_PRO_LIFETIME_PRICE_ID",
  "STRIPE_BASIC_PRICE_ID",
] as const;
const saved = new Map<string, string | undefined>();

let admin: pg.Pool;
let pool: pg.Pool;
let app: express.Express;

type UserRow = { tier: string; lifetime: boolean; is_admin: boolean; discord_id: string | null };

function lifetimeLines() {
  return { data: [{ price: { id: LIFETIME_PRICE } }] };
}

function checkoutEvent(input: {
  id: string;
  type: "checkout.session.completed" | "checkout.session.async_payment_succeeded" | "checkout.session.async_payment_failed";
  paymentStatus: string;
  customer: string;
  sessionId?: string;
  mode?: string;
}) {
  return JSON.stringify({
    id: input.id,
    object: "event",
    type: input.type,
    created: 1_700_000_100,
    livemode: false,
    api_version: "2024-06-20",
    data: {
      object: {
        id: input.sessionId ?? "cs_test_life",
        object: "checkout.session",
        mode: input.mode ?? "payment",
        payment_status: input.paymentStatus,
        customer: input.customer,
        amount_total: 7499,
        currency: "usd",
        metadata: {},
      },
    },
  });
}

function subscriptionEvent(input: {
  id: string;
  type: "customer.subscription.created" | "customer.subscription.updated" | "customer.subscription.deleted";
  customer: string;
  status: string;
  priceId?: string;
}) {
  return JSON.stringify({
    id: input.id,
    object: "event",
    type: input.type,
    created: 1_700_000_100,
    livemode: false,
    api_version: "2024-06-20",
    data: {
      object: {
        id: "sub_test_old",
        object: "subscription",
        customer: input.customer,
        status: input.status,
        items: {
          object: "list",
          data: [{
            id: "si_test",
            object: "subscription_item",
            price: { id: input.priceId ?? PRO_PRICE, object: "price" },
          }],
        },
      },
    },
  });
}

function post(payload: string) {
  const sig = new Stripe("sk_test_entitlement").webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });
  return request(app)
    .post("/api/stripe-webhook")
    .set("Content-Type", "application/json")
    .set("stripe-signature", sig)
    .send(payload);
}

async function seed(input: {
  steamId: string;
  customerId: string;
  tier: string;
  lifetime?: boolean;
  isAdmin?: boolean;
  discordId?: string | null;
}) {
  await pool.query(
    `INSERT INTO users (steam_id, display_name, avatar_url, tier, lifetime, is_admin, stripe_customer_id, discord_id)
     VALUES ($1, $2, '', $3, $4, $5, $6, $7)`,
    [
      input.steamId,
      input.steamId,
      input.tier,
      input.lifetime ?? false,
      input.isAdmin ?? false,
      input.customerId,
      input.discordId ?? null,
    ],
  );
}

async function userByCustomer(customerId: string): Promise<UserRow> {
  const { rows } = await pool.query<UserRow>(
    "SELECT tier, lifetime, is_admin, discord_id FROM users WHERE stripe_customer_id = $1",
    [customerId],
  );
  const row = rows[0];
  if (!row) throw new Error(`missing user ${customerId}`);
  return row;
}

beforeAll(async () => {
  for (const key of ENV_KEYS) saved.set(key, process.env[key]);
  process.env.STRIPE_SECRET_KEY = "sk_test_entitlement";
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.STRIPE_PRO_PRICE_ID = PRO_PRICE;
  process.env.STRIPE_PRO_YEARLY_PRICE_ID = YEARLY_PRICE;
  process.env.STRIPE_PRO_LIFETIME_PRICE_ID = LIFETIME_PRICE;
  process.env.STRIPE_BASIC_PRICE_ID = BASIC_PRICE;

  admin = new pg.Pool({ connectionString: base });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  pool = new pg.Pool({ connectionString: scoped, max: 4 });
  await pool.query(`
    CREATE TABLE users (
      steam_id TEXT PRIMARY KEY,
      display_name TEXT,
      avatar_url TEXT,
      tier TEXT NOT NULL DEFAULT 'free',
      lifetime BOOLEAN NOT NULL DEFAULT false,
      is_admin BOOLEAN NOT NULL DEFAULT false,
      stripe_customer_id TEXT,
      discord_id TEXT
    )
  `);
  await pool.query(STRIPE_WEBHOOK_EVENTS_DDL);

  app = express();
  app.use((req, res, next) => {
    if (req.path === "/api/stripe-webhook") express.raw({ type: "application/json" })(req, res, next);
    else express.json()(req, res, next);
  });
  app.use(stripeRouter(pool, { listLineItems: harness.listLineItems }));
}, 30_000);

afterAll(async () => {
  await pool?.end();
  if (admin) {
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
    await admin.end();
  }
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(async () => {
  harness.listLineItems.mockReset();
  harness.listLineItems.mockResolvedValue(lifetimeLines());
  harness.syncDiscordRoles.mockReset();
  await pool.query("DELETE FROM stripe_webhook_events");
  await pool.query("DELETE FROM users");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("lifetime checkout payment status", () => {
  it("does not grant Pro when checkout.session.completed is unpaid", async () => {
    await seed({ steamId: "life_unpaid", customerId: "cus_unpaid", tier: "free", discordId: "disc_unpaid" });
    const res = await post(checkoutEvent({
      id: "evt_unpaid",
      type: "checkout.session.completed",
      paymentStatus: "unpaid",
      customer: "cus_unpaid",
    }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
    expect(await userByCustomer("cus_unpaid")).toMatchObject({ tier: "free", lifetime: false });
    expect(harness.listLineItems).not.toHaveBeenCalled();
    expect(harness.syncDiscordRoles).not.toHaveBeenCalled();
  });

  it("grants Pro when checkout.session.completed is paid and the line item is the lifetime price", async () => {
    await seed({ steamId: "life_paid", customerId: "cus_paid", tier: "free", discordId: "disc_paid" });
    const res = await post(checkoutEvent({
      id: "evt_paid",
      type: "checkout.session.completed",
      paymentStatus: "paid",
      customer: "cus_paid",
    }));
    expect(res.status).toBe(200);
    expect(await userByCustomer("cus_paid")).toMatchObject({ tier: "pro", lifetime: true });
    expect(harness.syncDiscordRoles).toHaveBeenCalledWith("disc_paid", "pro");
  });

  it("grants Pro when a 100% coupon leaves payment_status no_payment_required", async () => {
    await seed({ steamId: "life_coupon", customerId: "cus_coupon", tier: "free" });
    const res = await post(checkoutEvent({
      id: "evt_coupon",
      type: "checkout.session.completed",
      paymentStatus: "no_payment_required",
      customer: "cus_coupon",
    }));
    expect(res.status).toBe(200);
    expect(await userByCustomer("cus_coupon")).toMatchObject({ tier: "pro", lifetime: true });
  });

  it("does not grant Pro for a paid checkout of a different price", async () => {
    harness.listLineItems.mockResolvedValueOnce({ data: [{ price: { id: PRO_PRICE } }] });
    await seed({ steamId: "monthly", customerId: "cus_monthly", tier: "free" });
    const res = await post(checkoutEvent({
      id: "evt_monthly",
      type: "checkout.session.completed",
      paymentStatus: "paid",
      customer: "cus_monthly",
      mode: "subscription",
    }));
    expect(res.status).toBe(200);
    expect(await userByCustomer("cus_monthly")).toMatchObject({ tier: "free", lifetime: false });
  });

  it("grants Pro on async_payment_succeeded after an unpaid completion", async () => {
    await seed({ steamId: "life_async", customerId: "cus_async", tier: "free", discordId: "disc_async" });
    const unpaid = await post(checkoutEvent({
      id: "evt_async_unpaid",
      type: "checkout.session.completed",
      paymentStatus: "unpaid",
      customer: "cus_async",
      sessionId: "cs_async",
    }));
    expect(unpaid.status).toBe(200);
    expect(await userByCustomer("cus_async")).toMatchObject({ tier: "free", lifetime: false });

    const succeeded = await post(checkoutEvent({
      id: "evt_async_ok",
      type: "checkout.session.async_payment_succeeded",
      paymentStatus: "unpaid",
      customer: "cus_async",
      sessionId: "cs_async",
    }));
    expect(succeeded.status).toBe(200);
    expect(await userByCustomer("cus_async")).toMatchObject({ tier: "pro", lifetime: true });
    expect(harness.syncDiscordRoles).toHaveBeenCalledWith("disc_async", "pro");
  });

  it("revokes lifetime Pro on async_payment_failed", async () => {
    await seed({
      steamId: "life_fail",
      customerId: "cus_fail",
      tier: "pro",
      lifetime: true,
      discordId: "disc_fail",
    });
    const res = await post(checkoutEvent({
      id: "evt_async_fail",
      type: "checkout.session.async_payment_failed",
      paymentStatus: "unpaid",
      customer: "cus_fail",
    }));
    expect(res.status).toBe(200);
    expect(await userByCustomer("cus_fail")).toMatchObject({ tier: "free", lifetime: false });
    expect(harness.syncDiscordRoles).toHaveBeenCalledWith("disc_fail", "free");
  });
});

describe("subscription tier guard", () => {
  it("does not let subscription.updated write a lifetime account back to free", async () => {
    await seed({
      steamId: "life_sub",
      customerId: "cus_life_sub",
      tier: "pro",
      lifetime: true,
      discordId: "disc_life",
    });
    const res = await post(subscriptionEvent({
      id: "evt_life_updated",
      type: "customer.subscription.updated",
      customer: "cus_life_sub",
      status: "past_due",
    }));
    expect(res.status).toBe(200);
    expect(await userByCustomer("cus_life_sub")).toMatchObject({ tier: "pro", lifetime: true });
    expect(harness.syncDiscordRoles).not.toHaveBeenCalled();
  });

  it("does not let subscription.deleted write a lifetime account back to free", async () => {
    await seed({ steamId: "life_del", customerId: "cus_life_del", tier: "pro", lifetime: true });
    const res = await post(subscriptionEvent({
      id: "evt_life_deleted",
      type: "customer.subscription.deleted",
      customer: "cus_life_del",
      status: "canceled",
    }));
    expect(res.status).toBe(200);
    expect(await userByCustomer("cus_life_del")).toMatchObject({ tier: "pro", lifetime: true });
  });

  it("does not let an incomplete subscription.created downgrade lifetime", async () => {
    await seed({ steamId: "life_created", customerId: "cus_life_created", tier: "pro", lifetime: true });
    const res = await post(subscriptionEvent({
      id: "evt_life_created",
      type: "customer.subscription.created",
      customer: "cus_life_created",
      status: "incomplete",
    }));
    expect(res.status).toBe(200);
    expect(await userByCustomer("cus_life_created")).toMatchObject({ tier: "pro", lifetime: true });
  });

  it("does not let subscription.updated or deleted downgrade an admin", async () => {
    await seed({
      steamId: "admin_sub",
      customerId: "cus_admin",
      tier: "pro",
      isAdmin: true,
      discordId: "disc_admin",
    });
    const updated = await post(subscriptionEvent({
      id: "evt_admin_updated",
      type: "customer.subscription.updated",
      customer: "cus_admin",
      status: "past_due",
    }));
    expect(updated.status).toBe(200);
    const deleted = await post(subscriptionEvent({
      id: "evt_admin_deleted",
      type: "customer.subscription.deleted",
      customer: "cus_admin",
      status: "canceled",
    }));
    expect(deleted.status).toBe(200);
    expect(await userByCustomer("cus_admin")).toMatchObject({ tier: "pro", lifetime: false, is_admin: true });
    expect(harness.syncDiscordRoles).not.toHaveBeenCalled();
  });

  it("still downgrades an ordinary subscriber on updated and deleted", async () => {
    await seed({ steamId: "plain_upd", customerId: "cus_plain_upd", tier: "pro", discordId: "disc_plain" });
    const updated = await post(subscriptionEvent({
      id: "evt_plain_updated",
      type: "customer.subscription.updated",
      customer: "cus_plain_upd",
      status: "past_due",
    }));
    expect(updated.status).toBe(200);
    expect(await userByCustomer("cus_plain_upd")).toMatchObject({ tier: "free", lifetime: false });
    expect(harness.syncDiscordRoles).toHaveBeenCalledWith("disc_plain", "free");

    harness.syncDiscordRoles.mockClear();
    await seed({ steamId: "plain_del", customerId: "cus_plain_del", tier: "pro", discordId: "disc_plain_del" });
    const deleted = await post(subscriptionEvent({
      id: "evt_plain_deleted",
      type: "customer.subscription.deleted",
      customer: "cus_plain_del",
      status: "canceled",
    }));
    expect(deleted.status).toBe(200);
    expect(await userByCustomer("cus_plain_del")).toMatchObject({ tier: "free", lifetime: false });
    expect(harness.syncDiscordRoles).toHaveBeenCalledWith("disc_plain_del", "free");
  });

  it("still upgrades an ordinary subscriber, including the yearly price", async () => {
    await seed({ steamId: "plain_up", customerId: "cus_up", tier: "free" });
    await seed({ steamId: "year_user", customerId: "cus_year", tier: "free" });
    const monthly = await post(subscriptionEvent({
      id: "evt_plain_up",
      type: "customer.subscription.updated",
      customer: "cus_up",
      status: "active",
    }));
    const yearly = await post(subscriptionEvent({
      id: "evt_year",
      type: "customer.subscription.updated",
      customer: "cus_year",
      status: "trialing",
      priceId: YEARLY_PRICE,
    }));
    expect(monthly.status).toBe(200);
    expect(yearly.status).toBe(200);
    expect(await userByCustomer("cus_up")).toMatchObject({ tier: "pro", lifetime: false });
    expect(await userByCustomer("cus_year")).toMatchObject({ tier: "pro", lifetime: false });
  });

  it("still lets an active subscription set pro on a lifetime row that was left free", async () => {
    await seed({ steamId: "life_heal", customerId: "cus_life_heal", tier: "free", lifetime: true });
    const res = await post(subscriptionEvent({
      id: "evt_life_heal",
      type: "customer.subscription.updated",
      customer: "cus_life_heal",
      status: "active",
    }));
    expect(res.status).toBe(200);
    expect(await userByCustomer("cus_life_heal")).toMatchObject({ tier: "pro", lifetime: true });
  });
});

describe("webhook event id idempotency", () => {
  it("does not apply a replay of the same event id", async () => {
    await seed({ steamId: "life_once", customerId: "cus_once", tier: "free" });
    const payload = checkoutEvent({
      id: "evt_paid_once",
      type: "checkout.session.completed",
      paymentStatus: "paid",
      customer: "cus_once",
    });
    expect((await post(payload)).status).toBe(200);
    expect(await userByCustomer("cus_once")).toMatchObject({ tier: "pro", lifetime: true });

    await pool.query(
      "UPDATE users SET tier = 'free', lifetime = false WHERE stripe_customer_id = $1",
      ["cus_once"],
    );
    expect((await post(payload)).status).toBe(200);
    expect(await userByCustomer("cus_once")).toMatchObject({ tier: "free", lifetime: false });

    const { rows } = await pool.query("SELECT id FROM stripe_webhook_events WHERE id = $1", ["evt_paid_once"]);
    expect(rows).toHaveLength(1);
  });

  it("does not consume the event id when fulfillment throws, so a retry can grant", async () => {
    await seed({ steamId: "life_retry", customerId: "cus_retry", tier: "free" });
    harness.listLineItems.mockRejectedValueOnce(new Error("stripe down"));
    const payload = checkoutEvent({
      id: "evt_retry",
      type: "checkout.session.completed",
      paymentStatus: "paid",
      customer: "cus_retry",
    });
    const first = await post(payload);
    expect(first.status).toBe(500);
    expect(await userByCustomer("cus_retry")).toMatchObject({ tier: "free", lifetime: false });
    const mid = await pool.query("SELECT id FROM stripe_webhook_events WHERE id = $1", ["evt_retry"]);
    expect(mid.rows).toEqual([]);

    harness.listLineItems.mockResolvedValueOnce(lifetimeLines());
    const second = await post(payload);
    expect(second.status).toBe(200);
    expect(await userByCustomer("cus_retry")).toMatchObject({ tier: "pro", lifetime: true });
  });
});
