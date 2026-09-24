import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createTestApp, type TestContext } from "./setup.js";

/**
 * Free/anon viewers must not read listing ids, marketplace links, or exact
 * floats for a trade-up younger than the free delay. Older rows, Pro, and
 * the claimer are unchanged.
 */

async function insertTradeUp(ctx: TestContext, age: string): Promise<number> {
  const { rows } = await ctx.pool.query(
    `INSERT INTO trade_ups (
       total_cost_cents, expected_value_cents, profit_cents, roi_percentage,
       chance_to_profit, type, listing_status, outcomes_json, created_at, previous_inputs
     ) VALUES (
       10000, 12000, 2000, 20, 0.5, 'classified_covert', 'active', '[]',
       NOW() - $1::interval, '{"replaced":[{"old":{"listing_id":"leak","float_value":0.123456}}]}'
     ) RETURNING id`,
    [age],
  );
  const id = rows[0].id as number;
  await ctx.pool.query(
    `INSERT INTO listings (id, skin_id, price_cents, float_value, source, marketplace_id)
     VALUES ($1, 'skin-classified-1', 2000, 0.151234, 'csfloat', 'mkt-secret')`,
    [`listing-${id}`],
  );
  await ctx.pool.query(
    `INSERT INTO trade_up_inputs (
       trade_up_id, listing_id, skin_id, skin_name, collection_name,
       price_cents, float_value, condition, source
     ) VALUES ($1, $2, 'skin-classified-1', 'AK-47 | Test Skin', 'Test Collection Alpha',
       2000, 0.151234, 'Field-Tested', 'csfloat')`,
    [id, `listing-${id}`],
  );
  return id;
}

function expectRedacted(body: { inputs: Array<Record<string, unknown>>; inputs_redacted?: boolean; previous_inputs?: unknown }) {
  expect(body.inputs_redacted).toBe(true);
  expect(body.inputs.length).toBeGreaterThan(0);
  for (const input of body.inputs) {
    expect(input.listing_id).toBe("hidden");
    expect(input.marketplace_id).toBeNull();
    expect(input.float_value).toBeNull();
    expect(input.skin_name).toBe("AK-47 | Test Skin");
    expect(input.price_cents).toBe(2000);
  }
  expect(JSON.stringify(body)).not.toContain("listing-");
  expect(JSON.stringify(body)).not.toContain("mkt-secret");
  expect(JSON.stringify(body)).not.toContain("0.151234");
}

function expectFull(body: { inputs: Array<Record<string, unknown>>; inputs_redacted?: boolean }) {
  expect(body.inputs_redacted).toBeUndefined();
  expect(body.inputs[0].listing_id).toMatch(/^listing-/);
  expect(body.inputs[0].marketplace_id).toBe("mkt-secret");
  expect(body.inputs[0].float_value).toBeCloseTo(0.151234);
}

