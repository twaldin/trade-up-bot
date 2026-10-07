/**
 * total_profitable on /api/trade-ups.
 *
 * The default board always runs with list diversity on. total_profitable used to be
 * set only on the non-diversity type_counts path, so every default request (and
 * every filtered one) returned 0 even with thousands of profitable rows.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { API_MAX_PER_COLLECTION_COMBO } from "../../server/routes/dn-diversity.js";
import { createTestApp, type TestContext } from "./setup.js";

async function insertTradeUp(
  pool: TestContext["pool"],
  opts: { collection: string; profitCents: number; ageHours: number; prefix: string },
): Promise<number> {
  const cost = 10_000;
  const { rows } = await pool.query(
    `INSERT INTO trade_ups (
       total_cost_cents, expected_value_cents, profit_cents, roi_percentage,
       chance_to_profit, type, best_case_cents, worst_case_cents, listing_status,
       outcomes_json, output_skin_names, collection_names, created_at
     ) VALUES ($1, $2, $3, $4, 0.5, 'classified_covert', $5, $6, 'active', '[]', '{}', $7,
               NOW() - make_interval(hours => $8))
     RETURNING id`,
    [cost, cost + opts.profitCents, opts.profitCents, (opts.profitCents / cost) * 100,
      Math.max(opts.profitCents, 0), Math.min(opts.profitCents, 0), [opts.collection], opts.ageHours],
  );
  const id = Number(rows[0].id);
  const lid = `${opts.prefix}-${id}`;
  await pool.query(
    `INSERT INTO listings (id, skin_id, price_cents, float_value, source) VALUES ($1, 'skin-classified-1', 1000, 0.15, 'csfloat')`,
    [lid],
  );
  await pool.query(
    `INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name,
       price_cents, float_value, condition, source)
     VALUES ($1, $2, 'skin-classified-1', 'AK-47 | Test Skin', $3, 1000, 0.15, 'Field-Tested', 'csfloat')`,
    [id, lid, opts.collection],
  );
  return id;
}

describe("total_profitable on /api/trade-ups", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestApp({ defaultTier: "pro", defaultUserId: "user_pro" });
    // Old enough for the free 3h delay: 3 profitable + 2 losing in A, 1 profitable in B.
    for (let i = 0; i < 3; i++) await insertTradeUp(ctx.pool, { collection: "Coll A", profitCents: 500 + i, ageHours: 5, prefix: `tp-a-${i}` });
    for (let i = 0; i < 2; i++) await insertTradeUp(ctx.pool, { collection: "Coll A", profitCents: -300 - i, ageHours: 5, prefix: `tp-al-${i}` });
    await insertTradeUp(ctx.pool, { collection: "Coll B", profitCents: 900, ageHours: 5, prefix: "tp-b" });
    // Fresh (inside the free delay): 2 profitable.
    for (let i = 0; i < 2; i++) await insertTradeUp(ctx.pool, { collection: "Coll C", profitCents: 700 + i, ageHours: 0, prefix: `tp-c-${i}` });
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("counts profitable rows on the default diversity-on board for pro", async () => {
    const res = await request(ctx.app)
      .get("/api/trade-ups?per_page=12")
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(8);
    expect(res.body.total_profitable).toBe(6);
  });

  it("counts profitable rows with a type filter (diversity still on)", async () => {
    const res = await request(ctx.app)
      .get("/api/trade-ups?type=classified_covert&per_page=12")
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");
    expect(res.body.total_profitable).toBe(6);
  });

  it("gives free users the real count inside their delay window", async () => {
    const res = await request(ctx.app)
      .get("/api/trade-ups?per_page=12")
      .set("X-Test-User-Id", "user_free")
      .set("X-Test-User-Tier", "free");
    expect(res.status).toBe(200);
    expect(res.body.tier_config.delay).toBeGreaterThan(0);
    expect(res.body.total).toBe(6);
    expect(res.body.total_profitable).toBe(4);
  });

  it("gives anonymous users the real count", async () => {
    const res = await request(ctx.app)
      .get("/api/trade-ups?per_page=12")
      .set("X-Test-User-Id", "anonymous");
    expect(res.status).toBe(200);
    expect(res.body.total_profitable).toBe(4);
  });

  it("counts profitable rows on a filtered (capped-count) query", async () => {
    const res = await request(ctx.app)
      .get("/api/trade-ups?per_page=12&min_cost=1")
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");
    expect(res.body.total).toBe(8);
    expect(res.body.total_profitable).toBe(6);
  });

  it("counts only within the diversity cap, matching total", async () => {
    for (let i = 0; i < API_MAX_PER_COLLECTION_COMBO + 5; i++) {
      await insertTradeUp(ctx.pool, { collection: "Coll D", profitCents: 2_000 + i, ageHours: 5, prefix: `tp-d-${i}` });
    }
    const res = await request(ctx.app)
      .get("/api/trade-ups?per_page=12")
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");
    expect(res.body.total).toBe(8 + API_MAX_PER_COLLECTION_COMBO);
    expect(res.body.total_profitable).toBe(6 + API_MAX_PER_COLLECTION_COMBO);
  });

  it("returns 0 only when nothing is profitable", async () => {
    await ctx.pool.query(`UPDATE trade_ups SET profit_cents = -1`);
    const res = await request(ctx.app)
      .get("/api/trade-ups?per_page=12&type=covert_knife")
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");
    expect(res.body.total_profitable).toBe(0);
  });

  async function bulkInsert(collection: string, n: number, profitCents: number) {
    await ctx.pool.query(
      `INSERT INTO trade_ups (
         total_cost_cents, expected_value_cents, profit_cents, roi_percentage,
         chance_to_profit, type, best_case_cents, worst_case_cents, listing_status,
         outcomes_json, output_skin_names, collection_names, created_at
       )
       SELECT 10000, 10000 + $2, $2, $2 / 100.0, 0.5, 'classified_covert', 0, 0, 'active',
              '[]', '{}', ARRAY[$1::text], NOW() - interval '5 hours'
       FROM generate_series(1, $3)`,
      [collection, profitCents, n],
    );
  }

  it("flags total_profitable as capped when the profitable count hits the cap", async () => {
    await bulkInsert("Coll Big", 10_050, 400);
    await bulkInsert("Coll Big", 40, -400);
    const res = await request(ctx.app)
      .get(`/api/trade-ups?per_page=5&collection=${encodeURIComponent("Coll Big")}&min_profit=1`)
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(10_001);
    expect(res.body.total_profitable).toBe(10_001);
    expect(res.body.total_profitable_capped).toBe(true);
  }, 60_000);

  it("counts profitable rows exactly when total is capped but profitable is not", async () => {
    // Losing rows first, so an unordered LIMIT 10001 slice would miss the winners.
    await bulkInsert("Coll Big", 10_050, -400);
    await bulkInsert("Coll Big", 7, 400);
    const res = await request(ctx.app)
      .get(`/api/trade-ups?per_page=5&collection=${encodeURIComponent("Coll Big")}`)
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(10_001);
    expect(res.body.total_profitable).toBe(7);
    expect(res.body.total_profitable_capped).toBe(false);
  }, 60_000);

  it("is not capped on the snapshot path with a small board", async () => {
    const res = await request(ctx.app)
      .get("/api/trade-ups?per_page=12")
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");
    expect(res.body.total_profitable).toBe(6);
    expect(res.body.total_profitable_capped).toBe(false);
  });
});
