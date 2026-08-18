/**
 * D&N dedup/diversity on the /api/trade-ups list (API surface).
 *
 * Discovery still persists every D&N clone; this lever only changes what the
 * default board returns so other collections can surface. Explicit collection
 * filters and my_claims stay uncapped.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { API_MAX_PER_COLLECTION_COMBO } from "../../server/routes/dn-diversity.js";
import { createTestApp, type TestContext } from "./setup.js";

const DN = "The Dreams & Nightmares Collection";
const FRACTURE = "The Fracture Collection";

async function insertActiveTradeUp(
  pool: TestContext["pool"],
  opts: {
    collections: string[];
    profitCents: number;
    type?: string;
    listingPrefix: string;
  },
): Promise<number> {
  const type = opts.type ?? "classified_covert";
  const cost = 10_000;
  const ev = cost + opts.profitCents;
  const roi = (opts.profitCents / cost) * 100;
  const outcomes = JSON.stringify([
    {
      skin_id: "skin-covert-1",
      skin_name: "AK-47 | Fire Serpent",
      collection_name: opts.collections[0],
      probability: 1.0,
      predicted_float: 0.15,
      predicted_condition: "Field-Tested",
      estimated_price_cents: ev,
    },
  ]);

  const { rows } = await pool.query(
    `INSERT INTO trade_ups (
       total_cost_cents, expected_value_cents, profit_cents, roi_percentage,
       chance_to_profit, type, best_case_cents, worst_case_cents, listing_status,
       outcomes_json, output_skin_names, collection_names, created_at
     ) VALUES ($1, $2, $3, $4, 1.0, $5, $6, 0, 'active', $7, $8, $9, NOW() - INTERVAL '4 hours')
     RETURNING id`,
    [cost, ev, opts.profitCents, roi, type, opts.profitCents, outcomes, ["AK-47 | Fire Serpent"], opts.collections],
  );
  const id = Number(rows[0].id);

  for (let j = 0; j < 10; j++) {
    const listingId = `${opts.listingPrefix}-${id}-${j}`;
    await pool.query(
      `INSERT INTO listings (id, skin_id, price_cents, float_value, source) VALUES ($1, $2, $3, $4, $5)`,
      [listingId, "skin-classified-1", 1000, 0.15, "csfloat"],
    );
    await pool.query(
      `INSERT INTO trade_up_inputs (
         trade_up_id, listing_id, skin_id, skin_name, collection_name,
         price_cents, float_value, condition, source
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, listingId, "skin-classified-1", "AK-47 | Test Skin", opts.collections[0], 1000, 0.15, "Field-Tested", "csfloat"],
    );
  }
  return id;
}

describe("D&N diversity on /api/trade-ups", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestApp({ defaultTier: "pro", defaultUserId: "user_pro" });
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  async function seedDnHeavyBoard(): Promise<{ dnIds: number[]; fractureIds: number[] }> {
    const dnIds: number[] = [];
    for (let i = 0; i < 25; i++) {
      dnIds.push(
        await insertActiveTradeUp(ctx.pool, {
          collections: [DN],
          profitCents: 50_000 - i * 100,
          listingPrefix: `dn-${i}`,
        }),
      );
    }
    const fractureIds: number[] = [];
    for (let i = 0; i < 5; i++) {
      fractureIds.push(
        await insertActiveTradeUp(ctx.pool, {
          collections: [FRACTURE],
          profitCents: 1_000 - i * 10,
          listingPrefix: `frac-${i}`,
        }),
      );
    }
    return { dnIds, fractureIds };
  }

  it("caps D&N clones on the default board and surfaces other collections", async () => {
    const { fractureIds } = await seedDnHeavyBoard();

    const res = await request(ctx.app)
      .get("/api/trade-ups?type=classified_covert&per_page=50")
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");

    expect(res.status).toBe(200);
    const rows = res.body.trade_ups as Array<{
      id: number;
      input_summary: { collections: string[] };
      trade_up_score: number;
    }>;

    const dnRows = rows.filter((tu) => tu.input_summary.collections.includes(DN));
    const fractureRows = rows.filter((tu) => tu.input_summary.collections.includes(FRACTURE));

    expect(dnRows.length).toBe(API_MAX_PER_COLLECTION_COMBO);
    expect(fractureRows.length).toBe(5);
    expect(fractureRows.map((tu) => tu.id).sort()).toEqual([...fractureIds].sort());
    expect(res.body.total).toBe(API_MAX_PER_COLLECTION_COMBO + 5);
  });

  it("keeps the highest-score D&N clones when the signature overflows", async () => {
    await seedDnHeavyBoard();

    const res = await request(ctx.app)
      .get("/api/trade-ups?type=classified_covert&per_page=50")
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");

    const dnScores = (res.body.trade_ups as Array<{
      input_summary: { collections: string[] };
      trade_up_score: number;
    }>)
      .filter((tu) => tu.input_summary.collections.includes(DN))
      .map((tu) => tu.trade_up_score);

    expect(dnScores).toHaveLength(API_MAX_PER_COLLECTION_COMBO);
    for (let i = 1; i < dnScores.length; i++) {
      expect(dnScores[i]).toBeLessThanOrEqual(dnScores[i - 1]);
    }
    expect(dnScores[0]).toBeGreaterThan(dnScores[dnScores.length - 1]);
  });

  it("does not cap when the user explicitly filters to D&N", async () => {
    await seedDnHeavyBoard();

    const res = await request(ctx.app)
      .get(`/api/trade-ups?type=classified_covert&collection=${encodeURIComponent(DN)}&per_page=50`)
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");

    expect(res.status).toBe(200);
    expect(res.body.trade_ups).toHaveLength(25);
    expect(res.body.total).toBe(25);
  });

  it("caps a non-D&N collection-combo the same way (API analog is not D&N-only)", async () => {
    for (let i = 0; i < 25; i++) {
      await insertActiveTradeUp(ctx.pool, {
        collections: [FRACTURE],
        profitCents: 3_000 - i * 10,
        listingPrefix: `frac-cap-${i}`,
      });
    }

    const res = await request(ctx.app)
      .get("/api/trade-ups?type=classified_covert&per_page=50")
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");

    expect(res.status).toBe(200);
    expect(res.body.trade_ups).toHaveLength(API_MAX_PER_COLLECTION_COMBO);
    expect(res.body.total).toBe(API_MAX_PER_COLLECTION_COMBO);
  });

  it("Check 131 shape: 50 D&N clones cannot fill a 50-row first page when others exist", async () => {
    for (let i = 0; i < 50; i++) {
      await insertActiveTradeUp(ctx.pool, {
        collections: [DN],
        profitCents: 80_000 - i * 100,
        listingPrefix: `dn131-${i}`,
      });
    }
    for (let i = 0; i < 10; i++) {
      await insertActiveTradeUp(ctx.pool, {
        collections: [FRACTURE],
        profitCents: 800 - i * 10,
        listingPrefix: `frac131-${i}`,
      });
    }

    const res = await request(ctx.app)
      .get("/api/trade-ups?type=classified_covert&per_page=50")
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");

    expect(res.status).toBe(200);
    const rows = res.body.trade_ups as Array<{ input_summary: { collections: string[] } }>;
    const dnCount = rows.filter((tu) => tu.input_summary.collections.includes(DN)).length;
    const otherCount = rows.length - dnCount;
    expect(dnCount).toBe(API_MAX_PER_COLLECTION_COMBO);
    expect(dnCount).toBeLessThan(50);
    expect(otherCount).toBe(10);
  });

  it("leaves a board with no D&N rows unchanged", async () => {
    const ids: number[] = [];
    for (let i = 0; i < 8; i++) {
      ids.push(
        await insertActiveTradeUp(ctx.pool, {
          collections: [FRACTURE],
          profitCents: 2_000 - i * 50,
          listingPrefix: `only-frac-${i}`,
        }),
      );
    }

    const res = await request(ctx.app)
      .get("/api/trade-ups?type=classified_covert&per_page=50")
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");

    expect(res.status).toBe(200);
    expect(res.body.trade_ups).toHaveLength(8);
    expect(res.body.trade_ups.map((tu: { id: number }) => tu.id).sort()).toEqual([...ids].sort());
  });
});
