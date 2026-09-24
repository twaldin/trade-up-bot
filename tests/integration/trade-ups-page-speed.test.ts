/**
 * /api/trade-ups speed paths:
 *  - include=outcomes,inputs embeds what the board used to fetch with two
 *    extra requests per row (/api/trade-up/:id/outcomes + /inputs).
 *  - the diversified default board ranks once per (filters, sort) snapshot and
 *    slices pages from it; the order must match the per-page window SQL.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import request from "supertest";
import { tradeUpsRouter } from "../../server/routes/trade-ups.js";
import type { RankSnapshotStore } from "../../server/routes/trade-ups-page.js";
import { API_MAX_PER_COLLECTION_COMBO } from "../../server/routes/dn-diversity.js";
import { createTestApp, type TestContext } from "./setup.js";

const TYPE = "classified_covert";

function memoryStore(): RankSnapshotStore & { data: Map<string, unknown>; sets: number } {
  const data = new Map<string, unknown>();
  const store = {
    data,
    sets: 0,
    async get(key: string) { return data.get(key) ?? null; },
    async set(key: string, value: unknown) { store.sets++; data.set(key, value); },
    async del(key: string) { data.delete(key); },
  };
  return store;
}

function appWithStore(ctx: TestContext, rankStore: RankSnapshotStore): express.Express {
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.user = { steam_id: "user_pro", display_name: "Pro", avatar_url: "", tier: "pro", is_admin: false } as Express.User;
    next();
  });
  app.use(tradeUpsRouter(ctx.pool, { rankStore }));
  return app;
}

async function insertTradeUp(
  pool: TestContext["pool"],
  opts: { collections: string[]; score: number | null; inputs?: number; missingInputs?: number },
): Promise<number> {
  const outcomes = JSON.stringify([
    { skin_id: "s-out-1", skin_name: "AK-47 | Fire Serpent", collection_name: opts.collections[0], probability: 0.6, predicted_float: 0.1512, predicted_condition: "Minimal Wear", estimated_price_cents: 15000 },
    { skin_id: "s-out-2", skin_name: "M4A4 | Howl", collection_name: opts.collections[0], probability: 0.4, predicted_float: 0.1512, predicted_condition: "Minimal Wear", estimated_price_cents: 9000 },
  ]);
  const { rows } = await pool.query(
    `INSERT INTO trade_ups (
       total_cost_cents, expected_value_cents, profit_cents, roi_percentage, chance_to_profit,
       type, best_case_cents, worst_case_cents, listing_status, outcomes_json,
       output_skin_names, collection_names, created_at
     ) VALUES (10000, 12600, 2600, 26, 0.6, $1, 5000, -1000, 'active', $2, $3, $4, NOW() - INTERVAL '4 hours')
     RETURNING id`,
    [TYPE, outcomes, ["AK-47 | Fire Serpent", "M4A4 | Howl"], opts.collections],
  );
  const id = Number(rows[0].id);
  // The score trigger only fires on the money columns, so this sticks.
  await pool.query(`UPDATE trade_ups SET trade_up_score = $2 WHERE id = $1`, [id, opts.score]);
  const inputCount = opts.inputs ?? 3;
  for (let j = 0; j < inputCount; j++) {
    const listingId = `speed-${id}-${j}`;
    if (j >= (opts.missingInputs ?? 0)) {
      await pool.query(
        `INSERT INTO listings (id, skin_id, price_cents, float_value, source, marketplace_id) VALUES ($1, 'skin-classified-1', $2, $3, 'csfloat', $4)`,
        [listingId, 1000 + j, 0.15 + j / 100, `mkt-${id}-${j}`],
      );
    }
    await pool.query(
      `INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source)
       VALUES ($1, $2, 'skin-classified-1', $3, $4, $5, $6, 'Field-Tested', 'csfloat')`,
      [id, listingId, j % 2 === 0 ? "AK-47 | Test Skin" : "M4A4 | Test Skin", opts.collections[0], 1000 + j, 0.15 + j / 100],
    );
  }
  return id;
}

/** The pre-snapshot per-page query, written out independently of the route. */
async function directBoardIds(pool: TestContext["pool"]): Promise<number[]> {
  const { rows } = await pool.query(
    `SELECT t.id FROM (
       SELECT t.*, ROW_NUMBER() OVER (
         PARTITION BY t.collection_names ORDER BY t.trade_up_score DESC NULLS LAST, t.id DESC
       ) AS combo_rank
       FROM trade_ups t
       WHERE t.is_theoretical = false AND t.listing_status = 'active' AND t.type = $1
     ) t
     WHERE t.combo_rank <= $2
     ORDER BY t.trade_up_score DESC NULLS LAST, t.id DESC`,
    [TYPE, API_MAX_PER_COLLECTION_COMBO],
  );
  return rows.map((r: { id: number }) => Number(r.id));
}

