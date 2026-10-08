import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import Stripe from "stripe";
import pg from "pg";
import { createTestApp, seedTestData, type TestContext } from "./setup.js";
import { applyStripeWebhookEvent, LIFETIME_GRANTS_DDL } from "../../server/stripe-entitlement.js";

const LIFETIME_USER = "user_lifetime";
const OTHER_USER = "user_pro2";
const CUSTOMER = "cus_mtu_life";
const GRANT_SESSION = "cs_mtu_grant";
const GRANT_INTENT = "pi_mtu_grant";
const LIFETIME_PRICE = "price_life_mtu";
const NOT_FOUND = { error: "Trade-up entry not found" };
const PRO_REQUIRED = { error: "Requires pro tier" };
const LOGIN_REQUIRED = { error: "Login required" };

const stripe = new Stripe("sk_test_my_trade_ups");
const webhookSecret = "whsec_test_my_trade_ups";

type Headers = Record<string, string>;

interface RouteCall {
  method: "get" | "post" | "delete";
  path: string;
  body?: Record<string, unknown>;
}

function lifetimeHeaders(): Headers {
  return {
    "X-Test-User-Id": LIFETIME_USER,
    "X-Test-User-Tier": "free",
    "X-Test-User-Lifetime": "true",
  };
}

function sessionHeaders(steamId: string, row: { tier: string; lifetime: boolean }): Headers {
  const headers: Headers = {
    "X-Test-User-Id": steamId,
    "X-Test-User-Tier": row.tier,
  };
  if (row.lifetime) headers["X-Test-User-Lifetime"] = "true";
  return headers;
}

function fiveRoutes(ids: { execute: number; sell: number; delete: number }): RouteCall[] {
  return [
    { method: "get", path: "/api/my-trade-ups/stats" },
    { method: "get", path: "/api/my-trade-ups" },
    { method: "post", path: `/api/my-trade-ups/${ids.execute}/execute`, body: { outcome_index: 0 } },
    {
      method: "post",
      path: `/api/my-trade-ups/${ids.sell}/sell`,
      body: { price_cents: 15000, marketplace: "csfloat" },
    },
    { method: "delete", path: `/api/my-trade-ups/${ids.delete}` },
  ];
}

async function call(app: TestContext["app"], spec: RouteCall, headers: Headers) {
  const req = request(app)[spec.method](spec.path).set(headers);
  if (spec.body) req.send(spec.body);
  return req;
}

async function insertUserTradeUp(
  pool: pg.Pool,
  overrides: { user_id: string; trade_up_id: number; status: string },
): Promise<number> {
  const executed = overrides.status === "executed" || overrides.status === "sold";
  const { rows } = await pool.query(
    `INSERT INTO user_trade_ups
       (user_id, trade_up_id, status, snapshot_inputs, snapshot_outcomes,
        total_cost_cents, expected_value_cents, roi_percentage, chance_to_profit,
        best_case_cents, worst_case_cents, type, executed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id`,
    [
      overrides.user_id,
      overrides.trade_up_id,
      overrides.status,
      JSON.stringify([{ skin_name: "AK-47 | Test Skin", collection_name: "Test Collection Alpha", price_cents: 2000, float_value: 0.15, condition: "Field-Tested", source: "csfloat", stattrak: false }]),
      JSON.stringify([{ skin_name: "AK-47 | Fire Serpent", skin_id: "skin-covert-1", probability: 1, price_cents: 12000, condition: "Field-Tested", predicted_float: 0.15 }]),
      10000,
      12000,
      20,
      0.8,
      5000,
      -2000,
      "covert_knife",
      executed ? new Date().toISOString() : null,
    ],
  );
  return rows[0].id;
}

function failedCheckoutEvent(id: string, sessionId: string, paymentIntent: string): Stripe.Event {
  const payload = JSON.stringify({
    id,
    object: "event",
    type: "checkout.session.async_payment_failed",
    created: 1_700_000_100,
    livemode: false,
    api_version: "2024-06-20",
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        mode: "payment",
        payment_status: "unpaid",
        customer: CUSTOMER,
        amount_total: 7499,
        currency: "usd",
        metadata: {},
        payment_intent: paymentIntent,
      },
    },
  });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
  return stripe.webhooks.constructEvent(payload, header, webhookSecret);
}