describe("trade-up detail tier delay", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestApp({ defaultTier: "pro", defaultUserId: "user_pro" });
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("redacts fresh rows for free and anonymous viewers on both endpoints", async () => {
    const id = await insertTradeUp(ctx, "1 hour");

    for (const headers of [
      { "X-Test-User-Id": "user_free", "X-Test-User-Tier": "free" },
      { "X-Test-User-Id": "anonymous" },
    ]) {
      const detail = await request(ctx.app).get(`/api/trade-ups/${id}`).set(headers);
      expect(detail.status).toBe(200);
      expectRedacted(detail.body);
      expect(detail.body.previous_inputs).toBeNull();

      const inputs = await request(ctx.app).get(`/api/trade-up/${id}/inputs`).set(headers);
      expect(inputs.status).toBe(200);
      expectRedacted(inputs.body);
    }
  });

  it("returns the full row once it is older than the free delay", async () => {
    const id = await insertTradeUp(ctx, "4 hours");

    for (const headers of [
      { "X-Test-User-Id": "user_free", "X-Test-User-Tier": "free" },
      { "X-Test-User-Id": "anonymous" },
    ]) {
      const detail = await request(ctx.app).get(`/api/trade-ups/${id}`).set(headers);
      expect(detail.status).toBe(200);
      expectFull(detail.body);

      const inputs = await request(ctx.app).get(`/api/trade-up/${id}/inputs`).set(headers);
      expect(inputs.status).toBe(200);
      expectFull(inputs.body);
    }
  });

  it("returns the full row to Pro even when the row is inside the delay", async () => {
    const id = await insertTradeUp(ctx, "1 hour");
    const headers = { "X-Test-User-Id": "user_pro", "X-Test-User-Tier": "pro" };

    const detail = await request(ctx.app).get(`/api/trade-ups/${id}`).set(headers);
    expect(detail.status).toBe(200);
    expectFull(detail.body);

    const inputs = await request(ctx.app).get(`/api/trade-up/${id}/inputs`).set(headers);
    expect(inputs.status).toBe(200);
    expectFull(inputs.body);
  });

  it("redacts include=inputs for anon and free and leaves Pro full", async () => {
    const youngId = await insertTradeUp(ctx, "1 hour");
    const oldId = await insertTradeUp(ctx, "4 hours");
    await ctx.pool.query(
      `UPDATE listings SET marketplace_id = 'mkt-young', float_value = 0.151234 WHERE id = $1`,
      [`listing-${youngId}`],
    );
    await ctx.pool.query(
      `UPDATE trade_up_inputs SET float_value = 0.151234 WHERE trade_up_id = $1`,
      [youngId],
    );
    await ctx.pool.query(
      `UPDATE listings SET marketplace_id = 'mkt-old', float_value = 0.271111 WHERE id = $1`,
      [`listing-${oldId}`],
    );
    await ctx.pool.query(
      `UPDATE trade_up_inputs SET float_value = 0.271111 WHERE trade_up_id = $1`,
      [oldId],
    );

    const pro = await request(ctx.app)
      .get("/api/trade-ups?include=inputs&per_page=50&type=classified_covert")
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");
    expect(pro.status).toBe(200);
    const proYoung = pro.body.trade_ups.find((tu: { id: number }) => tu.id === youngId);
    const proOld = pro.body.trade_ups.find((tu: { id: number }) => tu.id === oldId);
    expect(proYoung.inputs[0].listing_id).toBe(`listing-${youngId}`);
    expect(proYoung.inputs[0].marketplace_id).toBe("mkt-young");
    expect(proYoung.inputs[0].float_value).toBeCloseTo(0.151234);
    expect(proOld.inputs[0].marketplace_id).toBe("mkt-old");

    for (const headers of [
      { "X-Test-User-Id": "user_free", "X-Test-User-Tier": "free" },
      { "X-Test-User-Id": "anonymous" },
    ]) {
      const res = await request(ctx.app)
        .get("/api/trade-ups?include=inputs&per_page=50&type=classified_covert")
        .set(headers);
      expect(res.status).toBe(200);
      const body = JSON.stringify(res.body);
      expect(body).not.toContain("mkt-young");
      expect(body).not.toContain(`listing-${youngId}`);
      expect(body).not.toContain("0.151234");
      const old = res.body.trade_ups.find((tu: { id: number }) => tu.id === oldId);
      expect(old).toBeDefined();
      expect(old.inputs[0].listing_id).toBe(`listing-${oldId}`);
      expect(old.inputs[0].marketplace_id).toBe("mkt-old");
      expect(old.inputs[0].float_value).toBeCloseTo(0.271111);
      expect(old.inputs_redacted).toBeUndefined();
      const young = res.body.trade_ups.find((tu: { id: number }) => tu.id === youngId);
      if (young) {
        expect(young.inputs_redacted).toBe(true);
        expect(young.previous_inputs).toBeNull();
        expect(young.inputs[0].listing_id).toBe("hidden");
        expect(young.inputs[0].marketplace_id).toBeNull();
        expect(young.inputs[0].float_value).toBeNull();
      }
    }
  });

  it("returns the full row to the claimer even on the free tier inside the delay", async () => {
    const id = await insertTradeUp(ctx, "1 hour");
    await ctx.pool.query(
      `INSERT INTO trade_up_claims (trade_up_id, user_id, expires_at)
       VALUES ($1, 'user_claimer', NOW() + INTERVAL '30 minutes')`,
      [id],
    );
    const headers = { "X-Test-User-Id": "user_claimer", "X-Test-User-Tier": "free" };

    const detail = await request(ctx.app).get(`/api/trade-ups/${id}`).set(headers);
    expect(detail.status).toBe(200);
    expectFull(detail.body);

    const inputs = await request(ctx.app).get(`/api/trade-up/${id}/inputs`).set(headers);
    expect(inputs.status).toBe(200);
    expectFull(inputs.body);
  });
});