describe("/api/trade-ups include=outcomes,inputs", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestApp({ defaultTier: "pro", defaultUserId: "user_pro" });
    for (let i = 0; i < 4; i++) {
      await insertTradeUp(ctx.pool, { collections: [`Embed Combo ${i}`], score: 1000 - i, missingInputs: i === 1 ? 1 : 0 });
    }
    await ctx.pool.query(`UPDATE listings SET claimed_by = 'user_other' WHERE id = (SELECT MIN(id) FROM listings WHERE id LIKE 'speed-%-2')`);
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("embeds exactly what the per-row outcomes and inputs endpoints return", async () => {
    const res = await request(ctx.app).get(`/api/trade-ups?type=${TYPE}&per_page=12&include=outcomes,inputs`);
    expect(res.status).toBe(200);
    const rows = res.body.trade_ups as Array<{ id: number; outcomes: unknown[]; inputs: Array<{ listing_id: string }> }>;
    expect(rows.length).toBeGreaterThan(0);

    const byListing = (a: { listing_id: string }, b: { listing_id: string }) => a.listing_id.localeCompare(b.listing_id);
    for (const tu of rows) {
      const [outcomes, inputs] = await Promise.all([
        request(ctx.app).get(`/api/trade-up/${tu.id}/outcomes`),
        request(ctx.app).get(`/api/trade-up/${tu.id}/inputs`),
      ]);
      expect(tu.outcomes).toEqual(outcomes.body.outcomes);
      expect([...tu.inputs].sort(byListing)).toEqual([...inputs.body.inputs].sort(byListing));
    }
  });

  it("carries the missing and claimed flags on embedded inputs", async () => {
    // A missing input is filtered off the default board; include_stale keeps
    // the row reachable so the flag itself can be checked.
    const res = await request(ctx.app).get(`/api/trade-ups?type=${TYPE}&per_page=12&include=inputs&include_stale=true`);
    const inputs = (res.body.trade_ups as Array<{ inputs: Array<{ missing?: boolean; claimed_by_other?: boolean }> }>)
      .flatMap((tu) => tu.inputs);
    expect(inputs.some((i) => i.missing === true)).toBe(true);
    expect(inputs.some((i) => i.claimed_by_other === true)).toBe(true);
  });

  it("keeps the lean list payload when include is absent", async () => {
    const res = await request(ctx.app).get(`/api/trade-ups?type=${TYPE}&per_page=12`);
    expect(res.status).toBe(200);
    for (const tu of res.body.trade_ups) {
      expect(tu.inputs).toEqual([]);
      expect(tu.outcomes).toEqual([]);
      expect(tu.input_summary.input_count).toBe(3);
    }
  });

  it("does not embed on oversized pages", async () => {
    const res = await request(ctx.app).get(`/api/trade-ups?type=${TYPE}&per_page=200&include=outcomes,inputs`);
    expect(res.status).toBe(200);
    for (const tu of res.body.trade_ups) {
      expect(tu.inputs).toEqual([]);
      expect(tu.outcomes).toEqual([]);
    }
  });
});

