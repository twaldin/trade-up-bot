interface SeoMeta {
  title: string;
  description: string;
  url: string;
  robots?: string;
  ogImage?: string;
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
      const keep = helmetCandidate || candidates[0];

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
  const ogImage = meta.ogImage || "https://tradeupbot.app/tradeuptable.png";

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
<meta property="og:type" content="website" />
<meta property="og:site_name" content="TradeUpBot" />
<meta property="og:image" content="${ogImage}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${title}" />
<meta name="twitter:description" content="${desc}" />
<meta name="twitter:image" content="${ogImage}" />
${jsonLdTag}
</head><body>${bodyContent}</body></html>`;
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
  const ogImage = meta.ogImage || "https://tradeupbot.app/tradeuptable.png";

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
  if (meta.bodyText) {
    result = result.replace(
      /<div id="root"[^>]*>[\s\S]*?<\/div>\s*(?=<\/body>)/,
      `<div id="root"><main><h1>${title}</h1><p>${escapeHtml(meta.bodyText)}</p></main></div>`
    );
  }

  return result;
}
