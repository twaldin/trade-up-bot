import type { Express } from "express";
import { blogPosts, type BlogPost } from "../src/data/blog-posts.js";
import { buildSeoHtml, escapeHtml, injectMetaIntoSpa, isCrawler } from "./seo.js";

// Blog post metadata/content is sourced from the client blog data so crawler HTML,
// client-rendered posts, and server meta stay in sync.
const BLOG_POST_META: Record<string, BlogPost> = Object.fromEntries(
  blogPosts.map((post) => [post.slug, post]),
);

// Retired blog slugs 301'd to their canonical replacement (cannibalization consolidation).
// Registered BEFORE the generic handlers so the removed slug 301s instead of 404ing.
const RETIRED_BLOG_REDIRECTS: Record<string, string> = {
  "how-do-cs2-trade-ups-work": "how-cs2-trade-ups-work",
};

export function registerBlogRoutes(app: Express, indexHtml: string): void {
  // Retired-slug 301s (both slash forms) -> the canonical post's trailing-slash URL.
  app.get(/^\/blog\/([^/]+)\/?$/, (req, res, next) => {
    const target = RETIRED_BLOG_REDIRECTS[req.params[0]];
    if (!target) return next();
    res.redirect(301, `/blog/${target}/`);
  });

  // Canonical blog post URLs always include a trailing slash. Use regex
  // routes so Express' default non-strict routing cannot serve both forms.
  app.get(/^\/blog\/([^/]+)$/, (req, res) => {
    const slug = req.params[0];
    const post = BLOG_POST_META[slug];
    if (!post) {
      res.status(404).send("Blog post not found");
      return;
    }
    res.redirect(301, `/blog/${slug}/`);
  });

  app.get(/^\/blog\/([^/]+)\/$/, (req, res) => {
    const slug = req.params[0];
    const post = BLOG_POST_META[slug];
    if (!post) {
      res.status(404).send("Blog post not found");
      return;
    }
    const ua = req.headers["user-agent"] || "";
    const title = `${post.title} | TradeUpBot`;
    // Trailing slash matches the URL the server actually serves content
    // at; without it the canonical points at the redirected (non-trailing)
    // form and Google sees a redirect loop on the canonical chain (#95).
    const url = `https://tradeupbot.app/blog/${slug}/`;
    const ctaHtml = `<div style="margin-top:2rem;padding:1.5rem;border:1px solid #333;border-radius:0.75rem">` +
      `<h2 style="margin:0 0 0.5rem">See live profitable trade-ups right now</h2>` +
      `<p style="margin:0 0 1rem;color:#aaa">TradeUpBot scans CSFloat, DMarket, and Skinport continuously. ` +
      `Every trade-up is built from real, buyable listings — fee-adjusted profit shown upfront. Free tier available.</p>` +
      `<a href="/trade-ups">Browse trade-ups</a> &nbsp;&middot;&nbsp; ` +
      `<a href="/calculator">Try the calculator</a> &nbsp;&middot;&nbsp; ` +
      `<a href="/auth/steam" rel="nofollow">Sign in with Steam — free</a>` +
      `</div>`;
    const blogBodyHtml = `<article><h1>${escapeHtml(post.title)}</h1>${post.content}<p><em>Published ${escapeHtml(post.publishedAt)} by ${escapeHtml(post.author)}.</em></p></article>${ctaHtml}`;
    res.setHeader("Content-Type", "text/html");
    if (isCrawler(String(ua))) {
      res.send(buildSeoHtml({
        title,
        description: post.excerpt,
        url,
        bodyHtml: blogBodyHtml,
        ogType: "article",
        includeFooter: true,
        jsonLd: [
          {
            "@context": "https://schema.org",
            "@type": "BlogPosting",
            headline: post.title,
            description: post.excerpt,
            datePublished: post.publishedAt,
            author: { "@type": "Organization", name: post.author },
            publisher: { "@type": "Organization", name: "TradeUpBot", url: "https://tradeupbot.app" },
            mainEntityOfPage: url,
          },
          ...(post.faq ? [{
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: post.faq.map((item) => ({
              "@type": "Question",
              name: item.question,
              acceptedAnswer: { "@type": "Answer", text: item.answer },
            })),
          }] : []),
        ],
      }));
    } else {
      res.send(injectMetaIntoSpa(indexHtml, { title, description: post.excerpt, url, bodyHtml: blogBodyHtml }));
    }
  });
}
