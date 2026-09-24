import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createTestApp, type TestContext } from "./setup.js";
import { getRedis, initRedis, isRedisAvailable } from "../../server/redis.js";
import { tradeUpsCacheKey } from "../../server/routes/trade-ups-query.js";
import { publicBoardWarmPaths } from "../../server/routes/board-warm.js";

/**
 * The public warm is an anonymous GET. Redis stores the handler's full body.
 * Anon is shown the redacted view; Pro is shown the full view.
 */

async function insertTradeUp(ctx: TestContext, age: string): Promise<number> {
  const { rows } = await ctx.pool.query(
    `INSERT INTO trade_ups (
       total_cost_cents, expected_value_cents, profit_cents, roi_percentage,
       chance_to_profit, type, listing_status, outcomes_json, created_at
     ) VALUES (
       10000, 12000, 2000, 20, 0.5, 'classified_covert', 'active', '[]',
       NOW() - $1::interval
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

describe("warmed board page tier", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    process.env.REDIS_URL = "redis://127.0.0.1:6379/15";
    initRedis();
    for (let i = 0; i < 40 && !isRedisAvailable(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  });

  beforeEach(async () => {
    ctx = await createTestApp({ defaultTier: "pro", defaultUserId: "user_pro" });
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("stores the full body and serves anon redacted and Pro full", async () => {
    expect(isRedisAvailable()).toBe(true);
    const youngId = await insertTradeUp(ctx, "1 hour");
    const oldId = await insertTradeUp(ctx, "4 hours");
    const path = `${publicBoardWarmPaths()[0]}&type=classified_covert&warm_test=tier`;
    const key = tradeUpsCacheKey({
      per_page: "12",
      sort: "trade_up_score",
      order: "desc",
      page: "1",
      include: "outcomes,inputs",
      type: "classified_covert",
      warm_test: "tier",
    }, "anon", "free");
    await getRedis()?.del(key);

    const warmed = await request(ctx.app).get(path).set("X-Test-User-Id", "anonymous");
    expect(warmed.status).toBe(200);
    expect(warmed.headers["x-cache"]).toBe("MISS");
    expect(warmed.headers["cache-control"]).toBe("private, no-store");

    const stored = await getRedis()?.get(key);
    expect(stored).toBeTruthy();
    expect(stored).toContain(`listing-${oldId}`);
    expect(stored).not.toContain('"listing_id":"hidden"');

    const anon = await request(ctx.app).get(path).set("X-Test-User-Id", "anonymous");
    expect(anon.headers["x-cache"]).toBe("HIT");
    expect(JSON.stringify(anon.body)).not.toContain(`listing-${youngId}`);
    const anonYoung = anon.body.trade_ups.find((tu: { id: number }) => tu.id === youngId);
    if (anonYoung) {
      expect(anonYoung.inputs_redacted).toBe(true);
      expect(anonYoung.inputs[0].listing_id).toBe("hidden");
    }

    const pro = await request(ctx.app)
      .get(path)
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");
    const proYoung = pro.body.trade_ups.find((tu: { id: number }) => tu.id === youngId);
    expect(proYoung.inputs_redacted).toBeUndefined();
    expect(proYoung.inputs[0].listing_id).toBe(`listing-${youngId}`);
    expect(proYoung.inputs[0].price_cents).toBe(2000);

    await getRedis()?.del(key);
  });
});
