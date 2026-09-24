import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ACTIVE_TRADE_UP_COUNT_SQL,
  tradeUpsHubDescription,
} from "../../server/routes/active-trade-up-counts.js";

const server = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../server/index.ts"), "utf8");

describe("trade-ups meta counts", () => {
  it("the description number is the active-only count", () => {
    const counts = { total: 629512, profitable: 24718 };
    expect(tradeUpsHubDescription(counts)).toBe(
      "24,718 CS2 trade-ups with positive expected profit after fees, of 629,512 live contracts.",
    );
    expect(ACTIVE_TRADE_UP_COUNT_SQL).toContain("listing_status = 'active'");
    expect(ACTIVE_TRADE_UP_COUNT_SQL).toContain("is_theoretical = false");
    expect(server).toContain("tradeUpsHubDescription(counts)");
    expect(server).toContain("loadActiveTradeUpCounts(pool)");
    expect(server).not.toContain("publishedTradeUpCounts(await getGlobalStats");
  });
});
