/**
 * Characterization tests for /api/skin-data and /api/collections listing counts.
 *
 * MUST stay green both before (DISTINCT semantics) and after (CTE rewrite) the
 * plan-015 data.ts + collections.ts changes. The multi-collection inflation case
 * is the key invariant: a skin in 2 collections with N listings must return
 * listing_count === N, never 2N.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import pg from "pg";
import { createExpandedApp, type TestContext } from "./setup.js";

// ─── Seed ────────────────────────────────────────────────────────────────────

const SKIN_MULTI_COLL = "Test Skin | Multi Collection";
const SKIN_SINGLE_COLL = "Test Skin | Single Collection";
const COL_A_ID = "col-char-a";
const COL_A_NAME = "Char Collection Alpha";
const COL_B_ID = "col-char-b";
const COL_B_NAME = "Char Collection Beta";
const SKIN_MULTI_ID = "skin-char-multi";
const SKIN_SINGLE_ID = "skin-char-single";

const MULTI_LISTING_COUNT = 4;  // listings for the multi-collection skin
const SINGLE_LISTING_COUNT = 2; // listings for the single-collection skin

async function seedCharacterizationData(pool: pg.Pool) {
  // Collections
  await pool.query(
    `INSERT INTO collections (id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [COL_A_ID, COL_A_NAME],
  );
  await pool.query(
    `INSERT INTO collections (id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [COL_B_ID, COL_B_NAME],
  );

  // Skins (both non-stattrak, Classified so they're visible under filter)
  await pool.query(
    `INSERT INTO skins (id, name, weapon, rarity, min_float, max_float, stattrak)
     VALUES ($1, $2, $3, $4, $5, $6, false) ON CONFLICT DO NOTHING`,
    [SKIN_MULTI_ID, SKIN_MULTI_COLL, "AK-47", "Classified", 0.06, 0.80],
  );
  await pool.query(
    `INSERT INTO skins (id, name, weapon, rarity, min_float, max_float, stattrak)
     VALUES ($1, $2, $3, $4, $5, $6, false) ON CONFLICT DO NOTHING`,
    [SKIN_SINGLE_ID, SKIN_SINGLE_COLL, "AK-47", "Classified", 0.06, 0.80],
  );

  // skin_collections: multi-collection skin belongs to BOTH A and B
  await pool.query(
    `INSERT INTO skin_collections (skin_id, collection_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [SKIN_MULTI_ID, COL_A_ID],
  );
  await pool.query(
    `INSERT INTO skin_collections (skin_id, collection_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [SKIN_MULTI_ID, COL_B_ID],
  );
  // single-collection skin belongs to A only
  await pool.query(
    `INSERT INTO skin_collections (skin_id, collection_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [SKIN_SINGLE_ID, COL_A_ID],
  );

  // Listings for multi-collection skin
  for (let i = 0; i < MULTI_LISTING_COUNT; i++) {
    await pool.query(
      `INSERT INTO listings (id, skin_id, price_cents, float_value, stattrak, source)
       VALUES ($1, $2, $3, $4, false, 'csfloat') ON CONFLICT DO NOTHING`,
      [`listing-char-multi-${i}`, SKIN_MULTI_ID, 5000 + i * 100, 0.10 + i * 0.05],
    );
  }

  // Listings for single-collection skin
  for (let i = 0; i < SINGLE_LISTING_COUNT; i++) {
    await pool.query(
      `INSERT INTO listings (id, skin_id, price_cents, float_value, stattrak, source)
       VALUES ($1, $2, $3, $4, false, 'csfloat') ON CONFLICT DO NOTHING`,
      [`listing-char-single-${i}`, SKIN_SINGLE_ID, 3000 + i * 100, 0.20 + i * 0.05],
    );
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("dataviewer-counts: characterization tests", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createExpandedApp();
    await seedCharacterizationData(ctx.pool);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("multi-collection skin: listing_count === N (not 2N) in /api/skin-data", async () => {
    const res = await request(ctx.app)
      .get(`/api/skin-data?rarity=Classified&collection=${encodeURIComponent(COL_A_NAME)}&stattrak=0`)
      .expect(200);

    const skins: Array<{ name: string; listing_count: number }> = res.body;
    const multi = skins.find((s) => s.name === SKIN_MULTI_COLL);
    expect(multi, "multi-collection skin should appear in collection A results").toBeDefined();
    // KEY INVARIANT: must be exactly N, not 2N (would be 8 if inflated)
    expect(multi!.listing_count).toBe(MULTI_LISTING_COUNT);
  });

  it("multi-collection skin: min/avg/max prices are correct (not inflated)", async () => {
    const res = await request(ctx.app)
      .get(`/api/skin-data?rarity=Classified&collection=${encodeURIComponent(COL_A_NAME)}&stattrak=0`)
      .expect(200);

    const skins: Array<{ name: string; listing_count: number; min_price: number; avg_price: number; max_price: number }> = res.body;
    const multi = skins.find((s) => s.name === SKIN_MULTI_COLL);
    expect(multi).toBeDefined();
    // Prices: 5000, 5100, 5200, 5300
    expect(multi!.min_price).toBe(5000);
    expect(multi!.max_price).toBe(5300);
    // avg = (5000+5100+5200+5300)/4 = 5150
    expect(Number(multi!.avg_price)).toBe(5150);
  });

  it("single-collection skin (control): listing_count correct", async () => {
    const res = await request(ctx.app)
      .get(`/api/skin-data?rarity=Classified&collection=${encodeURIComponent(COL_A_NAME)}&stattrak=0`)
      .expect(200);

    const skins: Array<{ name: string; listing_count: number }> = res.body;
    const single = skins.find((s) => s.name === SKIN_SINGLE_COLL);
    expect(single, "single-collection skin should appear in collection A").toBeDefined();
    expect(single!.listing_count).toBe(SINGLE_LISTING_COUNT);
  });

  it("/api/collections: listing_count for collection A sums skins without double-counting", async () => {
    const res = await request(ctx.app)
      .get("/api/collections")
      .expect(200);

    const collections: Array<{ name: string; listing_count: number }> = res.body;
    const colA = collections.find((c) => c.name === COL_A_NAME);
    expect(colA, "Char Collection Alpha should appear").toBeDefined();
    // Collection A has: multi-collection skin (4 listings) + single-collection skin (2 listings)
    // Expected total: 6. Would be 10 if multi-skin's listings were counted once per collection membership.
    expect(colA!.listing_count).toBe(MULTI_LISTING_COUNT + SINGLE_LISTING_COUNT);
  });

  it("/api/collections: listing_count for collection B counts multi-skin listings once", async () => {
    const res = await request(ctx.app)
      .get("/api/collections")
      .expect(200);

    const collections: Array<{ name: string; listing_count: number }> = res.body;
    const colB = collections.find((c) => c.name === COL_B_NAME);
    expect(colB, "Char Collection Beta should appear").toBeDefined();
    // Collection B has only the multi-collection skin (4 listings)
    expect(colB!.listing_count).toBe(MULTI_LISTING_COUNT);
  });
});
