import { buildCollectionsHubJsonLd, buildHomepageJsonLd } from "../shared/crawler-jsonld.js";
import { detailTradeUpHeading } from "../shared/copy.js";
import { detailTypeLabel } from "../shared/types.js";
export { tradeUpDetailJsonLd } from "../shared/types.js";
import { formatOdds } from "../src/preview/lib/board.js";
import { FOOTER_AGE, FOOTER_NOT_VALVE } from "../src/preview/lib/copy.js";
import { TRADE_UPS_FAQ } from "../shared/trade-ups-faq.js";
import { formatDollars } from "../src/utils/format.js";

export { buildCollectionsHubJsonLd, buildHomepageJsonLd };

interface SeoMeta {
  title: string;
  description: string;
  url: string;
  robots?: string;
  ogImage?: string;
  ogType?: string;
  bodyText?: string;
  /** Raw HTML body content (trusted, server-generated). Takes precedence over bodyText. */
  bodyHtml?: string;
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
  /** Append the shared crawler footer link hub. Opt-in: only low-link pages (static, blog)
   *  set this — high-cardinality pages (/skins hub, collection trade-ups) must NOT, to stay
   *  under the ~100-links-per-page budget. */
  includeFooter?: boolean;
  /** Valve and 18+ lines without the link hub. Used on /trade-ups and /trade-ups/:id. */
  includeLegal?: boolean;
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface SkinResearchInput {
  skinName: string;
  rarity: string;
  minFloat: number;
  maxFloat: number;
  /** Human-ordered condition names this skin can appear in (Factory New → Battle-Scarred). */
  availableConditions: string[];
  /** Cleaned collection name (no "The"/"Collection" affixes), or null if uncollected. */
  collectionDisplay: string | null;
  /** The rarity tier this skin trades up INTO (e.g. Classified → Covert), or null for
   *  terminal items (knives/gloves) that are a trade-up result and never an input. */
  outputTier: string | null;
  inputTuCount: number;
  outputTuCount: number;
  bestProfitCents: number;
}

/**
 * Two data-driven research paragraphs for a /skins/:slug crawler page. Every clause is
 * grounded in this skin's own float range, conditions, rarity, collection, and live
 * trade-up role, so the prose varies materially page-to-page instead of the identical
 * boilerplate that made ~900 skin pages read as near-duplicates to Googlebot.
 */
export function buildSkinResearchParagraphs(i: SkinResearchInput): string {
  const e = escapeHtml;
  const name = e(i.skinName);
  const rarity = e(i.rarity);
  const lo = i.minFloat.toFixed(2);
  const hi = i.maxFloat.toFixed(2);

  const conds = i.availableConditions;
  const condList = conds.length <= 1
    ? (conds[0] ?? "a single")
    : `${conds.slice(0, -1).join(", ")} and ${conds[conds.length - 1]}`;
  const worst = conds[conds.length - 1] ?? "a heavier wear";

  const para1 = conds.length <= 1
    ? `<p>${name} carries a float range of ${lo}–${hi}, so it only appears in ${e(condList)} condition. `
      + `In a trade-up, ten input floats are averaged and normalized to the output's own range, so ${name}'s narrow float band keeps the resulting output condition tightly constrained. `
      + `That predictability is exactly why float, not just the sticker price, matters when using ${name} as an input.</p>`
    : `<p>${name} carries a float range of ${lo}–${hi}, so it can appear in ${e(condList)} conditions. `
      + `In a trade-up, ten input floats are averaged and normalized to the output's own range: an input near ${lo} contributes the cleanest float it can, while one near ${hi} drags the average toward ${e(worst)}. `
      + `That makes float, not just the sticker price, a deciding factor when using ${name} as an input.</p>`;

  const collPhrase = i.collectionDisplay ? ` from the ${e(i.collectionDisplay)} collection` : "";
  const collDraw = i.collectionDisplay ? ` drawn from the ${e(i.collectionDisplay)} collection` : "";
  let para2 = `<p>${name} is a ${rarity} skin${collPhrase}. `;
  // Terminal items (knives/gloves) have no output tier — they are a trade-up result, not an
  // input — so we must not claim they "trade up into" anything.
  para2 += i.outputTier
    ? `Ten ${rarity} inputs${collDraw} trade up into a ${e(i.outputTier)} output, so ${name} sits one tier below the results it helps produce.`
    : `As a top-tier item it is a trade-up result rather than an input, so it appears as the payoff of a contract rather than a feeder into one.`;
  if (i.inputTuCount > 0) {
    para2 += ` At current market prices it appears as an input in ${i.inputTuCount} trade-up${i.inputTuCount !== 1 ? "s" : ""} with positive expected profit`;
    para2 += i.bestProfitCents > 0 ? `, the best worth $${(i.bestProfitCents / 100).toFixed(2)} in expected profit.` : ".";
  }
  if (i.outputTuCount > 0) {
    para2 += ` ${i.outputTuCount} trade-up${i.outputTuCount !== 1 ? "s" : ""} with positive expected profit can produce ${name} as an output.`;
  }
  if (i.inputTuCount === 0 && i.outputTuCount === 0) {
    para2 += i.collectionDisplay
      ? ` No trade-ups with positive expected profit use ${name} at current market prices, but its collection and float profile still shape which contracts become viable as prices move.`
      : ` No trade-ups with positive expected profit use ${name} at current market prices, but its float profile still shapes which contracts become viable as prices move.`;
  }
  para2 += `</p>`;

  return para1 + para2;
}

export function dedupeHead(html: string): string {
  const headMatch = html.match(/<head[^>]*>[\s\S]*?<\/head>/i);
  if (!headMatch || headMatch.index === undefined) return html;

  const fullHead = headMatch[0];
  const openTagMatch = fullHead.match(/^<head[^>]*>/i);
  if (!openTagMatch) return html;

  const openTag = openTagMatch[0];
  const closeTag = "</head>";
  const innerHead = fullHead.slice(openTag.length, fullHead.length - closeTag.length);

  type Match = { start: number; end: number; tag: string; key?: string };
  const remove = new Set<number>();

  const collect = (pattern: RegExp, keyIndex?: number): Match[] => {
    const result: Match[] = [];
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(innerHead)) !== null) {
      result.push({
        start: m.index,
        end: m.index + m[0].length,
        tag: m[0],
        key: keyIndex === undefined ? undefined : (m[keyIndex] || "").toLowerCase(),
      });
    }
    return result;
  };

  const markDuplicates = (matches: Match[], opts?: { byKey?: boolean; dropEmptyTitle?: boolean }) => {
    const grouped = new Map<string, Match[]>();
    if (opts?.byKey) {
      for (const match of matches) {
        const groupKey = match.key || "";
        if (!grouped.has(groupKey)) grouped.set(groupKey, []);
        grouped.get(groupKey)!.push(match);
      }
    } else {
      grouped.set("all", matches);
    }

    for (const group of grouped.values()) {
      const candidates = opts?.dropEmptyTitle
        ? group.filter((entry) => entry.tag.replace(/<\/?title[^>]*>/gi, "").trim().length > 0)
        : group;

      if (opts?.dropEmptyTitle) {
        for (const entry of group) {
          if (entry.tag.replace(/<\/?title[^>]*>/gi, "").trim().length === 0) {
            remove.add(entry.start);
          }
        }
      }

      if (candidates.length <= 1) continue;

      const helmetCandidate = candidates.find((entry) => /\sdata-rh=(['"])true\1/i.test(entry.tag));
      const keep = helmetCandidate || candidates[candidates.length - 1];

      for (const entry of candidates) {
        if (entry.start !== keep.start) remove.add(entry.start);
      }
    }
  };

  const titleMatches = collect(/<title[^>]*>[\s\S]*?<\/title>/gi);
  const descriptionMatches = collect(/<meta\b[^>]*\bname=["']description["'][^>]*\/?\s*>/gi);
  const canonicalMatches = collect(/<link\b[^>]*\brel=["']canonical["'][^>]*\/?\s*>/gi);
  const ogMatches = collect(/<meta\b[^>]*\bproperty=["']og:([^"']+)["'][^>]*\/?\s*>/gi, 1);
  const twitterMatches = collect(/<meta\b[^>]*\bname=["']twitter:([^"']+)["'][^>]*\/?\s*>/gi, 1);

  markDuplicates(titleMatches, { dropEmptyTitle: true });
  markDuplicates(descriptionMatches);
  markDuplicates(canonicalMatches);
  markDuplicates(ogMatches, { byKey: true });
  markDuplicates(twitterMatches, { byKey: true });

  const allMatches = titleMatches.concat(descriptionMatches, canonicalMatches, ogMatches, twitterMatches);
  const ranges = Array.from(remove)
    .map((start) => {
      const tag = allMatches.find((entry) => entry.start === start);
      return tag ? { start: tag.start, end: tag.end } : null;
    })
    .filter((range): range is { start: number; end: number } => !!range)
    .sort((a, b) => a.start - b.start);

  let rebuilt = "";
  let cursor = 0;
  for (const range of ranges) {
    rebuilt += innerHead.slice(cursor, range.start);
    cursor = range.end;
  }
  rebuilt += innerHead.slice(cursor);

  const rebuiltHead = `${openTag}${rebuilt}${closeTag}`;
  return `${html.slice(0, headMatch.index)}${rebuiltHead}${html.slice(headMatch.index + fullHead.length)}`;
}

export function buildSeoHtml(meta: SeoMeta): string {
  const title = escapeHtml(meta.title);
  const desc = escapeHtml(meta.description);
  const robots = meta.robots || "index, follow";
  const ogImage = meta.ogImage || "https://tradeupbot.app/tradeuptable.jpg";
  const ogType = meta.ogType || "website";

  let jsonLdTag = "";
  if (meta.jsonLd) {
    const items = Array.isArray(meta.jsonLd) ? meta.jsonLd : [meta.jsonLd];
    jsonLdTag = items.map(ld => `<script type="application/ld+json">${JSON.stringify(ld)}</script>`).join("\n");
  }

  // bodyHtml = trusted raw HTML; bodyText = escaped plain text fallback
  let bodyContent = "";
  if (meta.bodyHtml) {
    bodyContent = `<main>${meta.bodyHtml}</main>`;
  } else if (meta.bodyText) {
    bodyContent = `<main>${escapeHtml(meta.bodyText)}</main>`;
  }
  if (meta.includeFooter) {
    bodyContent += renderSeoFooter();
  } else if (meta.includeLegal) {
    bodyContent += renderSeoLegal();
  }

  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8" />
<title>${title}</title>
<meta name="description" content="${desc}" />
<meta name="robots" content="${robots}" />
<link rel="canonical" href="${escapeHtml(meta.url)}" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${desc}" />
<meta property="og:url" content="${escapeHtml(meta.url)}" />
<meta property="og:type" content="${escapeHtml(ogType)}" />
<meta property="og:site_name" content="TradeUpBot" />
<meta property="og:image" content="${ogImage}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${title}" />
<meta name="twitter:description" content="${desc}" />
<meta name="twitter:image" content="${ogImage}" />
${jsonLdTag}
</head><body>${bodyContent}</body></html>`;
}

/**
 * HTTP status for a missing trade-up DETAIL (/trade-ups/:id) row.
 * A numeric ID with no row is a trade-up that existed and was deleted/stale-purged — return
 * 410 Gone so Google drops it from the index faster than a bare 404. These IDs only ever come
 * from our own prior sitemap/links. A non-numeric/malformed path was never a valid trade-up — 404.
 * Applies ONLY to the SEO detail route, never the API route or collection landing pages.
 */
export function deletedTradeUpStatus(id: string): 404 | 410 {
  return /^\d+$/.test(id) ? 410 : 404;
}

export interface CollectionHubLink {
  name: string;
  slug: string;
}

const FALLBACK_COLLECTION_HUB_LINKS: CollectionHubLink[] = [
  { name: "Dreams & Nightmares", slug: "dreams-nightmares" },
  { name: "Norse", slug: "norse" },
  { name: "Gallery", slug: "gallery" },
  { name: "Spectrum", slug: "spectrum" },
  { name: "Chroma", slug: "chroma" },
  { name: "Prisma", slug: "prisma" },
  { name: "Clutch", slug: "clutch" },
  { name: "Recoil", slug: "recoil" },
  { name: "Fracture", slug: "fracture" },
  { name: "Gamma", slug: "gamma" },
  { name: "Operation Broken Fang", slug: "operation-broken-fang" },
  { name: "Operation Riptide", slug: "operation-riptide" },
];

// Curated guide links for the shared crawler footer (slugs verified against blog-posts).
const SEO_FOOTER_GUIDES: { slug: string; title: string }[] = [
  { slug: "how-cs2-trade-ups-work", title: "How CS2 Trade-Ups Work" },
  { slug: "profitable-trade-ups-theory-vs-reality", title: "Why Calculators Disagree" },
  { slug: "cs2-trade-up-marketplace-fees", title: "Marketplace Fees Explained" },
  { slug: "best-cs2-collections-knife-trade-ups-2026", title: "Best Knife Collections" },
];

/**
 * Shared crawler-HTML footer link hub. Categorized, descriptive anchors (~16 links) so
 * money/content pages flow equity to the product without exceeding the per-page link budget.
 * Opt-in via SeoMeta.includeFooter — never applied to high-cardinality pages.
 */
/** Valve non-affiliation and 18+ lines. No extra links, so high-cardinality pages can use it. */
export function renderSeoLegal(): string {
  const e = escapeHtml;
  return `<footer>` +
    `<p>${e(FOOTER_NOT_VALVE)} CS2 and Counter-Strike are trademarks of Valve Corporation.</p>` +
    `<p>${e(FOOTER_AGE)}</p>` +
    `</footer>`;
}

export function renderSeoFooter(): string {
  const e = escapeHtml;
  const collLinks = FALLBACK_COLLECTION_HUB_LINKS.slice(0, 6)
    .map((c) => `<li><a href="/collections/${e(c.slug)}">${e(c.name)} trade-ups</a></li>`)
    .join("");
  const guideLinks = SEO_FOOTER_GUIDES
    .map((g) => `<li><a href="/blog/${e(g.slug)}/">${e(g.title)}</a></li>`)
    .join("");
  return `<footer><nav aria-label="Site links">` +
    `<h2>Tools</h2><ul>` +
    `<li><a href="/calculator">CS2 Trade-Up Calculator</a></li>` +
    `<li><a href="/trade-ups">Live CS2 Trade-Ups</a></li>` +
    `<li><a href="/skins">CS2 Skin Prices &amp; Floats</a></li>` +
    `<li><a href="/collections">CS2 Collections</a></li>` +
    `<li><a href="/listing-sniper">Listing Sniper Alerts</a></li></ul>` +
    `<h2>Top Collections</h2><ul>${collLinks}</ul>` +
    `<h2>Guides</h2><ul>${guideLinks}<li><a href="/blog">All CS2 Trade-Up Guides</a></li></ul>` +
    `</nav>` +
    renderSeoLegal().replace("<footer>", "").replace("</footer>", "") +
    `</footer>`;
}

export function renderCollectionsHub(collections: CollectionHubLink[]): string {
  const e = escapeHtml;
  const seen = new Set<string>();
  const popularCollections = [...collections, ...FALLBACK_COLLECTION_HUB_LINKS]
    .filter((collection) => {
      if (seen.has(collection.slug)) return false;
      seen.add(collection.slug);
      return true;
    })
    .slice(0, 12);
  const collectionLinks = popularCollections.map((collection) =>
    `<li><a href="/collections/${e(collection.slug)}">${e(collection.name)}</a></li>`
  ).join("");

  return `<h1>CS2 Skin Collections</h1>
<p>CS2 collections group weapon skins by the case, operation, map, or themed release where those skins entered the game. Each collection contains skins across rarity tiers, and those rarity tiers determine which inputs and outputs can appear in trade-up contracts. When you build a CS2 trade-up, the contract consumes 10 skins of the same rarity tier, then returns one output from the next rarity using the collections represented by your inputs. Browsing collections helps traders compare float ranges, supply, prices, and which cases currently support trade-ups with expected value after fees.</p>
<p>Use this index to research popular CS2 skin collections, inspect their individual skin pages, and move from collection research into the live <a href="/trade-ups">CS2 trade-ups hub</a>.</p>
<h2>Popular CS2 Collections</h2>
<ul>${collectionLinks}</ul>
<p>Trade-ups consume 10 skins from the same collection rarity tier or from a weighted mix of compatible collections, so collection choice directly affects the output pool, expected value, and share of outcomes above cost.</p>`;
}

export interface TradeUpDetailRow {
  id: number;
  type: string;
  total_cost_cents: number;
  profit_cents: number;
  roi_percentage: number;
  chance_to_profit: number;
}

export interface TradeUpInputRow {
  skin_name: string;
  condition: string;
  collection_name: string;
  price_cents?: number;
  source?: string;
}

export interface TradeUpOutcomeRow {
  skin_name: string;
  probability: number;
  predicted_condition: string;
  estimated_price_cents: number;
}

export interface TradeUpRelatedLink {
  label: string;
  url: string;
}

export interface TradeUpsHubTradeUp {
  id: number;
  type: string;
  total_cost_cents: number;
  profit_cents: number;
  roi_percentage: number;
  chance_to_profit: number;
}

export interface TradeUpsHubCollection {
  name: string;
  slug: string;
  count: number;
}

export function renderTradeUpDetail(
  tradeUp: TradeUpDetailRow,
  inputs: TradeUpInputRow[],
  outcomes: TradeUpOutcomeRow[],
  related: TradeUpRelatedLink[],
  opts?: { hideInputCommercials?: boolean },
): string {
  const e = escapeHtml;
  const profit = formatDollars(tradeUp.profit_cents);
  const cost = formatDollars(tradeUp.total_cost_cents);
  const roi = tradeUp.roi_percentage?.toFixed(1) ?? "0";
  const chance = formatOdds(tradeUp.chance_to_profit ?? 0);
const typeLabel = detailTypeLabel(tradeUp.type);
  const hideInputCommercials = opts?.hideInputCommercials === true;
  const heading = detailTradeUpHeading(tradeUp.type);

  const inputRows = inputs.map(inp => {
    const price = !hideInputCommercials && inp.price_cents ? ` — $${(inp.price_cents / 100).toFixed(2)}` : "";
    const source = !hideInputCommercials && inp.source ? ` — ${e(inp.source)}` : "";
    return `<li>${e(inp.skin_name)} (${e(inp.condition)}) — ${e(inp.collection_name)}${price}${source}</li>`;
  }).join("");

  const outcomeRows = outcomes.map(out => {
    const price = (out.estimated_price_cents / 100).toFixed(2);
    return `<li>${e(out.skin_name)} (${e(out.predicted_condition)}) — ${formatOdds(out.probability)} probability — est. $${price}</li>`;
  }).join("");

  const relatedLinks = related.map(r =>
    `<li><a href="${e(r.url)}">${e(r.label)}</a></li>`
  ).join("");

  const collections = [...new Set(inputs.map(i => i.collection_name))];
  const collectionText = collections.length === 1
    ? `all 10 inputs from the ${e(collections[0])} collection`
    : `inputs from ${e(collections.join(", "))}`;

  return `<h1>${e(heading)} — ${e(profit)} Expected P/L (${roi}% ROI)</h1>
<p>Cost ${e(cost)} · ${e(chance)} of outcomes above cost · ${e(typeLabel)} rarity tier. Built from ${collectionText}. Data sourced from real listings on CSFloat, DMarket, and Skinport.</p>

<h2>Inputs</h2>
<p>This trade-up contract uses 10 input skins of the same rarity. The 10 inputs are:</p>
<ul>${inputRows}</ul>

<h2>Outputs</h2>
<p>The output skin is randomly selected from the next rarity tier in the matching collections, weighted proportionally by input count per collection. Possible outputs:</p>
<ul>${outcomeRows || "<li>Output details not available.</li>"}</ul>

<h2>Mechanics</h2>
<p>In CS2, a trade-up contract accepts exactly 10 weapon skins of the same rarity and produces 1 skin of the next higher rarity. The output skin's float value is determined by the <em>adjusted float formula</em>: the average float of all 10 inputs is mapped into the output skin's condition range, producing a predictable wear result.</p>
<p>The output condition depends on where the average input float falls relative to the output skin's min and max float values. Lower-float inputs (closer to 0) tend to produce Factory New or Minimal Wear outputs; higher-float inputs (above 0.45) push toward Field-Tested, Well-Worn, or Battle-Scarred.</p>
<p>Profitability depends on three factors: (1) the cost of 10 inputs at current marketplace prices, (2) the expected value of the output distribution weighted by each skin's market price, and (3) the marketplace fees applied on both the buy and sell sides. This trade-up was calculated using live listing prices with all fees included.</p>

<h2>Related</h2>
<ul>${relatedLinks}</ul>`;
}

export function renderTradeUpsHub(args: {
  total: number;
  profitable: number;
  topTradeUps: TradeUpsHubTradeUp[];
  collections: TradeUpsHubCollection[];
}): string {
  const e = escapeHtml;
  const displayTradeUps = [...args.topTradeUps];
  while (displayTradeUps.length > 0 && displayTradeUps.length < 5) {
    displayTradeUps.push(args.topTradeUps[displayTradeUps.length % args.topTradeUps.length]);
  }
  const tradeRows = displayTradeUps.map((t, index) =>
    `<tr><td><a href="/trade-ups/${t.id}${index >= args.topTradeUps.length ? `?hub_rank=${index + 1}` : ""}">${e(detailTypeLabel(t.type))}</a></td><td>$${(t.total_cost_cents / 100).toFixed(2)}</td><td>$${(t.profit_cents / 100).toFixed(2)}</td><td>${t.roi_percentage?.toFixed(1)}%</td><td>${formatOdds(t.chance_to_profit ?? 0)}</td></tr>`
  ).join("\n");
  const fallbackCollections: TradeUpsHubCollection[] = [
    { name: "Dreams & Nightmares", slug: "dreams-nightmares", count: 0 },
    { name: "Recoil", slug: "recoil", count: 0 },
    { name: "Fracture", slug: "fracture", count: 0 },
    { name: "Prisma", slug: "prisma", count: 0 },
    { name: "Chroma", slug: "chroma", count: 0 },
  ];
  const seen = new Set<string>();
  const collectionLinks = [...args.collections, ...fallbackCollections]
    .filter((collection) => {
      if (seen.has(collection.slug)) return false;
      seen.add(collection.slug);
      return true;
    })
    .slice(0, 8)
    .map((collection) =>
      `<li><a href="/trade-ups/collection/${e(collection.slug)}">${e(collection.name)} trade-ups</a>${collection.count > 0 ? ` (${collection.count})` : ""}</li>`
    ).join("\n");

  return `<nav aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li><li>Trade-Ups</li></ol></nav>
<h1>Live CS2 Trade-Up Contracts from Real Listings</h1>
<p>TradeUpBot discovers executable CS2 trade-up contracts from real listings across CSFloat, DMarket, and Skinport. Every contract on this page links live input skins with exact prices, verified floats, fee-adjusted profit, and the full output probability distribution — so you can evaluate risk before spending a dollar. Use the <a href="/calculator">trade-up calculator</a> to model your own 10-skin setup with custom inputs.</p>
<p>CS2 trade-up contracts are one of the few Counter-Strike 2 skin mechanics where the math can be modeled before you buy. A trade-up contract consumes exactly 10 skins of the same rarity and returns one skin from the next higher rarity. The output skin is random, but the possible output pool is determined by the collections represented by those 10 inputs. If five inputs are from one collection and five are from another, the outcome probabilities are split between those collections' eligible next-rarity skins.</p>
<p>Profitability comes from combining that rarity and collection weighting with real market prices. TradeUpBot tracks ${args.total.toLocaleString()} active contracts, including ${args.profitable.toLocaleString()} with positive expected profit after fees, using buyable listings from CSFloat, DMarket, and Skinport. The system includes input cost, marketplace fees, output probabilities, and the deterministic CS2 float formula. Float matters because the average adjusted float of the 10 input skins maps into each output skin's min and max float range, which can move the result between Factory New, Minimal Wear, Field-Tested, Well-Worn, and Battle-Scarred price bands.</p>
<p>Use this hub to compare live opportunities, research collection-specific output pools, and move from broad trade-up discovery into individual contract details. Start with the <a href="/calculator">CS2 trade-up calculator</a> when you want to test your own 10-skin setup.</p>
<ul>
<li><a href="/blog/how-cs2-trade-ups-work/">Read the guide to how CS2 trade-ups work</a></li>
<li><a href="/blog/cs2-trade-up-calculator-guide/">Read the CS2 trade-up calculator guide</a></li>
</ul>
<h2>Best Live Trade-Ups</h2>
<p>The table below links to individual trade-up detail pages with inputs, output probabilities, expected profit, ROI, share of outcomes above cost, and float-sensitive pricing. Listings can sell quickly, so always verify availability before purchasing all 10 inputs.</p>
<table><thead><tr><th>Type</th><th>Cost</th><th>Expected P/L</th><th>ROI</th><th>Above cost</th></tr></thead><tbody>${tradeRows}</tbody></table>
<h2>Collection Trade-Up Pages</h2>
<p>Collection pages narrow the output pool and show which cases or operations currently have positive-EV contracts. They are useful when you want to understand why a rarity tier shows positive EV or compare similar contracts across collections.</p>
<ul>${collectionLinks}</ul>
<section><h2>Common Questions</h2>
<h3>What makes a CS2 trade-up profitable?</h3><p>A trade-up is profitable when the probability-weighted value of the possible outputs, after selling fees, is higher than the cost of the 10 inputs plus buying fees. Strong contracts usually combine discounted inputs, favorable collection weighting, valuable outputs, and float targets near expensive condition boundaries.</p>
<h3>Why do collection trade-up pages matter?</h3><p>Collections define which output skins are eligible. Linking from this hub to collection trade-up pages lets crawlers and traders follow the same research path: the full trade-up list, collection-specific contracts, then individual pages with exact inputs and outcomes.</p>
${TRADE_UPS_FAQ.map((item) => `<h3>${e(item.q)}</h3><p>${e(item.a)}</p>`).join("")}
<h3>Should I use the calculator before buying inputs?</h3><p>Yes. A calculator helps confirm that the exact 10 input prices and floats still produce the expected output conditions and expected value. Live listings change fast, so the final check should happen immediately before purchase.</p></section>`;
}

const SOCIAL_BOTS = /facebookexternalhit|Twitterbot|Discordbot|Slackbot|LinkedInBot|WhatsApp|TelegramBot|Googlebot|bingbot|Baiduspider|YandexBot/i;

export function isCrawler(userAgent: string): boolean {
  return SOCIAL_BOTS.test(userAgent);
}

/**
 * Inject route-specific meta tags AND server-rendered body content into
 * the SPA index.html template. Preserves JS/CSS bundles so the React app
 * loads normally and replaces the initial body content on mount.
 *
 * The body content prevents Google's soft 404 detection — WRS renders the
 * page with Chrome, and if the API call fails or times out during the
 * render window, React shows an empty state. The server-rendered content
 * ensures Google always sees meaningful page content regardless.
 */
export function injectMetaIntoSpa(html: string, meta: SeoMeta): string {
  const title = escapeHtml(meta.title);
  const desc = escapeHtml(meta.description);
  const url = escapeHtml(meta.url);
  const robots = meta.robots || "index, follow";
  const ogImage = meta.ogImage || "https://tradeupbot.app/tradeuptable.jpg";

  // Strip existing SEO tags (they come from the pre-rendered homepage)
  let result = html
    .replace(/<title>[^<]*<\/title>/g, "")
    .replace(/<meta\s+name="description"[^>]*\/?>/g, "")
    .replace(/<link\s+rel="canonical"[^>]*\/?>/g, "")
    .replace(/<meta\s+property="og:[^"]*"[^>]*\/?>/g, "")
    .replace(/<meta\s+name="twitter:[^"]*"[^>]*\/?>/g, "");

  // Inject correct tags before </head>
  let jsonLdTag = "";
  if (meta.jsonLd) {
    const items = Array.isArray(meta.jsonLd) ? meta.jsonLd : [meta.jsonLd];
    jsonLdTag = items.map((ld) => `\n<script type="application/ld+json">${JSON.stringify(ld)}</script>`).join("");
  }

  const tags = `<title>${title}</title>
<meta name="description" content="${desc}" />
<meta name="robots" content="${robots}" />
<link rel="canonical" href="${url}" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${desc}" />
<meta property="og:url" content="${url}" />
<meta property="og:type" content="website" />
<meta property="og:image" content="${ogImage}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${title}" />
<meta name="twitter:description" content="${desc}" />
<meta name="twitter:image" content="${ogImage}" />${jsonLdTag}`;

  result = result.replace("</head>", tags + "\n</head>");

  // Replace pre-rendered body inside #root with server-rendered content.
  // React's createRoot().render() replaces #root children on mount, so
  // this content is only visible until JS loads (acts as SSR fallback).
  if (meta.bodyHtml) {
    result = result.replace(
      /<div id="root"[^>]*>[\s\S]*?<\/div>\s*(?=<\/body>)/,
      `<div id="root"><main>${meta.bodyHtml}</main></div>`
    );
  } else if (meta.bodyText) {
    result = result.replace(
      /<div id="root"[^>]*>[\s\S]*?<\/div>\s*(?=<\/body>)/,
      `<div id="root"><main><h1>${title}</h1><p>${escapeHtml(meta.bodyText)}</p></main></div>`
    );
  }

  return result;
}

/** Add robots + homepage JSON-LD to prerendered kit HTML when a build omitted them. */
export function ensureHomepageCrawlerHead(html: string): string {
  let result = html;
  if (!/<meta\b[^>]*\bname=["']robots["']/i.test(result)) {
    result = result.replace(/<\/head>/i, `<meta name="robots" content="index, follow" />\n</head>`);
  }
  if (!/application\/ld\+json/i.test(result)) {
    result = result.replace(
      /<\/head>/i,
      `<script type="application/ld+json">${JSON.stringify(buildHomepageJsonLd())}</script>\n</head>`,
    );
  }
  return result;
}
