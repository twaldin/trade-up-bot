import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { makeUserTradeUp } from "../helpers/fixtures.js";
import {
  ACCOUNT_EMPTY,
  ACCOUNT_TABS,
  MARKETPLACE_LABELS,
  MARKETPLACE_OPTIONS,
  MY_TRADE_UPS_API,
  claimMinutesLeft,
  claimTimerLabel,
  confirmPurchaseCopy,
  expiryByTradeUpId,
  parseSalePriceCents,
  realListingIds,
  salePreview,
  signClass,
  tradeHoldStatus,
  userTradeUpToTradeUp,
} from "../../src/preview/lib/my-trade-ups.js";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(dir, rel), "utf8");

describe("my-trade-ups helpers", () => {
  it("maps a snapshot onto a TradeUp without inventing fractional dollars", () => {
    const entry = makeUserTradeUp({
      id: 42,
      total_cost_cents: 110452,
      expected_value_cents: 164853,
      roi_percentage: 49.2,
    });
    const tu = userTradeUpToTradeUp(entry);
    expect(tu.id).toBe(42);
    expect(Number.isInteger(tu.total_cost_cents)).toBe(true);
    expect(Number.isInteger(tu.expected_value_cents)).toBe(true);
    expect(tu.profit_cents).toBe(164853 - 110452);
    expect(Number.isInteger(tu.profit_cents)).toBe(true);
    expect(tu.inputs[0]?.skin_name).toBe("AK-47 | Redline");
    expect(tu.outcomes[0]?.skin_name).toBe("AK-47 | Fire Serpent");
  });

  it("keeps sale prices in integer cents and rejects junk", () => {
    expect(parseSalePriceCents("12.34")).toBe(1234);
    expect(parseSalePriceCents("0.01")).toBe(1);
    expect(parseSalePriceCents("0")).toBeNull();
    expect(parseSalePriceCents("")).toBeNull();
    expect(parseSalePriceCents("nope")).toBeNull();
    fc.assert(fc.property(fc.double({ min: Math.fround(0.01), max: 1_000_000, noNaN: true }), (dollars) => {
      const cents = parseSalePriceCents(dollars.toFixed(2));
      expect(cents).not.toBeNull();
      expect(Number.isInteger(cents)).toBe(true);
      expect(cents).toBeGreaterThan(0);
    }));
  });

  it("previews realized P/L from a sale against cost", () => {
    const preview = salePreview(2500, 4000);
    expect(preview.profitCents).toBe(1500);
    expect(preview.roi).toBe(60);
    expect(salePreview(2500, 1000).profitCents).toBe(-1500);
    expect(salePreview(0, 1000).roi).toBe(0);
  });

  it("reports the 7-day trade hold the old page used", () => {
    const ready = tradeHoldStatus(new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString());
    expect(ready.ready).toBe(true);
    expect(ready.label).toBe("Ready to execute");
    const waiting = tradeHoldStatus(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString());
    expect(waiting.ready).toBe(false);
    expect(waiting.label).toMatch(/^Ready in \d+d \d+h$/);
  });

  it("drops theoretical listing ids before confirm", () => {
    const tu = userTradeUpToTradeUp(makeUserTradeUp());
    tu.inputs = [
      { ...tu.inputs[0]!, listing_id: "csfloat-1" },
      { ...tu.inputs[0]!, listing_id: "theor-2" },
    ];
    expect(realListingIds(tu)).toEqual(["csfloat-1"]);
  });

  it("keeps the old empty copy and marketplace labels", () => {
    expect(ACCOUNT_TABS.map((tab) => tab.key)).toEqual(["claims", "purchased", "history"]);
    expect(ACCOUNT_EMPTY.claims).toEqual({
      title: "No active claims.",
      sub: "Claim trade-ups from the main table to lock their listings.",
    });
    expect(ACCOUNT_EMPTY.purchased).toEqual({
      title: "No purchased trade-ups.",
      sub: "After confirming a claimed trade-up, it will appear here.",
    });
    expect(ACCOUNT_EMPTY.history).toEqual({
      title: "No trade-up history yet.",
      sub: "Executed and sold trade-ups will appear here.",
    });
    expect(MARKETPLACE_LABELS.csfloat).toBe("CSFloat");
    expect(MARKETPLACE_OPTIONS.map((row) => row.value)).toEqual([
      "csfloat", "skinport", "buff", "steam_market", "other",
    ]);
    expect(signClass(1)).toBe("is-plus");
    expect(signClass(0)).toBe("is-plus");
    expect(signClass(-1)).toBe("is-minus");
  });

  it("only talks to the existing my-trade-ups and claim APIs", () => {
    expect(MY_TRADE_UPS_API.claims).toBe("/api/trade-ups?my_claims=true&per_page=50");
    expect(MY_TRADE_UPS_API.purchased).toBe("/api/my-trade-ups?status=purchased");
    expect(MY_TRADE_UPS_API.history).toBe("/api/my-trade-ups?status=executed,sold");
    expect(MY_TRADE_UPS_API.stats).toBe("/api/my-trade-ups/stats");
    expect(MY_TRADE_UPS_API.execute(9)).toBe("/api/my-trade-ups/9/execute");
    expect(MY_TRADE_UPS_API.sell(9)).toBe("/api/my-trade-ups/9/sell");
    expect(MY_TRADE_UPS_API.remove(9)).toBe("/api/my-trade-ups/9");
    expect(MY_TRADE_UPS_API.unclaim(9)).toBe("/api/trade-ups/9/claim");
    expect(MY_TRADE_UPS_API.claim(9)).toBe("/api/trade-ups/9/claim");
    expect(MY_TRADE_UPS_API.confirm(9)).toBe("/api/trade-ups/9/confirm");
    expect(MY_TRADE_UPS_API.verify(9)).toBe("/api/verify-trade-up/9");
    expect(MY_TRADE_UPS_API.activeClaims).toBe("/api/claims");
  });

  it("prints the old 30-minute claim timer and confirm copy", () => {
    const now = Date.parse("2026-08-19T12:00:00.000Z");
    expect(claimMinutesLeft("2026-08-19T12:18:00.000Z", now)).toBe(18);
    expect(claimTimerLabel("2026-08-19T12:18:00.000Z", now)).toEqual({
      expired: false, minutes: 18, label: "18m left",
    });
    expect(claimTimerLabel("2026-08-19T11:59:00.000Z", now)).toEqual({
      expired: true, minutes: 0, label: "Expired",
    });
    expect(confirmPurchaseCopy(10, 10)).toBe("Confirm all inputs purchased? This removes them from the system.");
    expect(confirmPurchaseCopy(3, 10)).toBe("Confirm 3 of 10 purchased? Unselected inputs will be released.");
    expect(expiryByTradeUpId([{ trade_up_id: 7, expires_at: "soon" }]).get(7)).toBe("soon");
  });
});