async function userRow(pool: pg.Pool) {
  const { rows } = await pool.query<{ tier: string; lifetime: boolean }>(
    "SELECT tier, lifetime FROM users WHERE steam_id = $1",
    [LIFETIME_USER],
  );
  const row = rows[0];
  if (!row) throw new Error("missing lifetime user");
  return row;
}

describe("my-trade-ups effective pro access", () => {
  let ctx: TestContext;
  let tradeUpId = 8000;

  beforeEach(async () => {
    ctx = await createTestApp({ defaultTier: "pro", defaultUserId: "user_pro" });
    await seedTestData(ctx.pool);
    await ctx.pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS lifetime BOOLEAN NOT NULL DEFAULT false");
    await ctx.pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_id TEXT");
    await ctx.pool.query(LIFETIME_GRANTS_DDL);
    await ctx.pool.query(
      `INSERT INTO users (steam_id, display_name, avatar_url, tier, lifetime, is_admin, stripe_customer_id)
       VALUES ($1, $2, '', 'free', true, false, $3)`,
      [LIFETIME_USER, "Lifetime", CUSTOMER],
    );
    await ctx.pool.query(
      `INSERT INTO lifetime_grants (stripe_customer_id, checkout_session_id, payment_intent_id)
       VALUES ($1, $2, $3)`,
      [CUSTOMER, GRANT_SESSION, GRANT_INTENT],
    );
    tradeUpId = 8000;
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  function nextTradeUpId(): number {
    tradeUpId += 1;
    return tradeUpId;
  }

  async function ownedIds(userId: string) {
    const execute = await insertUserTradeUp(ctx.pool, { user_id: userId, trade_up_id: nextTradeUpId(), status: "purchased" });
    const sell = await insertUserTradeUp(ctx.pool, { user_id: userId, trade_up_id: nextTradeUpId(), status: "executed" });
    const remove = await insertUserTradeUp(ctx.pool, { user_id: userId, trade_up_id: nextTradeUpId(), status: "purchased" });
    return { execute, sell, delete: remove };
  }

  it("gives a lifetime user with tier free 200 on all five routes", async () => {
    const ids = await ownedIds(LIFETIME_USER);
    const headers = lifetimeHeaders();

    const stats = await call(ctx.app, { method: "get", path: "/api/my-trade-ups/stats" }, headers);
    expect(stats.status).toBe(200);
    expect(stats.body.all_time_profit_cents).toBe(0);

    const list = await call(ctx.app, { method: "get", path: "/api/my-trade-ups" }, headers);
    expect(list.status).toBe(200);
    expect(list.body.trade_ups).toHaveLength(3);

    const executed = await call(ctx.app, fiveRoutes(ids)[2], headers);
    expect(executed.status).toBe(200);
    expect(executed.body.status).toBe("executed");

    const sold = await call(ctx.app, fiveRoutes(ids)[3], headers);
    expect(sold.status).toBe(200);
    expect(sold.body.status).toBe("sold");

    const removed = await call(ctx.app, fiveRoutes(ids)[4], headers);
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ deleted: true });
  });

  it("keeps plain free users at 403 and signed-out users at 401 on all five routes", async () => {
    const ids = { execute: 1, sell: 1, delete: 1 };
    const free: Headers = { "X-Test-User-Id": "user_free", "X-Test-User-Tier": "free" };
    const signedOut: Headers = { "X-Test-User-Id": "anonymous" };

    for (const spec of fiveRoutes(ids)) {
      const denied = await call(ctx.app, spec, free);
      expect(denied.status, spec.path).toBe(403);
      expect(denied.body).toEqual(PRO_REQUIRED);

      const loggedOut = await call(ctx.app, spec, signedOut);
      expect(loggedOut.status, spec.path).toBe(401);
      expect(loggedOut.body).toEqual(LOGIN_REQUIRED);
    }
  });

  it("drops a lifetime user back to 403 after the granting session is revoked", async () => {
    const savedPrice = process.env.STRIPE_PRO_LIFETIME_PRICE_ID;
    process.env.STRIPE_PRO_LIFETIME_PRICE_ID = LIFETIME_PRICE;
    try {
      const before = await userRow(ctx.pool);
      expect(before).toEqual({ tier: "free", lifetime: true });
      const open = await call(ctx.app, { method: "get", path: "/api/my-trade-ups/stats" }, sessionHeaders(LIFETIME_USER, before));
      expect(open.status).toBe(200);

      const otherSession = await applyStripeWebhookEvent(
        ctx.pool,
        async () => ({ data: [{ price: { id: LIFETIME_PRICE } }] }),
        failedCheckoutEvent("evt_mtu_other", "cs_mtu_other", "pi_mtu_other"),
        async () => [],
      );
      expect(otherSession.invalidate).toBe(false);
      const stillLifetime = await userRow(ctx.pool);
      expect(stillLifetime).toEqual({ tier: "free", lifetime: true });
      const stillOpen = await call(
        ctx.app,
        { method: "get", path: "/api/my-trade-ups/stats" },
        sessionHeaders(LIFETIME_USER, stillLifetime),
      );
      expect(stillOpen.status).toBe(200);

      const revoked = await applyStripeWebhookEvent(
        ctx.pool,
        async () => ({ data: [{ price: { id: LIFETIME_PRICE } }] }),
        failedCheckoutEvent("evt_mtu_grant", GRANT_SESSION, GRANT_INTENT),
        async () => [],
      );
      expect(revoked.invalidate).toBe(true);
      const after = await userRow(ctx.pool);
      expect(after).toEqual({ tier: "free", lifetime: false });
      const grants = await ctx.pool.query("SELECT 1 FROM lifetime_grants WHERE stripe_customer_id = $1", [CUSTOMER]);
      expect(grants.rows).toHaveLength(0);

      const ids = await ownedIds(LIFETIME_USER);
      for (const spec of fiveRoutes(ids)) {
        const res = await call(ctx.app, spec, sessionHeaders(LIFETIME_USER, after));
        expect(res.status, spec.path).toBe(403);
        expect(res.body).toEqual(PRO_REQUIRED);
      }
    } finally {
      if (savedPrice === undefined) delete process.env.STRIPE_PRO_LIFETIME_PRICE_ID;
      else process.env.STRIPE_PRO_LIFETIME_PRICE_ID = savedPrice;
    }
  });

  it("still returns not-found when execute, sell, or delete target another user's trade-up", async () => {
    const executeId = await insertUserTradeUp(ctx.pool, { user_id: OTHER_USER, trade_up_id: nextTradeUpId(), status: "purchased" });
    const sellId = await insertUserTradeUp(ctx.pool, { user_id: OTHER_USER, trade_up_id: nextTradeUpId(), status: "executed" });
    const deleteId = await insertUserTradeUp(ctx.pool, { user_id: OTHER_USER, trade_up_id: nextTradeUpId(), status: "purchased" });
    const callers: Headers[] = [
      { "X-Test-User-Id": "user_pro", "X-Test-User-Tier": "pro" },
      lifetimeHeaders(),
    ];

    for (const headers of callers) {
      const executed = await call(
        ctx.app,
        { method: "post", path: `/api/my-trade-ups/${executeId}/execute`, body: { outcome_index: 0 } },
        headers,
      );
      expect(executed.status).toBe(404);
      expect(executed.body).toEqual(NOT_FOUND);

      const sold = await call(
        ctx.app,
        { method: "post", path: `/api/my-trade-ups/${sellId}/sell`, body: { price_cents: 15000, marketplace: "csfloat" } },
        headers,
      );
      expect(sold.status).toBe(404);
      expect(sold.body).toEqual(NOT_FOUND);

      const removed = await call(
        ctx.app,
        { method: "delete", path: `/api/my-trade-ups/${deleteId}` },
        headers,
      );
      expect(removed.status).toBe(404);
      expect(removed.body).toEqual(NOT_FOUND);
    }

    const { rows } = await ctx.pool.query(
      "SELECT id, user_id, status FROM user_trade_ups WHERE id = ANY($1::int[]) ORDER BY id",
      [[executeId, sellId, deleteId]],
    );
    expect(rows).toEqual([
      { id: executeId, user_id: OTHER_USER, status: "purchased" },
      { id: sellId, user_id: OTHER_USER, status: "executed" },
      { id: deleteId, user_id: OTHER_USER, status: "purchased" },
    ]);
  });
});
