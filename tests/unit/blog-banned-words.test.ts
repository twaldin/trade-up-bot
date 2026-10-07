/**
 * Gambling-vocabulary gate for blog posts whose copy has been rewritten.
 * Scans visible HTML plus FAQ JSON-LD. Other posts still contain the old
 * wording and are out of scope until their batch lands.
 */
import { describe, expect, it } from "vitest";
import { blogMeta } from "../../src/data/blog-meta.js";
import { blogPosts, type BlogPost } from "../../src/data/blog-posts.js";

const SLUGS = [
  "how-cs2-trade-ups-work",
  "why-cs2-trade-up-calculators-disagree",
  "best-cs2-collections-knife-trade-ups-2026",
  "profitable-trade-ups-theory-vs-reality",
  "cs2-trade-up-marketplace-fees",
] as const;

const LOCKED: Record<(typeof SLUGS)[number], { title: string; excerpt: string }> = {
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

/** Plan regex, plus the two extra prose bans from the rewrite brief. */
const BANNED =
  /\b(chances?|odds|gambl\w*|bankrolls?|jackpots?|bets?|betting|win|wins|winning|winners?|lottery|win rate|guaranteed)\b|cannot lose|%\s*profit\b|\bprofit\s*%/gi;

/**
 * FAQ questions that deny a guarantee may stay. Market skin names may
 * contain a banned word (for example "High Roller") and are not prose.
 */
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
  return [...text.matchAll(BANNED)].map((match) => {
    const at = match.index ?? 0;
    const around = text.slice(Math.max(0, at - 48), at + match[0].length + 48).replace(/\s+/g, " ");
    return `"${match[0]}" in "…${around}…"`;
  });
}

describe("blog banned words", () => {
  for (const slug of SLUGS) {
    it(`${slug} content and FAQ contain none of the banned words`, () => {
      const hits = bannedHits(scannedText(postBySlug(slug)));
      expect(hits, hits.join("\n")).toEqual([]);
    });

    it(`${slug} keeps its slug, title, H1, and meta`, () => {
      const post = postBySlug(slug);
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

  it("ships the batch D replacement sentences", () => {
    const how = postBySlug("how-cs2-trade-ups-work").content;
    expect(how).toContain(
      "Before buying anything, estimate input cost, adjusted float, output probabilities, and marketplace fees. These are estimates after fees. A trade-up can lose money.",
    );
    expect(how).toContain(
      "you have a 70% probability of a Fracture output and a 30% probability of a Prisma output. That weighting is the foundation of every trade-up's expected value.",
    );
    expect(how).toContain(
      "A collection with one expensive skin and four cheap ones is high variance: most outcomes land below cost, and the average depends on one rare result.",
    );

    expect(postBySlug("profitable-trade-ups-theory-vs-reality").content).toContain(
      "Trade-ups with only one possible output remove outcome variance, but not price risk. The output's price can move before you sell, and fees still apply, so even these can lose money.",
    );

    const fees = postBySlug("cs2-trade-up-marketplace-fees");
    expect(fees.content).toContain("For buying inputs, Skinport is cheapest at every price point: $50 costs $50.");
    expect(fees.faq?.some((item) => item.answer.includes("Skinport is cheapest"))).toBe(true);

    const knives = postBySlug("best-cs2-collections-knife-trade-ups-2026").content;
    expect(knives).toContain(
      "which knife or glove pool your 5 Covert inputs can produce, how diluted each output's probability is",
    );
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
