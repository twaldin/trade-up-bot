/**
 * Listing-disjoint default board on /api/trade-ups, with ?overlap=all escape hatch.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createTestApp, type TestContext } from "./setup.js";

async function insertTradeUp(
  pool: TestContext["pool"],
  opts: { collection: string; profitCents: number; listingIds: string[] },
): Promise<number> {
  const cost = 10_000;
  const { rows } = await pool.query(
    `INSERT INTO trade_ups (
       total_cost_cents, expected_value_cents, profit_cents, roi_percentage,
       chance_to_profit, type, best_case_cents, worst_case_cents, listing_status,
       outcomes_json, output_skin_names, collection_names, created_at
     ) VALUES ($1, $2, $3, $4, 1.0, 'classified_covert', $3, 0, 'active', '[]', '{}', $5, NOW() - INTERVAL '4 hours')
     RETURNING id, trade_up_score`,
    [cost, cost + opts.profitCents, opts.profitCents, (opts.profitCents / cost) * 100, [opts.collection]],
  );
  const id = Number(rows[0].id);
  for (const lid of opts.listingIds) {
    await pool.query(
      `INSERT INTO listings (id, skin_id, price_cents, float_value, source)
       VALUES ($1, 'skin-classified-1', 1000, 0.15, 'csfloat') ON CONFLICT (id) DO NOTHING`,
      [lid],
    );
    await pool.query(
      `INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name,
         price_cents, float_value, condition, source)
       VALUES ($1, $2, 'skin-classified-1', 'AK-47 | Test Skin', $3, 1000, 0.15, 'Field-Tested', 'csfloat')`,
      [id, lid, opts.collection],
    );
  }
  return id;
}

describe("listing-disjoint board", () => {
  let ctx: TestContext;
  let ids: { core: number; variantA: number; variantB: number; other: number };

  beforeEach(async () => {
    ctx = await createTestApp({ defaultTier: "pro", defaultUserId: "user_pro" });
    // Same collection combo, so the per-combo diversity cap does not separate them.
    const core = await insertTradeUp(ctx.pool, { collection: "Coll A", profitCents: 9_000, listingIds: ["c1", "c2", "c3"] });
    const variantA = await insertTradeUp(ctx.pool, { collection: "Coll A", profitCents: 8_000, listingIds: ["c1", "c2", "va"] });
    const variantB = await insertTradeUp(ctx.pool, { collection: "Coll A", profitCents: 7_000, listingIds: ["c3", "vb1", "vb2"] });
    const other = await insertTradeUp(ctx.pool, { collection: "Coll A", profitCents: 1_000, listingIds: ["o1", "o2", "o3"] });
    ids = { core, variantA, variantB, other };
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  const get = (q: string) =>
    request(ctx.app).get(`/api/trade-ups?per_page=12${q}`).set("X-Test-User-Id", "user_pro").set("X-Test-User-Tier", "pro");

  it("default board keeps only listing-disjoint rows, in score order", async () => {
    const res = await get("");
    expect(res.status).toBe(200);
    const got = (res.body.trade_ups as Array<{ id: number }>).map((t) => t.id);
    expect(got).toEqual([ids.core, ids.other]);
    expect(res.body.total).toBe(2);
    expect(res.body.trade_ups[0]).not.toHaveProperty("shared_with_rank");
  });

  it("overlap=all restores today's ranking and reports shared_with_rank", async () => {
    const res = await get("&overlap=all");
    expect(res.status).toBe(200);
    const rows = res.body.trade_ups as Array<{ id: number; shared_with_rank: number | null }>;
    expect(rows.map((t) => t.id)).toEqual([ids.core, ids.variantA, ids.variantB, ids.other]);
    expect(rows.map((t) => t.shared_with_rank)).toEqual([null, 1, 1, null]);
    expect(res.body.total).toBe(4);
  });

  it("does not change scores", async () => {
    const all = await get("&overlap=all");
    const disjoint = await get("");
    const score = (body: { trade_ups: Array<{ id: number; trade_up_score: number }> }, id: number) =>
      body.trade_ups.find((t) => t.id === id)?.trade_up_score;
    for (const id of [ids.core, ids.other]) expect(score(disjoint.body, id)).toBe(score(all.body, id));
  });

  it("caches disjoint and overlap=all snapshots separately", async () => {
    await get("");
    const all = await get("&overlap=all");
    expect(all.body.trade_ups).toHaveLength(4);
    const again = await get("");
    expect(again.body.trade_ups).toHaveLength(2);
  });

  it("explicit collection filter is unaffected (no snapshot, raw rows)", async () => {
    const res = await get(`&collection=${encodeURIComponent("Coll A")}`);
    expect(res.body.trade_ups).toHaveLength(4);
  });
});
