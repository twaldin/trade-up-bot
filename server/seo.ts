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
 * Inject route-specific meta tags into the SPA index.html template.
 * Preserves the React JS/CSS bundles so the app loads normally,
 * but replaces title, description, canonical, and OG tags.
 */
export function injectMetaIntoSpa(html: string, meta: Omit<SeoMeta, "bodyText" | "jsonLd">): string {
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
<meta name="twitter:image" content="${ogImage}" />`;

  result = result.replace("</head>", tags + "\n</head>");
  return result;
}
