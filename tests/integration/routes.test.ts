import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import pg from "pg";
import { statusRouter } from "../../server/routes/status.js";
import { collectionsRouter } from "../../server/routes/collections.js";
import { createExpandedApp, createTestApp, seedTestData, type TestContext } from "./setup.js";

// ─── Seed extra data for status/global-stats routes ─────────────────────────

async function seedStatusData(pool: pg.Pool) {
  // Daemon status in sync_meta
  const daemonStatus = JSON.stringify({
    phase: "engine",
    detail: "Running cycle 5",
    timestamp: new Date().toISOString(),
  });
  await pool.query(
    `INSERT INTO sync_meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2`,
    ["daemon_status", daemonStatus],
  );

  // Collection scores
  await pool.query(`
    INSERT INTO collection_scores (collection_id, collection_name, profitable_count, avg_profit_cents, priority_score)
    VALUES ('col-test-1', 'Test Collection Alpha', 3, 2500, 75.0)
  `);

  // Daemon cycle stats
  await pool.query(`
    INSERT INTO daemon_cycle_stats (daemon_version, cycle, started_at, duration_ms, api_calls_used,
      api_limit_detected, api_available, knife_tradeups_total, knife_profitable,
      theories_generated, theories_profitable, gaps_filled,
      cooldown_passes, cooldown_new_found, cooldown_improved,
      top_profit_cents, avg_profit_cents, classified_total, classified_profitable,
      classified_theories, classified_theories_profitable)
    VALUES ('knife-v2', 1, NOW() - INTERVAL '2 hours', 120000, 50, 1000, 950, 20, 8,
      15, 5, 3, 2, 4, 2, 5000, 2500, 10, 4, 6, 2)
  `);
  await pool.query(`
    INSERT INTO daemon_cycle_stats (daemon_version, cycle, started_at, duration_ms, api_calls_used,
      api_limit_detected, api_available, knife_tradeups_total, knife_profitable,
      theories_generated, theories_profitable, gaps_filled,
      cooldown_passes, cooldown_new_found, cooldown_improved,
      top_profit_cents, avg_profit_cents, classified_total, classified_profitable,
      classified_theories, classified_theories_profitable)
    VALUES ('knife-v2', 2, NOW() - INTERVAL '1 hour', 95000, 45, 1000, 955, 22, 10,
      12, 4, 2, 3, 5, 3, 6000, 3000, 12, 5, 8, 3)
  `);

  // Daemon events
  await pool.query(`
    INSERT INTO daemon_events (event_type, summary, detail, created_at)
    VALUES ('cycle_complete', 'Cycle 1 done', 'Found 8 profitable', NOW() - INTERVAL '2 hours')
  `);
  await pool.query(`
    INSERT INTO daemon_events (event_type, summary, detail, created_at)
    VALUES ('new_tradeup', 'New profitable knife trade-up', 'ROI 25%', NOW() - INTERVAL '1 hour')
  `);

  // Sale history for global-stats
  await pool.query(`
    INSERT INTO sale_history (id, skin_name, condition, price_cents, float_value, sold_at)
    VALUES ('sale-1', 'AK-47 | Fire Serpent', 'Field-Tested', 15000, 0.20, NOW() - INTERVAL '1 day')
  `);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Status route integration tests", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createExpandedApp();
    await seedTestData(ctx.pool);
    await seedStatusData(ctx.pool);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  // ─── GET /api/status ────────────────────────────────────────────────────

  it("GET /api/status returns listing and trade-up counts", async () => {
    const res = await request(ctx.app).get("/api/status");

    expect(res.status).toBe(200);

    const body = res.body;

    // Structural checks: all SyncStatus fields present
    expect(body).toHaveProperty("classified_listings");
    expect(body).toHaveProperty("classified_skins");
    expect(body).toHaveProperty("classified_total");
    expect(body).toHaveProperty("covert_listings");
    expect(body).toHaveProperty("covert_skins");
    expect(body).toHaveProperty("covert_total");
    expect(body).toHaveProperty("trade_ups_count");
    expect(body).toHaveProperty("profitable_count");
    expect(body).toHaveProperty("knife_trade_ups");
    expect(body).toHaveProperty("knife_profitable");
    expect(body).toHaveProperty("total_skins");
    expect(body).toHaveProperty("total_listings");
    expect(body).toHaveProperty("collection_count");
    expect(body).toHaveProperty("daemon_status");
    expect(body).toHaveProperty("last_calculation");
    expect(body).toHaveProperty("top_collections");

    // Numeric types
    expect(typeof body.trade_ups_count).toBe("number");
    expect(typeof body.profitable_count).toBe("number");
    expect(typeof body.total_skins).toBe("number");
    expect(typeof body.total_listings).toBe("number");

    // seedTestData creates 5 profitable + 3 unprofitable + 2 stale = 10 trade-ups
    // Stale TUs also have positive profit, so profitable = 5 + 2 = 7
    expect(body.trade_ups_count).toBe(10);
    expect(body.profitable_count).toBe(7);

    // Listings exist (seeded trade-ups have listings)
    expect(body.total_listings).toBeGreaterThan(0);

    // Collections linked to skins
    expect(body.collection_count).toBeGreaterThanOrEqual(2);

    // Total skins (3 regular + 3 knife skins seeded, all non-stattrak)
    expect(body.total_skins).toBe(6);

    // last_calculation was seeded by seedTestData
    expect(body.last_calculation).toBeTruthy();
  });

  it("GET /api/status returns daemon status from sync_meta", async () => {
    const res = await request(ctx.app).get("/api/status");

    expect(res.status).toBe(200);
    expect(res.body.daemon_status).toBeDefined();
    expect(res.body.daemon_status.phase).toBe("engine");
    expect(res.body.daemon_status.detail).toBe("Running cycle 5");
    expect(res.body.daemon_status.timestamp).toBeDefined();
  });

  it("GET /api/status includes top_collections from collection_scores", async () => {
    const res = await request(ctx.app).get("/api/status");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.top_collections)).toBe(true);
    expect(res.body.top_collections.length).toBeGreaterThanOrEqual(1);

    const alpha = res.body.top_collections.find(
      (c: any) => c.collection_name === "Test Collection Alpha",
    );
    expect(alpha).toBeDefined();
    expect(parseFloat(alpha.priority_score)).toBe(75.0);
  });

  it("GET /api/status returns knife/glove skin counts", async () => {
    const res = await request(ctx.app).get("/api/status");

    expect(res.status).toBe(200);
    // 3 knife skins seeded (★ Bayonet, ★ Flip Knife, ★ Karambit), each with 1 listing
    expect(body(res).knife_glove_skins).toBe(3);
    expect(body(res).knife_glove_with_listings).toBe(3);
    expect(body(res).knife_glove_listings).toBe(3);
  });

  // ─── GET /api/global-stats ──────────────────────────────────────────────

  it("GET /api/global-stats returns aggregate stats from DB", async () => {
    const res = await request(ctx.app).get("/api/global-stats");

    expect(res.status).toBe(200);

    const stats = res.body;

    expect(stats).toHaveProperty("total_trade_ups");
    expect(stats).toHaveProperty("profitable_trade_ups");
    expect(stats).toHaveProperty("total_data_points");
    expect(stats).toHaveProperty("listings");
    expect(stats).toHaveProperty("sale_observations");
    expect(stats).toHaveProperty("sale_history");
    expect(stats).toHaveProperty("ref_prices");
    expect(stats).toHaveProperty("total_cycles");

    // Numeric types
    expect(typeof stats.total_trade_ups).toBe("number");
    expect(typeof stats.profitable_trade_ups).toBe("number");
    expect(typeof stats.listings).toBe("number");

    // 10 trade-ups seeded (all non-theoretical)
    // Stale TUs also have positive profit, so profitable = 5 + 2 = 7
    expect(stats.total_trade_ups).toBe(10);
    expect(stats.profitable_trade_ups).toBe(7);

    // Listings > 0
    expect(stats.listings).toBeGreaterThan(0);

    // 1 sale_history row seeded
    expect(stats.sale_history).toBe(1);

    // 2 daemon cycles seeded
    expect(stats.total_cycles).toBe(2);

    // total_data_points is sum of listings + sale_obs + sale_hist + refs
    expect(stats.total_data_points).toBe(
      stats.listings + stats.sale_observations + stats.sale_history + stats.ref_prices,
    );

    // X-Cache header present (MISS because no Redis in test)
    expect(res.headers["x-cache"]).toBe("MISS");
  });

  // ─── GET /api/daemon-cycles ─────────────────────────────────────────────

  it("GET /api/daemon-cycles returns paginated cycle stats", async () => {
    const res = await request(ctx.app).get("/api/daemon-cycles");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("cycles");
    expect(res.body).toHaveProperty("total");
    expect(Array.isArray(res.body.cycles)).toBe(true);

    // 2 cycles seeded
    expect(res.body.total).toBe(2);
    expect(res.body.cycles.length).toBe(2);

    // Most recent cycle first (ORDER BY id DESC)
    const first = res.body.cycles[0];
    expect(first.cycle).toBe(2);
    expect(first.knife_tradeups_total).toBe(22);
    expect(first.knife_profitable).toBe(10);
  });

  it("GET /api/daemon-cycles respects limit and offset", async () => {
    const res = await request(ctx.app).get("/api/daemon-cycles?limit=1&offset=0");

    expect(res.status).toBe(200);
    expect(res.body.cycles.length).toBe(1);
    expect(res.body.total).toBe(2);
    expect(res.body.cycles[0].cycle).toBe(2);

    // Offset to get second cycle
    const res2 = await request(ctx.app).get("/api/daemon-cycles?limit=1&offset=1");
    expect(res2.status).toBe(200);
    expect(res2.body.cycles.length).toBe(1);
    expect(res2.body.cycles[0].cycle).toBe(1);
  });

  // ─── GET /api/daemon-events ─────────────────────────────────────────────

  it("GET /api/daemon-events returns events in chronological order", async () => {
    const res = await request(ctx.app).get("/api/daemon-events");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("events");
    expect(Array.isArray(res.body.events)).toBe(true);
    expect(res.body.events.length).toBe(2);

    // Events are reversed to chronological order (oldest first)
    expect(res.body.events[0].event_type).toBe("cycle_complete");
    expect(res.body.events[1].event_type).toBe("new_tradeup");
  });

  it("GET /api/daemon-events supports since filter", async () => {
    // Use a cutoff 90 minutes ago -- between the two events (2hr ago and 1hr ago)
    const cutoff = new Date(Date.now() - 90 * 60 * 1000).toISOString();

    const res = await request(ctx.app).get(
      `/api/daemon-events?since=${encodeURIComponent(cutoff)}`,
    );
    expect(res.status).toBe(200);
    // Should only get the newer event (created ~1 hour ago)
    expect(res.body.events.length).toBe(1);
    expect(res.body.events[0].event_type).toBe("new_tradeup");
  });

  it("GET /api/daemon-events respects limit parameter", async () => {
    const res = await request(ctx.app).get("/api/daemon-events?limit=1");

    expect(res.status).toBe(200);
    // Limit 1 → gets latest one from DB, then reverses → single event
    expect(res.body.events.length).toBe(1);
  });
});

