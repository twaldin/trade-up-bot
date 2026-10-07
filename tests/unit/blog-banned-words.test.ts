/**
 * Shared by the probability-guide PR and the five-post PR.
 * Both branches carry this same file. A slug is enforced once its rewrite
 * marker is in the tree, so each PR stays green before the other merges.
 * After both land, every post these PRs edit is checked, and a rebase of
 * the second branch does not change this file.
 */
import { describe, expect, it } from "vitest";
import { blogMeta } from "../../src/data/blog-meta.js";
import { blogPosts, type BlogPost } from "../../src/data/blog-posts.js";

const SLUGS = [
  "cs2-trade-up-probability-expected-value",
  "how-cs2-trade-ups-work",
  "why-cs2-trade-up-calculators-disagree",
  "best-cs2-collections-knife-trade-ups-2026",
  "profitable-trade-ups-theory-vs-reality",
  "cs2-trade-up-marketplace-fees",
] as const;

/** Present only after that post's rewrite. Unrelated posts are not scanned. */
const MARKERS: Record<(typeof SLUGS)[number], string> = {
  "cs2-trade-up-probability-expected-value": "Outcomes Above Cost: The Practical Metric",
  "how-cs2-trade-ups-work": "70% probability of a Fracture output",
  "why-cs2-trade-up-calculators-disagree": "The output probabilities are fixed.",
  "best-cs2-collections-knife-trade-ups-2026": "how diluted each output's probability is",
  "profitable-trade-ups-theory-vs-reality": "only one possible output remove outcome variance",
  "cs2-trade-up-marketplace-fees": "Skinport is cheapest at every price point",
};

const LOCKED: Record<(typeof SLUGS)[number], { title: string; excerpt: string }> = {
  "cs2-trade-up-probability-expected-value": {
    title: "How to Use CS2 Trade-Up Probability and EV Wisely",
    excerpt:
      "Learn how to use CS2 trade-up probability and expected value with a $80 example before choosing risky contracts.",
  },
  "how-cs2-trade-ups-work": {
    title: "How CS2 Trade-Ups Work: 10 Skins, Float & Profit",
    excerpt:
      "Learn how CS2 trade-ups work with 10 skins, float math, outcome probabilities, and fees. Use this guide to calculate smarter contracts before buying.",
  },
  "why-cs2-trade-up-calculators-disagree": {
    title: "Why CS2 Trade-Up Calculators Disagree",
    excerpt:
      "Two CS2 trade-up calculators, same 10 inputs, different profit. The reason is almost always how each tool prices the output skin: condition average versus float-exact.",
  },
  "best-cs2-collections-knife-trade-ups-2026": {
    title: "7 Best CS2 Knife Trade-Up Collections by 2026 Data",
    excerpt:
      "Discover the 7 best CS2 knife trade-up collections using real 2026 data on input prices, knife pools, and downside risk before buying.",
  },
  "profitable-trade-ups-theory-vs-reality": {
    title: "CS2 Trade-Up Calculators Are Wrong: $2,778 Data Test",
    excerpt:
      "See the $2,778 theory-vs-reality gap in CS2 trade-up calculators. Compare real listings, fees, and floats before you trust profit claims.",
  },
  "cs2-trade-up-marketplace-fees": {
    title: "CS2 Trade-Up Fees: CSFloat, DMarket & Skinport",
    excerpt:
      "CSFloat charges 2% seller fee (2.8% + $0.30 buyer). DMarket: 2% seller, 2.5% buyer. Skinport: 8% seller, 0% buyer. Full CS2 marketplace fee breakdown for trade-ups.",
  },
};

/**
 * Word-boundary, case-insensitive. `roll` / `rolls` / `rolled` match.
 * The trailing `(?!-)` keeps hyphenated compounds such as `rolled-out`
 * out. `scroll`, `payroll`, and `rollback` fail the boundary.
 */
const BANNED =
  /\b(?:chances?|odds|gambl\w*|bankrolls?|jackpots?|bets?|betting|win|wins|winning|winners?|lottery|win rate|guaranteed|lucky|rolls?|rolled)\b(?!-)|cannot lose|\brisk-free\b|%\s*profit\b|\bprofit\s*%/gi;

/** FAQ questions that deny a guarantee may stay. Market skin names may contain a banned word. */
const ALLOW_SNIPPETS = ["guarantee profit?", "High Roller"];

function postBySlug(slug: string): BlogPost {
  const post = blogPosts.find((entry) => entry.slug === slug);
  if (!post) throw new Error(`missing blog post ${slug}`);
  return post;
}

function scannedText(post: BlogPost): string {
  const faq = (post.faq ?? [])
    .map((item) => `${item.question}\n${item.answer}`)
    .join("\n");
  let text = `${post.content}\n${faq}`;
  for (const snippet of ALLOW_SNIPPETS) {
    text = text.split(snippet).join(" ");
    text = text.split(snippet.toLowerCase()).join(" ");
  }
  return text;
}

function bannedHits(text: string): string[] {
  const pattern = new RegExp(BANNED.source, BANNED.flags);
  return [...text.matchAll(pattern)].map((match) => {
    const at = match.index ?? 0;
    const around = text.slice(Math.max(0, at - 48), at + match[0].length + 48).replace(/\s+/g, " ");
    return `"${match[0]}" in "…${around}…"`;
  });
}

