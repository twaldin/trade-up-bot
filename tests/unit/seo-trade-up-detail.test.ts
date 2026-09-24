import { describe, it, expect } from "vitest";
import { renderTradeUpDetail } from "../../server/seo.js";
import { detailTradeUpHeading } from "../../shared/copy.js";
import { detailTypeLabel, tradeUpDetailJsonLd } from "../../shared/types.js";

const tradeUp = {
  id: 767744697,
  type: "classified_covert",
  total_cost_cents: 28469,
  profit_cents: 3509,
  roi_percentage: 12.3,
  chance_to_profit: 0.32,
};

const inputs = Array.from({ length: 10 }, (_, i) => ({
  skin_name: `AWP | Queen's Gambit ${i + 1}`,
  condition: "Field-Tested",
  collection_name: "The Recoil Collection",
  price_cents: 2847,
}));

const outcomes = [
  { skin_name: "AWP | Gungnir", probability: 0.32, predicted_condition: "Factory New", estimated_price_cents: 50000 },
  { skin_name: "AWP | Graphite", probability: 0.68, predicted_condition: "Field-Tested", estimated_price_cents: 1500 },
];

const related = [
  { label: "Recoil Collection Trade-Ups", url: "/trade-ups/collection/recoil" },
  { label: "AWP | Queen's Gambit", url: "/skins/awp-queens-gambit" },
];

describe("renderTradeUpDetail (#3 + #9-detail)", () => {
  it("produces an H1 with type label and profit amount", () => {
    const html = renderTradeUpDetail(tradeUp, inputs, outcomes, related);
    expect(html).toMatch(/<h1>/);
    expect(html).toContain("$35.09");
    expect(html).toContain("12.3%");
  });

  it("uses the input-to-output heading for the H1 and the breadcrumb", () => {
    const label = detailTypeLabel(tradeUp.type);
    const heading = detailTradeUpHeading(tradeUp.type);
    const html = renderTradeUpDetail(tradeUp, inputs, outcomes, related);
    expect(label).toBe("Classified");
    expect(heading).toBe("Classified to Covert Trade-Up");
    expect(html).toContain(`<h1>${heading}`);
    expect(html).not.toContain("<h1>Covert Trade-Up");
    const ld = tradeUpDetailJsonLd(tradeUp.id, heading);
    const parsed = JSON.parse(JSON.stringify(ld)) as { "@type": string; itemListElement: { name: string }[] };
    expect(parsed["@type"]).toBe("BreadcrumbList");
    expect(parsed.itemListElement[2]?.name).toBe("Classified to Covert Trade-Up");
    expect(JSON.stringify(ld)).not.toMatch(/aggregateRating|review|ratingValue|offers/i);
  });

  it("renders all 10 inputs under an Inputs section", () => {
    const html = renderTradeUpDetail(tradeUp, inputs, outcomes, related);
    expect(html).toContain("<h2>Inputs</h2>");
    for (let i = 1; i <= 10; i++) {
      expect(html).toContain(`AWP | Queen's Gambit ${i}`);
    }
  });

  it("renders outputs with probabilities under Outputs section", () => {
    const html = renderTradeUpDetail(tradeUp, inputs, outcomes, related);
    expect(html).toContain("<h2>Outputs</h2>");
    expect(html).toContain("AWP | Gungnir");
    expect(html).toContain("32%");
  });

  it("has a Mechanics section with float averaging explanation", () => {
    const html = renderTradeUpDetail(tradeUp, inputs, outcomes, related);
    expect(html).toContain("<h2>Mechanics</h2>");
    expect(html.toLowerCase()).toMatch(/float/);
  });

  it("has a Related section with links", () => {
    const html = renderTradeUpDetail(tradeUp, inputs, outcomes, related);
    expect(html).toContain("<h2>Related</h2>");
    expect(html).toContain("/trade-ups/collection/recoil");
    expect(html).toContain("Recoil Collection Trade-Ups");
  });

  it("contains no /api/ links", () => {
    const html = renderTradeUpDetail(tradeUp, inputs, outcomes, related);
    expect(html).not.toMatch(/href="\/api\//);
    expect(html).not.toMatch(/href='\/api\//);
  });

  it("omits per-input price and source when the row is inside the free delay", () => {
    const priced = inputs.map((row) => ({ ...row, source: "csfloat", price_cents: 1234 }));
    const html = renderTradeUpDetail(tradeUp, priced, outcomes, related, { hideInputCommercials: true });
    const start = html.indexOf("<h2>Inputs</h2>");
    const end = html.indexOf("<h2>Outputs</h2>");
    const section = html.slice(start, end);
    expect(section).toContain("AWP | Queen's Gambit 1");
    expect(section).not.toMatch(/\$\d/);
    expect(section.toLowerCase()).not.toContain("csfloat");
    expect(html).toContain("$284.69");
  });

  it("targets ~600 words of content", () => {
    const html = renderTradeUpDetail(tradeUp, inputs, outcomes, related);
    const textContent = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const wordCount = textContent.split(" ").filter(Boolean).length;
    expect(wordCount).toBeGreaterThanOrEqual(150);
  });
});