describe("Collections route integration tests", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createExpandedApp();
    await seedTestData(ctx.pool);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  // ─── GET /api/collections ───────────────────────────────────────────────

  it("GET /api/collections returns all collections with stats", async () => {
    const res = await request(ctx.app).get("/api/collections");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(2);

    // Find each collection
    const alpha = res.body.find((c: any) => c.name === "Test Collection Alpha");
    const beta = res.body.find((c: any) => c.name === "Test Collection Beta");

    expect(alpha).toBeDefined();
    expect(beta).toBeDefined();

    // Alpha has 2 skins (skin-classified-1 and skin-covert-1)
    expect(alpha.skin_count).toBe(2);
    // Beta has 1 skin (skin-classified-2)
    expect(beta.skin_count).toBe(1);

    // Structural checks on each collection object
    for (const col of res.body) {
      expect(col).toHaveProperty("name");
      expect(col).toHaveProperty("skin_count");
      expect(col).toHaveProperty("covert_count");
      expect(col).toHaveProperty("listing_count");
      expect(col).toHaveProperty("profitable_count");
      expect(col).toHaveProperty("best_profit_cents");
      expect(col).toHaveProperty("knife_type_count");
      expect(col).toHaveProperty("glove_type_count");
      expect(col).toHaveProperty("finish_count");
      expect(col).toHaveProperty("has_knives");
      expect(col).toHaveProperty("has_gloves");
      expect(typeof col.skin_count).toBe("number");
      expect(typeof col.listing_count).toBe("number");
    }
  });

  it("GET /api/collections shows correct listing counts", async () => {
    const res = await request(ctx.app).get("/api/collections");

    expect(res.status).toBe(200);

    const alpha = res.body.find((c: any) => c.name === "Test Collection Alpha");
    const beta = res.body.find((c: any) => c.name === "Test Collection Beta");

    // Alpha: profitable trade-ups use skin-classified-1 (5 TUs * 5 inputs = 25 listings)
    // Plus stale trade-ups have no actual listings in the listings table
    expect(alpha.listing_count).toBeGreaterThan(0);

    // Beta: unprofitable trade-ups use skin-classified-2 (3 TUs * 5 inputs = 15 listings)
    expect(beta.listing_count).toBeGreaterThan(0);
  });

  it("GET /api/collections shows profitable trade-up stats", async () => {
    const res = await request(ctx.app).get("/api/collections");

    expect(res.status).toBe(200);

    const alpha = res.body.find((c: any) => c.name === "Test Collection Alpha");
    const beta = res.body.find((c: any) => c.name === "Test Collection Beta");

    // Alpha has profitable trade-ups (inputs reference "Test Collection Alpha")
    expect(alpha.profitable_count).toBeGreaterThan(0);
    expect(alpha.best_profit_cents).toBeGreaterThan(0);

    // Beta has no profitable trade-ups (unprofitable ones have negative profit)
    expect(beta.profitable_count).toBe(0);
    expect(beta.best_profit_cents).toBe(0);
  });

  it("GET /api/collections sorts by listing_count descending", async () => {
    const res = await request(ctx.app).get("/api/collections");

    expect(res.status).toBe(200);

    const counts = res.body.map((c: any) => c.listing_count);
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
    }
  });

  it("GET /api/collections reports knife data from collectionKnifePool", async () => {
    const res = await request(ctx.app).get("/api/collections");

    expect(res.status).toBe(200);

    // createExpandedApp passes collectionKnifePool with "Test Collection Alpha" having Bayonet + Flip Knife
    const alpha = res.body.find((c: { name: string }) => c.name === "Test Collection Alpha");
    const beta = res.body.find((c: { name: string }) => c.name === "Test Collection Beta");

    expect(alpha.knife_type_count).toBe(2);
    expect(alpha.glove_type_count).toBe(0);
    expect(alpha.finish_count).toBe(3);
    expect(alpha.has_knives).toBe(true);
    expect(alpha.has_gloves).toBe(false);

    // Beta has no entry in the knife pool
    expect(beta.knife_type_count).toBe(0);
    expect(beta.glove_type_count).toBe(0);
    expect(beta.finish_count).toBe(0);
    expect(beta.has_knives).toBe(false);
    expect(beta.has_gloves).toBe(false);
  });

  // ─── GET /api/collection/:name ──────────────────────────────────────────

  it("GET /api/collection/:name returns collection detail with knife pool", async () => {
    const res = await request(ctx.app).get(
      `/api/collection/${encodeURIComponent("Test Collection Alpha")}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.collection).toBe("Test Collection Alpha");
    expect(res.body.knifePool).toBeDefined();
    expect(res.body.knifePool.knifeTypes).toEqual(["Bayonet", "Flip Knife"]);
    expect(res.body.knifePool.finishCount).toBe(3);
  });

  it("GET /api/collection/:name returns null knifePool for unknown collection", async () => {
    const res = await request(ctx.app).get(
      `/api/collection/${encodeURIComponent("Nonexistent Collection")}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.collection).toBe("Nonexistent Collection");
    expect(res.body.knifePool).toBeNull();
  });
});

