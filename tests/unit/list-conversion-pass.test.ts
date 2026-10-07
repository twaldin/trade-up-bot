import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const table = readFileSync(join(__dir, "../../src/components/TradeUpTable.tsx"), "utf-8");
const board = readFileSync(join(__dir, "../../src/preview/pages/PreviewBoard.tsx"), "utf-8");
const api = readFileSync(join(__dir, "../../server/routes/trade-ups.ts"), "utf-8");

describe("A: visible Details affordance", () => {
  it("rows render a labeled Details control, not just a bare chevron", () => {
    expect(table).toContain(">Details<");
  });
});

describe("B: sign-up nudge in the expanded row", () => {
  it("api exposes signed_in so the UI can distinguish anonymous from free-tier users", () => {
    expect(api).toMatch(/signed_in: Boolean\(req\.user\)/);
  });
  it("expanded panel nudge fires sign_up_start tagged expanded_row and only for signed-out", () => {
    expect(table).toContain('trackEvent("sign_up_start", { location: "expanded_row" })');
    expect(table).toMatch(/\{!signedIn && \(/);
    expect(table).toContain("authHref(");
  });
});

describe("C: free-delay transparency banner above the board", () => {
  it("names the concrete delay and links pricing", () => {
    expect(board).toContain("DELAY_BANNER");
    expect(board).toContain("boardDelaySentence");
    expect(board).toContain(">See Pro<");
  });
  it("renders before the cards, not only after them", () => {
    const bannerIdx = board.indexOf("preview-delay${");
    const cardsIdx = board.indexOf('className="preview-bento preview-bento--reserved"');
    expect(bannerIdx).toBeGreaterThan(-1);
    expect(bannerIdx).toBeLessThan(cardsIdx);
  });
});
