import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { createTestApp, seedTestData, type TestContext } from "./setup.js";

/**
 * GET /api/trade-ups is read-only. Rows whose input listings vanished without
 * a status cascade stay hidden in the default view (canonical status / missing
 * inputs), and the request does not UPDATE trade_ups or flush tu:*.
 */

const redisCalls = vi.hoisted(() => ({ invalidate: [] as string[] }));

vi.mock("../../server/redis.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/redis.js")>();
  return {
    ...actual,
    cacheInvalidatePrefix: async (prefix: string) => {
      redisCalls.invalidate.push(prefix);
      return 0;
    },
  };
});

describe("stale-leak coherence guard", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    redisCalls.invalidate.length = 0;
    ctx = await createTestApp({ defaultTier: "pro", defaultUserId: "user_pro" });
    await seedTestData(ctx.pool, {
      profitableCount: 6,
      unprofitableCount: 0,
      staleCount: 0,
      type: "covert_knife",
    });
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  /** Raw-delete input listings of a column-'active' trade-up, bypassing
   *  cascadeTradeUpStatuses — simulates the race. `all` = delete every input
   *  listing (canonical stale), else one (partial). Picks the HIGHEST id so
   *  the row lands on page 1 (seed leaves trade_up_score NULL → order falls
   *  back to id DESC). */
  async function breakOneTradeUp(all = false): Promise<number> {
    const { rows: [tu] } = await ctx.pool.query(
      `SELECT id FROM trade_ups WHERE listing_status = 'active' AND type = 'covert_knife' ORDER BY id DESC LIMIT 1`
    );
    await ctx.pool.query(
      `DELETE FROM listings WHERE id IN (
         SELECT listing_id FROM trade_up_inputs WHERE trade_up_id = $1 ${all ? "" : "LIMIT 1"}
       )`,
      [tu.id]
    );
    return tu.id;
  }

  function spyTradeUpUpdates(): { count: () => number; restore: () => void } {
    const original = ctx.pool.query.bind(ctx.pool);
    let updates = 0;
    const spy = vi.spyOn(ctx.pool, "query").mockImplementation((...args: unknown[]) => {
      const sql = args[0];
      if (typeof sql === "string" && /update\s+trade_ups/i.test(sql)) updates += 1;
      return original(...(args as Parameters<typeof ctx.pool.query>));
    });
    return { count: () => updates, restore: () => spy.mockRestore() };
  }

  it("default view (stale OFF) never returns rows with non-active canonical status", async () => {
    const brokenId = await breakOneTradeUp();

    const res = await request(ctx.app)
      .get("/api/trade-ups?type=covert_knife")
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");

    expect(res.status).toBe(200);
    const returnedIds = res.body.trade_ups.map((tu: { id: number }) => tu.id);
    expect(returnedIds).not.toContain(brokenId);
    for (const tu of res.body.trade_ups) {
      expect(tu.listing_status).toBe("active");
      expect(tu.missing_count ?? 0).toBe(0);
    }
  });

  it("GET issues zero trade_ups writes and never flushes tu:*", async () => {
    const brokenId = await breakOneTradeUp();
    const writes = spyTradeUpUpdates();

    const res = await request(ctx.app)
      .get("/api/trade-ups?type=covert_knife&page_bust=1")
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");

    writes.restore();
    expect(res.status).toBe(200);
    expect(writes.count()).toBe(0);
    expect(redisCalls.invalidate).toEqual([]);

    const { rows: [row] } = await ctx.pool.query(
      `SELECT listing_status, preserved_at FROM trade_ups WHERE id = $1`,
      [brokenId]
    );
    expect(row.listing_status).toBe("active");
    expect(row.preserved_at).toBeNull();
  });

  it("include_stale still shows the leaked row with canonical status without writing", async () => {
    const brokenId = await breakOneTradeUp();
    const writes = spyTradeUpUpdates();

    const res = await request(ctx.app)
      .get("/api/trade-ups?type=covert_knife&include_stale=true")
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");

    writes.restore();
    expect(writes.count()).toBe(0);
    expect(res.status).toBe(200);
    const broken = res.body.trade_ups.find((tu: { id: number }) => tu.id === brokenId);
    expect(broken).toBeDefined();
    expect(broken.listing_status).toBe("partial");
    expect(broken.missing_count).toBeGreaterThan(0);
  });

  it("all-inputs-missing stays hidden by default and reads as stale under include_stale", async () => {
    const brokenId = await breakOneTradeUp(true);

    const hidden = await request(ctx.app)
      .get("/api/trade-ups?type=covert_knife")
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");
    expect(hidden.body.trade_ups.map((tu: { id: number }) => tu.id)).not.toContain(brokenId);

    const res = await request(ctx.app)
      .get("/api/trade-ups?type=covert_knife&include_stale=true")
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");
    const broken = res.body.trade_ups.find((tu: { id: number }) => tu.id === brokenId);
    expect(broken).toBeDefined();
    expect(broken.listing_status).toBe("stale");

    const { rows: [row] } = await ctx.pool.query(
      `SELECT listing_status FROM trade_ups WHERE id = $1`,
      [brokenId]
    );
    expect(row.listing_status).toBe("active");
  });

  it("does not requery to refill page slots (read-only filter drops the leak)", async () => {
    await seedTestData(ctx.pool, {
      profitableCount: 50,
      unprofitableCount: 0,
      staleCount: 0,
      type: "covert_knife",
    });
    await ctx.pool.query(`
      UPDATE trade_ups
      SET collection_names = ARRAY['Test Collection Alpha', 'Combo ' || id::text]
      WHERE type = 'covert_knife' AND listing_status = 'active'
    `);
    const brokenId = await breakOneTradeUp();
    const writes = spyTradeUpUpdates();

    const res = await request(ctx.app)
      .get("/api/trade-ups?type=covert_knife&per_page=50")
      .set("X-Test-User-Id", "user_pro")
      .set("X-Test-User-Tier", "pro");

    writes.restore();
    expect(writes.count()).toBe(0);
    expect(res.status).toBe(200);
    const ids = res.body.trade_ups.map((tu: { id: number }) => tu.id);
    expect(ids).not.toContain(brokenId);
    expect(ids.length).toBe(49);
    expect(redisCalls.invalidate).toEqual([]);
  });
});
