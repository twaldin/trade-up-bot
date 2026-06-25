import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const indexSource = readFileSync(join(__dir, "../../server/index.ts"), "utf-8");

// Isolate the /collections/:slug handler so assertions don't match the separate
// /trade-ups/collection/:slug handler (which legitimately uses the same predicate).
const start = indexSource.indexOf('app.get("/collections/:slug"');
const end = indexSource.indexOf('app.get("/skins/:slug"', start);
const handler = indexSource.slice(start, end);

describe("plan 025: float-exact best-profit summary on /collections/:slug", () => {
  it("renders a server-side 'best profitable trade-up right now' summary", () => {
    expect(handler).toContain("Best profitable ");
    // Claim must be always-true (real-listing), NOT an unconditional float-exact claim —
    // output pricing can fall back to condition-level reference pricing for some contracts.
    expect(handler).toContain("built from real, currently-listed marketplace inputs");
    // No specific marketplace named — inputs can include Buff, so naming only 3 would overclaim.
    expect(handler).not.toContain("on CSFloat, DMarket, and Skinport.");
    expect(handler).not.toContain("exact predicted output float");
    expect(handler).toContain("/trade-ups/${bestTu.id}");
  });

  it("the best-trade-up query uses the strict public predicate (profit > 100 + non-stale)", () => {
    // The best-profit and count queries must not surface penny/stale contracts.
    expect(handler).toContain("t.profit_cents > 100");
    expect(handler).toContain("t.preserved_at > NOW() - INTERVAL '7 days'");
    // The loose profit_cents > 0 count must be gone from this handler.
    expect(handler).not.toContain("t.profit_cents > 0");
    expect(handler).toContain("ORDER BY t.profit_cents DESC");
  });

  it("only shows the summary when a profitable contract exists (no empty/penny claim)", () => {
    // Conditional render: bestProfitHtml is "" when there is no qualifying trade-up.
    expect(handler).toContain("const bestProfitHtml = bestTu");
    expect(handler).toContain('+ bestProfitHtml');
  });

  it("bumps the collection cache key so the new HTML serves immediately", () => {
    expect(handler).toContain("seo_collection_v2:");
    expect(handler).toContain("seo_collection_meta_v2:");
  });
});
