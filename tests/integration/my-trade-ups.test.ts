import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestApp, seedTestData, type TestContext } from "./setup.js";

describe("My Trade-Ups", () => {
  let ctx: TestContext;
  let profitableId: number;

  beforeEach(async () => {
    ctx = await createTestApp({ defaultTier: "pro", defaultUserId: "user_pro" });
    const { lastTradeUpId } = await seedTestData(ctx.pool);
    profitableId = lastTradeUpId;
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("user_trade_ups table exists", async () => {
    const { rows } = await ctx.pool.query(
      "SELECT 1 FROM information_schema.tables WHERE table_name = 'user_trade_ups'"
    );
    expect(rows.length).toBe(1);
  });
});
