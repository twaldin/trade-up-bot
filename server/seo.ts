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
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
<p>CS2 collections group weapon skins by the case, operation, map, or themed release where those skins entered the game. Each collection contains skins across rarity tiers, and those rarity tiers determine which inputs and outputs can appear in trade-up contracts. When you build a CS2 trade-up, the contract consumes 10 skins of the same rarity tier, then rolls one output from the next rarity using the collections represented by your inputs. Browsing collections helps traders compare float ranges, supply, prices, and which cases currently support profitable trade-up opportunities.</p>
<p>Use this index to research popular CS2 skin collections, inspect their individual skin pages, and move from collection research into the live <a href="/trade-ups">CS2 trade-ups hub</a>.</p>
<h2>Popular CS2 Collections</h2>
<ul>${collectionLinks}</ul>
<p>Trade-ups consume 10 skins from the same collection rarity tier or from a weighted mix of compatible collections, so collection choice directly affects the output pool, expected value, and chance to profit.</p>`;
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

const TRADE_UP_TYPE_DISPLAY: Record<string, string> = {
  covert_knife: "Knife/Glove",
  classified_covert: "Classified",
  restricted_classified: "Restricted",
  milspec_restricted: "Mil-Spec",
  industrial_milspec: "Industrial Grade",
  consumer_industrial: "Consumer Grade",
};

export function renderTradeUpDetail(
  tradeUp: TradeUpDetailRow,
  inputs: TradeUpInputRow[],
  outcomes: TradeUpOutcomeRow[],
  related: TradeUpRelatedLink[]
): string {
  const e = escapeHtml;
  const profit = (tradeUp.profit_cents / 100).toFixed(2);
  const cost = (tradeUp.total_cost_cents / 100).toFixed(2);
  const roi = tradeUp.roi_percentage?.toFixed(1) ?? "0";
  const chance = Math.round((tradeUp.chance_to_profit ?? 0) * 100);
  const typeLabel = TRADE_UP_TYPE_DISPLAY[tradeUp.type] || tradeUp.type;

  const inputRows = inputs.map(inp =>
    `<li>${e(inp.skin_name)} (${e(inp.condition)}) — ${e(inp.collection_name)}${inp.price_cents ? ` — $${(inp.price_cents / 100).toFixed(2)}` : ""}</li>`
  ).join("");

  const outcomeRows = outcomes.map(out => {
    const pct = Math.round(out.probability * 100);
    const price = (out.estimated_price_cents / 100).toFixed(2);
    return `<li>${e(out.skin_name)} (${e(out.predicted_condition)}) — ${pct}% chance — est. $${price}</li>`;
  }).join("");

  const relatedLinks = related.map(r =>
    `<li><a href="${e(r.url)}">${e(r.label)}</a></li>`
  ).join("");

  const collections = [...new Set(inputs.map(i => i.collection_name))];
  const collectionText = collections.length === 1
    ? `all 10 inputs from the ${e(collections[0])} collection`
    : `inputs from ${e(collections.join(", "))}`;

  return `<h1>${e(typeLabel)} Trade-Up — $${profit} Profit (${roi}% ROI)</h1>
<p>Cost $${cost} · ${chance}% chance to profit · ${e(typeLabel)} rarity tier. Built from ${collectionText}. Data sourced from real listings on CSFloat, DMarket, and Skinport.</p>

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
    jsonLdTag = `\n<script type="application/ld+json">${JSON.stringify(meta.jsonLd)}</script>`;
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