describe("blog banned words", () => {
  for (const slug of SLUGS) {
    const post = postBySlug(slug);
    const rewritten = scannedText(post).includes(MARKERS[slug]);

    it.skipIf(!rewritten)(`${slug} content and FAQ contain none of the banned words`, () => {
      const hits = bannedHits(scannedText(post));
      expect(hits, hits.join("\n")).toEqual([]);
    });

    it(`${slug} keeps its slug, title, H1, and meta`, () => {
      const meta = blogMeta.find((entry) => entry.slug === slug);
      const locked = LOCKED[slug];
      expect(post.slug).toBe(slug);
      expect(post.h1).toBeUndefined();
      expect(post.title).toBe(locked.title);
      expect(post.excerpt).toBe(locked.excerpt);
      expect(meta?.title).toBe(post.title);
      expect(meta?.excerpt).toBe(post.excerpt);
    });
  }

  it("matches roll, rolls, rolled, lucky, and risk-free, and misses lookalikes", () => {
    const hit = (text: string) => bannedHits(text);
    expect(hit("a lucky roll")).toEqual([
      expect.stringContaining("\"lucky\""),
      expect.stringContaining("\"roll\""),
    ]);
    expect(hit("two rolls")).toEqual([expect.stringContaining("\"rolls\"")]);
    expect(hit("he rolled")).toEqual([expect.stringContaining("\"rolled\"")]);
    expect(hit("a risk-free contract")).toEqual([expect.stringContaining("\"risk-free\"")]);
    expect(hit("scroll payroll rollback rolled-out controller")).toEqual([]);
  });

  it("keeps the probability walkthrough on engine EV", () => {
    const content = postBySlug("cs2-trade-up-probability-expected-value").content;
    if (!content.includes(MARKERS["cs2-trade-up-probability-expected-value"])) return;
    const probs = [0.35, 0.35, 0.3];
    const prices = [120, 40, 200];
    const ev = probs.reduce((sum, probability, index) => sum + probability * prices[index], 0);
    expect(probs.reduce((sum, probability) => sum + probability, 0)).toBeCloseTo(1);
    expect(ev).toBeCloseTo(116);
    expect(ev - 80).toBeCloseTo(36);
    expect(probs.reduce((sum, probability, index) => sum + (prices[index] > 80 ? probability : 0), 0)).toBeCloseTo(0.65);
    expect(0.9 * 5 + 0.1 * -30).toBeCloseTo(1.5);
    expect(6 * 5).toBe(30);
    expect(0.6 * 15 + 0.4 * -35).toBeCloseTo(-5);
    expect(10 * 80).toBe(800);
    expect(10 * 5).toBe(50);
    expect(1 * 84 - 80).toBe(4);
    expect(content).toContain("EV = sum(probability_i * output_price_i)");
    expect(content).toContain("EV = $42 + $14 + $60 = $116");
    expect(content).toContain("Expected P/L = $116 - $80 = +$36");
    expect(content).toContain("Those probabilities sum to 100%.");
    expect(content).not.toMatch(/25\s*%/);
    expect(content).toContain("The board includes trade-ups with negative expected P/L. The Min above cost % filter narrows the list to ones where more outcomes land above cost.");
    expect(content).toContain("Sort by Above cost % to find the trade-ups where the largest share of outcomes lands above cost.");
    expect(content).toContain("expected P/L is one average number, and it does not show how far the individual outcomes spread above or below it");
    expect(content).toContain("+$5 expected P/L per trade-up come to about +$50 across all 10");
    expect(content).not.toMatch(/win_rate|win rate/i);
  });

  it("ships the short-post replacement sentences", () => {
    const how = postBySlug("how-cs2-trade-ups-work").content;
    if (!how.includes(MARKERS["how-cs2-trade-ups-work"])) return;
    expect(how).toContain(
      "Before buying anything, work out input cost, adjusted float, output probabilities, and marketplace fees. Any profit figure is an estimate after fees, and a trade-up can lose money.",
    );
    expect(how).toContain(
      "A collection with one expensive skin and four cheap ones is high variance: most outcomes are cheap, and the average depends on one rare result.",
    );
    expect(postBySlug("profitable-trade-ups-theory-vs-reality").content).toContain(
      "Trade-ups with only one possible output remove outcome variance, but not price risk. The output's price can move before you sell, and fees still apply, so even these can lose money.",
    );
    const fees = postBySlug("cs2-trade-up-marketplace-fees");
    expect(fees.content).toContain("For buying inputs, Skinport is cheapest at every price point: $50 costs $50.");
    expect(fees.faq?.some((item) => item.answer.includes("Skinport is cheapest"))).toBe(true);
    const knives = postBySlug("best-cs2-collections-knife-trade-ups-2026").content;
    expect(knives).toContain("how diluted each output's probability is");
    expect(knives).toContain(
      "trade-ups with a higher share of outcomes above cost, even if the top outcome is worth less. For lower variance, gloves can compare well with knives.",
    );
    const disagree = postBySlug("why-cs2-trade-up-calculators-disagree");
    expect(disagree.content).toContain("The output probabilities are fixed.");
    expect(disagree.content).toContain("If two tools printed different probabilities, one would simply be wrong.");
    expect(disagree.faq?.[0]?.answer.startsWith(
      "The float math and output probabilities are deterministic, so tools agree there.",
    )).toBe(true);
  });
});