describe("Collections route with knife pool data", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    // Create a custom app with a populated collectionKnifePool
    const baseCtx = await createTestApp();

    // Additional tables needed by status/collections routers
    await baseCtx.pool.query(`
      CREATE TABLE IF NOT EXISTS collection_scores (
        collection_id TEXT PRIMARY KEY, collection_name TEXT NOT NULL,
        profitable_count INTEGER NOT NULL DEFAULT 0,
        avg_profit_cents INTEGER NOT NULL DEFAULT 0,
        priority_score DOUBLE PRECISION NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS daemon_cycle_stats (
        id SERIAL PRIMARY KEY, daemon_version TEXT, cycle INTEGER,
        started_at TIMESTAMPTZ, duration_ms INTEGER, api_calls_used INTEGER,
        api_limit_detected INTEGER, api_available INTEGER,
        knife_tradeups_total INTEGER, knife_profitable INTEGER,
        theories_generated INTEGER, theories_profitable INTEGER, gaps_filled INTEGER,
        cooldown_passes INTEGER, cooldown_new_found INTEGER, cooldown_improved INTEGER,
        top_profit_cents INTEGER, avg_profit_cents INTEGER,
        classified_total INTEGER DEFAULT 0, classified_profitable INTEGER DEFAULT 0,
        classified_theories INTEGER DEFAULT 0, classified_theories_profitable INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS daemon_events (
        id SERIAL PRIMARY KEY, event_type TEXT NOT NULL,
        summary TEXT, detail TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    const knifePool = new Map<string, { knifeTypes: string[]; gloveTypes: string[]; knifeFinishes: string[]; gloveFinishes: string[]; finishCount: number }>();
    knifePool.set("Test Collection Alpha", {
      knifeTypes: ["Karambit", "Butterfly Knife"],
      knifeFinishes: ["Fade", "Doppler", "Tiger Tooth"],
      gloveTypes: [],
      gloveFinishes: [],
      finishCount: 12,
    });
    knifePool.set("Test Collection Beta", {
      knifeTypes: [],
      knifeFinishes: [],
      gloveTypes: ["Sport Gloves", "Specialist Gloves"],
      gloveFinishes: ["Hedge Maze", "Superconductor", "Crimson Kimono"],
      finishCount: 8,
    });

    baseCtx.app.use(statusRouter(baseCtx.pool));
    baseCtx.app.use(collectionsRouter(baseCtx.pool, knifePool));

    ctx = baseCtx;
    await seedTestData(ctx.pool);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("GET /api/collections includes knife/glove data from pool", async () => {
    const res = await request(ctx.app).get("/api/collections");

    expect(res.status).toBe(200);

    const alpha = res.body.find((c: any) => c.name === "Test Collection Alpha");
    const beta = res.body.find((c: any) => c.name === "Test Collection Beta");

    expect(alpha.knife_type_count).toBe(2);
    expect(alpha.glove_type_count).toBe(0);
    expect(alpha.finish_count).toBe(12);
    expect(alpha.has_knives).toBe(true);
    expect(alpha.has_gloves).toBe(false);

    expect(beta.knife_type_count).toBe(0);
    expect(beta.glove_type_count).toBe(2);
    expect(beta.finish_count).toBe(8);
    expect(beta.has_knives).toBe(false);
    expect(beta.has_gloves).toBe(true);
  });

  it("GET /api/collection/:name returns knife pool detail", async () => {
    const res = await request(ctx.app).get(
      `/api/collection/${encodeURIComponent("Test Collection Alpha")}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.knifePool).toBeDefined();
    expect(res.body.knifePool.knifeTypes).toEqual(["Karambit", "Butterfly Knife"]);
    expect(res.body.knifePool.gloveTypes).toEqual([]);
    expect(res.body.knifePool.finishCount).toBe(12);
  });
});

// Helper to reduce repetition
function body(res: request.Response) {
  return res.body;
}
