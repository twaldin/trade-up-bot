import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Request } from "express";
import {
  BOARD_DELAY_SECONDS,
  boardDelaySentence,
  parseBoardDelayPayload,
  parseBoardDelayRow,
} from "../../shared/board-delay.js";
import { ACTIVE_CLAIM_PREDICATE } from "../../server/routes/active-claim.js";
import { BOARD_DELAY_SQL } from "../../server/routes/board-delay.js";
import { getTierConfig } from "../../server/auth.js";
import type { TierUser } from "../../shared/pro-access.js";

function tierReq(user: TierUser): Request {
  return { user } as Request;
}

describe("board delay gap", () => {
  it("uses the same 3-hour cut as the free list", () => {
    expect(BOARD_DELAY_SECONDS).toBe(3 * 60 * 60);
    expect(getTierConfig(tierReq(null)).delay).toBe(BOARD_DELAY_SECONDS);
    expect(getTierConfig(tierReq({ tier: "free" })).delay).toBe(BOARD_DELAY_SECONDS);
    expect(getTierConfig(tierReq({ tier: "pro" })).delay).toBe(0);
    expect(getTierConfig(tierReq({ tier: "basic" })).delay).toBe(0);
    expect(getTierConfig(tierReq({ tier: "free", lifetime: true })).delay).toBe(0);
    expect(BOARD_DELAY_SQL).toContain("profit_cents > 0");
    expect(BOARD_DELAY_SQL).toContain("listing_status = 'active'");
    expect(BOARD_DELAY_SQL).toContain("is_theoretical = false");
    expect(BOARD_DELAY_SQL).toContain("created_at > NOW()");
    expect(BOARD_DELAY_SQL).not.toMatch(/listing_id|skin_name/);
  });

  it("uses the board's active-claim predicate on both the count and the best profit", () => {
    const claims = readFileSync(new URL("../../server/routes/claims.ts", import.meta.url), "utf8");
    expect(claims).toContain("ACTIVE_CLAIM_PREDICATE");
    expect(ACTIVE_CLAIM_PREDICATE).toBe("released_at IS NULL AND expires_at > NOW()");

    const filters = [...BOARD_DELAY_SQL.matchAll(/FILTER \(WHERE([\s\S]*?)\)::int/g)].map((match) => match[1] ?? "");
    expect(filters).toHaveLength(2);
    for (const filter of filters) {
      expect(filter).toContain("profit_cents > 0");
      expect(filter).toContain("trade_up_claims");
      expect(filter).toContain(ACTIVE_CLAIM_PREDICATE);
    }
    const outsideFilters = BOARD_DELAY_SQL.split("FROM trade_ups")[1] ?? "";
    expect(outsideFilters).not.toContain("trade_up_claims");
  });

  it("parses integer cents and drops a fractional best", () => {
    expect(parseBoardDelayRow({ hidden_profitable: "2", best_hidden_profit_cents: "1840" })).toEqual({
      hidden_profitable: 2,
      best_hidden_profit_cents: 1840,
    });
    expect(parseBoardDelayPayload({
      delay_seconds: 10800,
      hidden_profitable: 2,
      best_hidden_profit_cents: 18.4,
    })).toBeNull();
  });

  it("returns null for a missing count so the UI does not invent one", () => {
    expect(parseBoardDelayPayload(null)).toBeNull();
    expect(parseBoardDelayPayload({})).toBeNull();
    expect(parseBoardDelayPayload({ hidden_profitable: -1, best_hidden_profit_cents: 100 })).toBeNull();
    expect(boardDelaySentence(null)).toBeNull();
    expect(boardDelaySentence(undefined)).toBeNull();
  });

  it("states the hidden count and the best expected P/L in cents", () => {
    expect(boardDelaySentence({ hidden_profitable: 0, best_hidden_profit_cents: null }))
      .toBe("No profitable trade-ups are inside the 3-hour window right now.");
    expect(boardDelaySentence({ hidden_profitable: 1, best_hidden_profit_cents: 1840 }))
      .toBe("1 profitable trade-up found in the last 3 hours is hidden on the free board. It is +$18.40 expected P/L.");
    expect(boardDelaySentence({ hidden_profitable: 12, best_hidden_profit_cents: 7600 }))
      .toBe("12 profitable trade-ups found in the last 3 hours are hidden on the free board. The best is +$76.00 expected P/L.");
    expect(boardDelaySentence({ hidden_profitable: 1200, best_hidden_profit_cents: null }))
      .toBe("1,200 profitable trade-ups found in the last 3 hours are hidden on the free board.");
  });
});
