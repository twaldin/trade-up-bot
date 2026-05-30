import { blogPosts } from "../src/data/blog-posts.js";
import { escapeHtml } from "../server/seo.js";
import { STATIC_SEO_PAGES } from "../server/static-seo-pages.js";

export interface ExpectedSeoRoute {
  path: string;
  title: string;
  description: string;
  canonical: string;
}

const BASE_URL = "https://tradeupbot.app";

export function expectedSeoRoutes(): ExpectedSeoRoute[] {
  return [
    {
      path: "/",
      title: "TradeUpBot — Find Profitable CS2 Trade-Ups from Real Listings",
      description: "Real-time CS2 trade-up contract analyzer. Find profitable trade-ups across all rarity tiers using actual marketplace listings from CSFloat, DMarket, and Skinport.",
      canonical: `${BASE_URL}/`,
    },
    ...STATIC_SEO_PAGES.map((page) => ({
      path: page.path,
      title: page.title,
      description: page.description,
      canonical: `${BASE_URL}${page.path}`,
    })),
    {
      path: "/blog",
      title: "Blog — CS2 Trade-Up Guides & Analysis | TradeUpBot",
      description: "Guides and analysis on CS2 trade-up contracts, float mechanics, marketplace strategy, and how to find profitable trade-ups.",
      canonical: `${BASE_URL}/blog`,
    },
    ...blogPosts.map((post) => ({
      path: `/blog/${post.slug}`,
      title: `${post.title} | TradeUpBot Blog`,
      description: post.excerpt,
      canonical: `${BASE_URL}/blog/${post.slug}/`,
    })),
  ];
}

export function expectedSeoRouteForPath(path: string): ExpectedSeoRoute | undefined {
  const normalized = path === "/" ? "/" : path.replace(/\/$/, "");
  return expectedSeoRoutes().find((route) => route.path === normalized);
}

export function normalizePrerenderedHead(html: string, routePath: string): string {
  const expected = expectedSeoRouteForPath(routePath);
  if (!expected) return html;

  let result = html
    .replace(/<title[^>]*>[\s\S]*?<\/title>/gi, "")
    .replace(/<meta\s+name=["']description["'][^>]*\/?\s*>/gi, "")
    .replace(/<link\s+rel=["']canonical["'][^>]*\/?\s*>/gi, "");

  const tags = `<title>${escapeHtml(expected.title)}</title>
<meta name="description" content="${escapeHtml(expected.description)}" />
<link rel="canonical" href="${escapeHtml(expected.canonical)}" />`;

  if (/<\/head>/i.test(result)) {
    result = result.replace(/<\/head>/i, `${tags}\n</head>`);
  }

  return result;
}

export interface SeoHtmlIssue {
  route: string;
  file: string;
  message: string;
}

export function verifySeoHtml(route: ExpectedSeoRoute, file: string, html: string): SeoHtmlIssue[] {
  const issues: SeoHtmlIssue[] = [];
  const titleMatches = Array.from(html.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi));
  const descMatches = Array.from(html.matchAll(/<meta\s+name=["']description["'][^>]*\bcontent=["']([^"']*)["'][^>]*\/?\s*>/gi));
  const canonicalMatches = Array.from(html.matchAll(/<link\s+rel=["']canonical["'][^>]*\bhref=["']([^"']*)["'][^>]*\/?\s*>/gi));

  if (titleMatches.length !== 1) {
    issues.push({ route: route.path, file, message: `expected exactly 1 title, found ${titleMatches.length}` });
  } else if (titleMatches[0][1] !== escapeHtml(route.title)) {
    issues.push({ route: route.path, file, message: `title mismatch: ${titleMatches[0][1]}` });
  }

  if (descMatches.length !== 1) {
    issues.push({ route: route.path, file, message: `expected exactly 1 description, found ${descMatches.length}` });
  } else if (descMatches[0][1] !== escapeHtml(route.description)) {
    issues.push({ route: route.path, file, message: `description mismatch: ${descMatches[0][1]}` });
  }

  if (canonicalMatches.length !== 1) {
    issues.push({ route: route.path, file, message: `expected exactly 1 canonical, found ${canonicalMatches.length}` });
  } else if (canonicalMatches[0][1] !== route.canonical) {
    issues.push({ route: route.path, file, message: `canonical mismatch: ${canonicalMatches[0][1]}` });
  }

  return issues;
}
