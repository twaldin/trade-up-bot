import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(dir, rel), "utf8");

describe("upgrade CTAs", () => {
  it("tracks each gate without changing the checkout event", () => {
    const board = read("../../src/preview/pages/PreviewBoard.tsx");
    const landing = read("../../src/preview/pages/PreviewLanding.tsx");
    const share = read("../../src/preview/pages/PreviewShare.tsx");
    const intent = read("../../src/preview/pages/PreviewIntent.tsx");
    const pricing = read("../../src/preview/pages/PreviewPricing.tsx");
    const checkout = read("../../src/preview/lib/checkout.ts");

    expect(board).toContain('trackUpgradeCta("board_delay")');
    expect(board).toContain('trackUpgradeCta("redacted_links")');
    expect(board).toContain("boardDelaySentence");
    expect(landing).toContain('trackUpgradeCta("landing_delay")');
    expect(landing).toContain("{DELAY_BANNER}");
    expect(share).toContain('trackUpgradeCta("share_upgrade")');
    expect(share).toContain('to="/pricing" onClick={() => trackUpgradeCta("share_upgrade")}>See Pro plans');
    expect(intent).toContain('trackUpgradeCta("intent_pro")');
    expect(intent).toContain('trackCtaClick("intent_board")');
    expect(pricing).toContain('trackUpgradeCta("pricing_go_pro")');
    expect(pricing).toContain("runCheckout(PLAN_FOR[billing])");
    expect(checkout).toContain("trackBeginCheckout");
    expect(checkout).not.toContain("checkout_start");
  });

  it("puts a pricing link in the search-landing HTML", () => {
    const landings = read("../../src/preview/lib/intent-landings.ts");
    expect(landings).toContain('href="/pricing">See Pro plans</a>');
    expect(landings).toContain("proPriceLine(\"monthly\")");
    expect(landings).toContain("${OPEN_BOARD_CTA}");
    expect(landings).toContain("FREE_VIEW_DELAY_NOTE");
    expect(landings).not.toContain("Open the live board");
  });
});