describe("/api/trade-ups rank snapshot pagination", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestApp({ defaultTier: "pro", defaultUserId: "user_pro" });
    // One oversized combo (cap applies), several small combos, score ties and NULL scores.
    for (let i = 0; i < 26; i++) {
      await insertTradeUp(ctx.pool, { collections: ["Big Combo"], score: 900 - i * 3 });
    }
    for (let i = 0; i < 18; i++) {
      await insertTradeUp(ctx.pool, { collections: [`Small ${i % 6}`, "Shared"], score: i % 4 === 0 ? null : 800 - (i % 5) * 10 });
    }
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("serves pages in the same order as the per-page window query, computing the ranking once", async () => {
    const store = memoryStore();
    const app = appWithStore(ctx, store);
    const expected = await directBoardIds(ctx.pool);
    expect(expected.length).toBe(API_MAX_PER_COLLECTION_COMBO + 18);

    const seen: number[] = [];
    const totals: number[] = [];
    for (let page = 1; page <= 4; page++) {
      const res = await request(app).get(`/api/trade-ups?type=${TYPE}&per_page=12&page=${page}`);
      expect(res.status).toBe(200);
      seen.push(...res.body.trade_ups.map((tu: { id: number }) => tu.id));
      totals.push(res.body.total);
    }
    expect(seen).toEqual(expected);
    expect(new Set(totals)).toEqual(new Set([expected.length]));
    expect(store.sets).toBe(1);
  });

  it("shares one ranking between page sizes (landing per_page=3 and board per_page=12)", async () => {
    const store = memoryStore();
    const app = appWithStore(ctx, store);
    const small = await request(app).get(`/api/trade-ups?type=${TYPE}&per_page=3&page=1`);
    const big = await request(app).get(`/api/trade-ups?type=${TYPE}&per_page=12&page=1`);
    expect(big.body.trade_ups.slice(0, 3).map((tu: { id: number }) => tu.id))
      .toEqual(small.body.trade_ups.map((tu: { id: number }) => tu.id));
    expect(store.sets).toBe(1);
  });

  it("falls back to a live query when a snapshot row went stale, so pages have no holes", async () => {
    const store = memoryStore();
    const app = appWithStore(ctx, store);
    await request(app).get(`/api/trade-ups?type=${TYPE}&per_page=12&page=1`);
    expect(store.data.size).toBe(1);

    const before = await directBoardIds(ctx.pool);
    const goneId = before[14];
    await ctx.pool.query(`UPDATE trade_ups SET listing_status = 'stale', preserved_at = NOW() WHERE id = $1`, [goneId]);

    const res = await request(app).get(`/api/trade-ups?type=${TYPE}&per_page=12&page=2`);
    expect(res.status).toBe(200);
    const ids = res.body.trade_ups.map((tu: { id: number }) => tu.id);
    expect(ids).not.toContain(goneId);
    expect(ids).toEqual((await directBoardIds(ctx.pool)).slice(12, 24));
    expect(store.data.size).toBe(0);
  });

  it("hides a leaked snapshot row without writing or flushing the ranking", async () => {
    const store = memoryStore();
    const app = appWithStore(ctx, store);
    await request(app).get(`/api/trade-ups?type=${TYPE}&per_page=12&page=1`);
    expect(store.data.size).toBe(1);

    const [topId] = await directBoardIds(ctx.pool);
    await ctx.pool.query(`DELETE FROM listings WHERE id = $1`, [`speed-${topId}-0`]);

    const res = await request(app).get(`/api/trade-ups?type=${TYPE}&per_page=12&page=1`);
    const ids = res.body.trade_ups.map((tu: { id: number }) => tu.id);
    expect(ids).not.toContain(topId);
    expect(ids).toHaveLength(11);
    expect(store.data.size).toBe(1);

    const { rows: [row] } = await ctx.pool.query(
      `SELECT listing_status FROM trade_ups WHERE id = $1`,
      [topId]
    );
    expect(row.listing_status).toBe("active");
  });
});
