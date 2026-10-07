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
  it.todo("has_more at the 1000-row cap is covered by unit tests (seeding 1000+ rows is too slow here)");

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
    expect(res.body.deduped).toBe(true);
    expect(res.body.raw_total).toBe(4);
    expect(res.body.has_more).toBe(false);
  });

  it("total_profitable counts the deduped list, not raw rows", async () => {
    // Raw: 4 profitable rows. Deduped: core + other -> 2.
    const res = await get("");
    expect(res.body.total_profitable).toBe(2);
    const raw = await get("&overlap=all");
    expect(raw.body.total_profitable).toBe(4);
  });

  it("total_profitable_capped is false on the deduped board and on small raw lists", async () => {
    expect((await get("")).body.total_profitable_capped).toBe(false);
    const all = await get("&overlap=all&min_cost=1");
    expect(all.body.total_profitable).toBe(4);
    expect(all.body.total_profitable_capped).toBe(false);
    const coll = await get(`&collection=${encodeURIComponent("Coll A")}`);
    expect(coll.body.total_profitable).toBe(4);
    expect(coll.body.total_profitable_capped).toBe(false);
  });

  it("collection filter uses the separate capped profitable count and flags the cap", async () => {
    await ctx.pool.query(
      `INSERT INTO trade_ups (
         total_cost_cents, expected_value_cents, profit_cents, roi_percentage,
         chance_to_profit, type, best_case_cents, worst_case_cents, listing_status,
         outcomes_json, output_skin_names, collection_names, created_at
       )
       SELECT 10000, 10400, 400, 4, 0.5, 'classified_covert', 0, 0, 'active',
              '[]', '{}', ARRAY['Coll Big'], NOW() - interval '5 hours'
       FROM generate_series(1, 10050)`,
    );
    const res = await get(`&collection=${encodeURIComponent("Coll Big")}&min_profit=1`);
    expect(res.body.deduped).toBe(false);
    expect(res.body.total_profitable).toBe(10_001);
    expect(res.body.total_profitable_capped).toBe(true);
    // The deduped default board still counts its own list and is never capped.
    const board = await get("");
    expect(board.body.deduped).toBe(true);
    expect(board.body.total_profitable_capped).toBe(false);
  }, 60_000);

  it("an id going inactive mid-scroll keeps paging on the deduped list (no raw fallback)", async () => {
    const first = await request(ctx.app)
      .get("/api/trade-ups?per_page=1&page=1")
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");
    expect(first.body.trade_ups.map((t: { id: number }) => t.id)).toEqual([ids.core]);
    await ctx.pool.query(`UPDATE trade_ups SET listing_status = 'stale' WHERE id = $1`, [ids.core]);
    const second = await request(ctx.app)
      .get("/api/trade-ups?per_page=1&page=2")
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");
    expect(second.status).toBe(200);
    expect(second.body.deduped).toBe(true);
    // Rebuilt deduped list without core: variantA, variantB (c3 freed), other.
    expect(second.body.total).toBe(3);
    expect(second.body.total).toBeLessThan(second.body.raw_total + 1);
    const got = second.body.trade_ups as Array<{ id: number }>;
    expect(got.map((t) => t.id)).not.toContain(ids.core);
    expect(got).toHaveLength(1);
  });

  it("pages past the deduped list are empty, not raw rows", async () => {
    const res = await get("&page=5");
    expect(res.status).toBe(200);
    expect(res.body.trade_ups).toHaveLength(0);
    expect(res.body.total).toBe(2);
    expect(res.body.deduped).toBe(true);
  });

  it("overlap=all restores today's ranking and reports shared_with_rank", async () => {
    const res = await get("&overlap=all");
    expect(res.status).toBe(200);
    const rows = res.body.trade_ups as Array<{ id: number; shared_with_rank: number | null }>;
    expect(rows.map((t) => t.id)).toEqual([ids.core, ids.variantA, ids.variantB, ids.other]);
    expect(rows.map((t) => t.shared_with_rank)).toEqual([null, 1, 1, null]);
    expect(res.body.total).toBe(4);
    expect(res.body.deduped).toBe(false);
    expect(res.body).not.toHaveProperty("raw_total");
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
    expect(res.body.deduped).toBe(false);
    expect(res.body).not.toHaveProperty("has_more");
  });
});