describe("kit my-trade-ups page", () => {
  const page = read("../../src/preview/pages/PreviewAccount.tsx");
  const lib = read("../../src/preview/lib/my-trade-ups.ts");
  const shell = read("../../src/preview/PreviewShell.tsx");

  it("ports the old tabs, stats, and actions onto kit surfaces", () => {
    expect(page).toContain("TradeUpCard");
    expect(page).toContain("PreviewTable");
    expect(page).toContain("o-tab");
    expect(page).toContain("ACCOUNT_TABS");
    expect(lib).toContain("Active Claims");
    expect(lib).toContain("Purchased");
    expect(lib).toContain("History");
    expect(page).toContain("MY_TRADE_UPS_API.stats");
    expect(page).toContain("all_time_profit_cents");
    expect(page).toContain("total_sold");
    expect(page).toContain("Sign in to see claims and Pro delivery.");
    expect(page).toContain("Mark Complete");
    expect(page).toContain("Mark Sold");
    expect(page).toContain("Confirm Sale");
    expect(page).toContain("Release");
    expect(page).toContain("Confirm Purchase");
    expect(page).toContain("MY_TRADE_UPS_API.verify");
    expect(page).toContain("MY_TRADE_UPS_API.claim");
    expect(page).toContain("MY_TRADE_UPS_API.activeClaims");
    expect(page).toContain("claimTimerLabel");
    expect(page).toContain("salePrice");
    expect(page).toContain("saleMarketplace");
    expect(page).not.toContain("TradeUpTable");
    expect(page).not.toContain("preview-listing");
    expect(page).not.toContain("<span className=\"preview-chip\">claim</span>");
    expect(lib).not.toContain("expected_value_cents *");
  });

  it("labels the sidebar My trade-ups and keeps /account as the same page", () => {
    expect(shell).toContain('to: "/my-trade-ups"');
    expect(shell).toContain("My trade-ups");
    expect(shell).not.toContain('label: "Account"');
    expect(page).toContain('to="/my-trade-ups"');
  });

  it("does not leak production chrome or a foreign green", () => {
    for (const leak of [
      "rounded-md", "rounded-lg", "text-muted-foreground", "border-border",
      "bg-card", "text-foreground", "bg-muted", "text-green-400", "text-red-400",
    ]) {
      expect(page, leak).not.toContain(leak);
      expect(lib, leak).not.toContain(leak);
    }
    expect(page).not.toMatch(/\b[Cc]ontracts?\b/);
    expect(lib).not.toMatch(/\b[Cc]ontracts?\b/);
  });
});

describe("share page claim and verify hooks", () => {
  const share = read("../../src/pages/TradeUpSharePage.tsx");

  it("calls the existing verify, claim, confirm, and release endpoints", () => {
    expect(share).toContain("MY_TRADE_UPS_API.verify");
    expect(share).toContain("MY_TRADE_UPS_API.claim");
    expect(share).toContain("MY_TRADE_UPS_API.confirm");
    expect(share).toContain("MY_TRADE_UPS_API.unclaim");
    expect(share).toContain("MY_TRADE_UPS_API.activeClaims");
    expect(share).toContain("Confirm Purchase");
    expect(share).toContain("Release");
    expect(share).not.toContain("onVerify={() => {}}");
  });
});
