/**
 * Gambling-vocabulary gate for blog posts whose copy has been rewritten.
 * Scans visible HTML plus FAQ JSON-LD. Other posts still contain the old
 * wording and are out of scope until their batch lands.
 */
import { describe, expect, it } from "vitest";
import { blogMeta } from "../../src/data/blog-meta.js";
import { blogPosts, type BlogPost } from "../../src/data/blog-posts.js";

const SLUGS = ["cs2-trade-up-probability-expected-value"] as const;

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
  }

  it("keeps the probability guide slug, title, H1, and meta", () => {
    const post = postBySlug("cs2-trade-up-probability-expected-value");
    const meta = blogMeta.find((entry) => entry.slug === post.slug);
    expect(post.slug).toBe("cs2-trade-up-probability-expected-value");
    expect(post.title).toBe("How to Use CS2 Trade-Up Probability and EV Wisely");
    expect(post.h1).toBeUndefined();
    expect(post.excerpt).toBe(
      "Learn how to use CS2 trade-up probability and expected value with a $80 example before choosing risky contracts.",
    );
    expect(meta?.title).toBe(post.title);
    expect(meta?.excerpt).toBe(post.excerpt);
    expect(post.content).toContain('href="/trade-ups"');
    expect(post.content).toContain('href="/calculator"');
    expect(post.content).toContain("<h2>Outcomes Above Cost: The Practical Metric</h2>");
    expect(post.content).toContain("<h2>Risk Profiles: High-Variance vs Low-Variance</h2>");
    expect(post.content).not.toContain("Chance-to-Profit");
    expect(post.content).not.toContain("Lottery");
  });

  it("keeps the $80 walkthrough on engine EV, with probabilities summing to 100%", () => {
    const content = postBySlug("cs2-trade-up-probability-expected-value").content;
    const probs = [0.35, 0.35, 0.3];
    const prices = [120, 40, 200];
    const ev = probs.reduce((sum, probability, index) => sum + probability * prices[index], 0);
    expect(probs.reduce((sum, probability) => sum + probability, 0)).toBeCloseTo(1);
    expect(7 / 10).toBeCloseTo(0.7);
    expect(3 / 10).toBeCloseTo(0.3);
    expect((7 / 10) / 2).toBeCloseTo(0.35);
    expect(ev).toBeCloseTo(116);
    expect(ev - 80).toBeCloseTo(36);
    const aboveCost = probs.reduce(
      (sum, probability, index) => sum + (prices[index] > 80 ? probability : 0),
      0,
    );
    expect(aboveCost).toBeCloseTo(0.65);
    expect(0.9 * 5 + 0.1 * -30).toBeCloseTo(1.5);
    expect(6 * 5).toBe(30);
    expect(0.6 * 15 + 0.4 * -35).toBeCloseTo(-5);
    expect(10 * 80).toBe(800);
    expect(10 * 5).toBe(50);
    expect(1 * 84 - 80).toBe(4);

    expect(content).toContain("EV = sum(probability_i * output_price_i)");
    expect(content).not.toContain("EV = sum(probability_i * output_value_i) - total_input_cost");
    expect(content).toContain("EV = $42 + $14 + $60 = $116");
    expect(content).toContain("Expected P/L = $116 - $80 = +$36");
    expect(content).toContain("Those probabilities sum to 100%.");
    expect(content).toContain("outcomes above cost are 65% (Skin X + Skin Z)");
    expect(content).toContain("This example omits sale fees");
    expect(content).toContain("EV = $84");
    expect(content).toContain("Expected P/L = +$4");
    expect(content).toContain("(0.6 * $15) + (0.4 * -$35) = $9 - $14 = -$5");
    expect(content).not.toMatch(/25\s*%/);
    expect(content).toContain("You set the filter for the share of outcomes above cost.");
    expect(content).not.toMatch(/win_rate|win rate/i);
  });
});
