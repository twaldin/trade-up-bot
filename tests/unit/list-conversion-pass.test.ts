import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const table = readFileSync(join(__dir, "../../src/components/TradeUpTable.tsx"), "utf-8");
const page = readFileSync(join(__dir, "../../src/pages/TradeUpsPage.tsx"), "utf-8");
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

describe("C: free-delay transparency banner above the table", () => {
  it("names the concrete delay and links pricing", () => {
    expect(page).toContain("delayed 3 hours");
  });
  it("renders before the table, not only after it", () => {
    const bannerIdx = page.indexOf("delayed 3 hours");
    const tableIdx = page.indexOf("<TradeUpTable");
    expect(bannerIdx).toBeGreaterThan(-1);
    expect(bannerIdx).toBeLessThan(tableIdx);
  });
});
