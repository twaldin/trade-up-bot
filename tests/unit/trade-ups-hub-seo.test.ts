import { describe, expect, it } from "vitest";
import { renderTradeUpsHub } from "../../server/seo.js";
import { formatOdds } from "../../src/preview/lib/board.js";
import { shareDocumentTitle } from "../../src/preview/lib/copy.js";
import { TRADE_UPS_FAQ } from "../../shared/trade-ups-faq.js";

const tradeUps = Array.from({ length: 6 }, (_, i) => ({
  id: 1000 + i,
  type: "classified_covert",
  total_cost_cents: 25000 + i * 100,
  profit_cents: 3000 + i * 100,
  roi_percentage: 12 + i,
  chance_to_profit: 0.3 + i * 0.01,
}));

const collections = [
  { name: "Dreams & Nightmares", slug: "dreams-nightmares", count: 42 },
  { name: "Recoil", slug: "recoil", count: 36 },
  { name: "Fracture", slug: "fracture", count: 31 },
  { name: "Prisma", slug: "prisma", count: 28 },
  { name: "Chroma", slug: "chroma", count: 24 },
];

describe("renderTradeUpsHub", () => {
  it("renders a crawler hub with mechanics copy and required internal links", () => {
    const html = renderTradeUpsHub({
      total: 125,
      profitable: 84,
      topTradeUps: tradeUps,
      collections,
    });
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const words = text.split(" ").filter(Boolean);

    expect(html).toContain("<h1>Live CS2 Trade-Up Contracts from Real Listings</h1>");
    expect(words.length).toBeGreaterThanOrEqual(200);
    expect(html.match(/href="\/trade-ups\/collection\//g)?.length).toBeGreaterThanOrEqual(5);
    expect(html.match(/href="\/blog\//g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain('href="/calculator"');
    expect(html.match(/href="\/trade-ups\/\d+"/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it("keeps five trade-up detail hrefs available when a local fixture DB has sparse rows", () => {
    const html = renderTradeUpsHub({
      total: 3,
      profitable: 3,
      topTradeUps: tradeUps.slice(0, 3),
      collections,
    });
    expect(html.match(/href="\/trade-ups\/\d+[^"]*"/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it("prints the shared FAQ and never rounds 0.996 to 100%", () => {
    const html = renderTradeUpsHub({
      total: 10,
      profitable: 4,
      topTradeUps: [{ ...tradeUps[0], chance_to_profit: 0.996 }],
      collections,
    });
    for (const item of TRADE_UPS_FAQ) {
      expect(html).toContain(item.q);
      expect(html).toContain(item.a);
    }
    expect(html).toContain(formatOdds(0.996));
    expect(html).not.toContain(">100%<");
    expect(formatOdds(0.996)).toBe(">99%");
    expect(formatOdds(1)).toBe("100%");
  });

  it("keeps share titles within 60 characters", () => {
    const title = shareDocumentTitle("Knife/Glove", "-$12,345.67", ">99%");
    expect(title.length).toBeLessThanOrEqual(60);
    expect(shareDocumentTitle("Covert", "$3.20", "50%").length).toBeLessThanOrEqual(60);
  });
});
