interface SeoMeta {
  title: string;
  description: string;
  url: string;
  robots?: string;
  ogImage?: string;
  bodyText?: string;
  jsonLd?: Record<string, unknown>;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildSeoHtml(meta: SeoMeta): string {
  const title = escapeHtml(meta.title);
  const desc = escapeHtml(meta.description);
  const robots = meta.robots || "index, follow";
  const ogImage = meta.ogImage || "https://tradeupbot.app/tradeuptable.png";

  let jsonLdTag = "";
  if (meta.jsonLd) {
    jsonLdTag = `<script type="application/ld+json">${JSON.stringify(meta.jsonLd)}</script>`;
  }

  return `<!DOCTYPE html><html><head>
<title>${title}</title>
<meta name="description" content="${desc}" />
<meta name="robots" content="${robots}" />
<link rel="canonical" href="${escapeHtml(meta.url)}" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${desc}" />
<meta property="og:url" content="${escapeHtml(meta.url)}" />
<meta property="og:type" content="website" />
<meta property="og:image" content="${ogImage}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${title}" />
<meta name="twitter:description" content="${desc}" />
<meta name="twitter:image" content="${ogImage}" />
${jsonLdTag}
</head><body>${meta.bodyText ? `<main>${escapeHtml(meta.bodyText)}</main>` : ""}</body></html>`;
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
