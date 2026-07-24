import { describe, it, expect } from "vitest";
import { STATIC_SEO_PAGES } from "../../server/static-seo-pages.js";

const faqPage = STATIC_SEO_PAGES.find((p) => p.path === "/faq")!;

describe("FAQ assistant-style questions", () => {
  const wanted = [
    "Are CS2 trade-ups still profitable in 2026?",
    "Can you lose money on CS2 trade-ups?",
    "What is the best CS2 trade-up right now?",
    "Do you need an account to use TradeUpBot?",
  ];

  it("adds the four assistant-phrased questions to the visible body", () => {
    for (const q of wanted) expect(faqPage.bodyHtml).toContain(`<h3>${q}</h3>`);
  });

  it("mirrors each new question in the FAQPage JSON-LD", () => {
    const faq = (faqPage.jsonLd ?? []).find((x) => x["@type"] === "FAQPage") as {
      mainEntity: { name: string }[];
    };
    const names = faq.mainEntity.map((e) => e.name);
    for (const q of wanted) expect(names).toContain(q);
  });

  it("keeps answers honest: the profitability answer must not promise profit", () => {
    const faq = (faqPage.jsonLd ?? []).find((x) => x["@type"] === "FAQPage") as {
      mainEntity: { name: string; acceptedAnswer: { text: string } }[];
    };
    const profitability = faq.mainEntity.find((e) => e.name.includes("still profitable"))!;
    const t = profitability.acceptedAnswer.text.toLowerCase();
    // Negated disclaimers ("never guaranteed") are required; promising forms are banned.
    expect(t).toMatch(/never guaranteed|not guaranteed/);
    expect(t).not.toContain("guaranteed profit");
    expect(t).toContain("fees");
  });

  it("the 'best trade-up right now' answer routes to the live list", () => {
    expect(faqPage.bodyHtml).toContain('href="/trade-ups"');
  });
});
