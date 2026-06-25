# Plan 022: Funnel conversion — CTAs from blog + money pages into signup & product

> **Executor instructions**: Follow step by step with verification. STOP conditions binding. Reviewer maintains plans/README.md.
>
> **Drift check (run first)**: `git diff --stat 8af4038..HEAD -- src/pages/BlogPostPage.tsx server/blog-routes.ts src/components/ server/static-seo-pages.ts`
> Expected empty. Any drift in these files = compare excerpts before proceeding.

## Status

- **Priority**: P1 (fastest payback, no Google dependency) — **Effort**: M — **Risk**: LOW (additive UI + crawler HTML; SEO gates protect structure) — **Depends on**: none — **Category**: growth/conversion
- **Planned at**: commit `8af4038`, 2026-06-24

## Why this matters

GSC + prod funnel (see `plans/notes/round3-growth-kpis-2026-06-24.md`): our best-ranking page `/blog/best-cs2-collections-knife-trade-ups-2026/` earns **1,647 impressions** but has **0 signup links, 0 calculator links, 1 trade-ups link, and no call-to-action**. Every blog visitor reads and leaves. Organic is ~2 clicks/day and converts ~nobody; 108 total users, 2 paying. The single highest-certainty growth lever is to **convert the traffic we already have** — give every blog post and money page a clear, contextual path into the live product (`/trade-ups`, `/calculator`) and signup (`/auth/steam`). This pays back in days and does not depend on Google re-ranking.

## Current state (verified 2026-06-24)

- `src/pages/BlogPostPage.tsx:90-103` — renders the article via `dangerouslySetInnerHTML={{ __html: post.content }}` inside `<article>`. **No CTA** after the article.
- `server/blog-routes.ts:37` — crawler HTML: `const blogBodyHtml = \`<article><h1>...</h1>${post.content}<p><em>Published ...</em></p></article>\`;`. **No CTA** in crawler HTML either.
- No reusable CTA component exists in `src/components/`.
- `/auth/steam` links elsewhere carry `rel="nofollow"` (plan 012) — Googlebot must NOT crawl auth. Product links (`/trade-ups`, `/calculator`) are normal followed internal links (we WANT equity to flow there).
- Money pages: `src/pages/CalculatorPage.tsx` and `src/pages/TradeUpsPage.tsx` have no inline `/auth/steam` CTA (signin is only in SiteNav). Verify and add a contextual CTA.

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Typecheck / Unit / Build | `npm run typecheck` / `npm run test:unit` / `npm run build` | all green; verify-seo-html passes |

Build once before test:unit (dist/ dependency: internal-cross-linking.test.ts).

## Scope

**In scope**: a new reusable CTA component `src/components/ProductCTA.tsx`; `src/pages/BlogPostPage.tsx` (render the CTA after the article); `server/blog-routes.ts` (append a matching crawler-HTML CTA snippet to `blogBodyHtml`); `src/pages/CalculatorPage.tsx` + `src/pages/TradeUpsPage.tsx` (contextual signup CTA); tests for any source-string assertions touched; one new unit test asserting blog crawler HTML contains the product links.
**Out of scope**: `?ref=` signup attribution (separate plan); auth flow; the blog post `content` strings themselves; pricing logic; any new public content pages (plan 025).

## Steps

### Step 1: Reusable CTA component

Create `src/components/ProductCTA.tsx` exporting `ProductCTA` with an optional `variant` prop (`"blog" | "calculator" | "trade-ups"`). It renders a visually distinct card with: a headline + subtext tuned to the variant, a **followed** primary button → `/trade-ups` (or `/calculator` for the trade-ups variant — cross-link the money pages), a **followed** secondary link → `/calculator` (or `/trade-ups`), and a **`rel="nofollow"`** "Sign in with Steam — free" link → `/auth/steam?return=<contextual>`. Match the existing Tailwind/Geist styling of the app (read an existing component e.g. `src/pages/FeaturesPage.tsx`'s CTA block for class conventions). Keep copy benefit-led and honest (live listings, fee-adjusted profit, free tier).

**Verify**: `npm run typecheck` exit 0.

### Step 2: Render the CTA on blog posts (React)

In `src/pages/BlogPostPage.tsx`, render `<ProductCTA variant="blog" />` immediately after the `<article>` (still inside the page container). Do not alter the article content.

**Verify**: `npm run typecheck` exit 0; `npm run build` exit 0.

### Step 3: Matching CTA in blog crawler HTML

In `server/blog-routes.ts`, append a static HTML CTA snippet to `blogBodyHtml` (after the `<article>`). It MUST contain followed `<a href="/trade-ups">` and `<a href="/calculator">` links (internal equity to money pages) and a `rel="nofollow"` `<a href="/auth/steam">` link. Keep it a plain server-string (no React). This is what flows internal-link equity from high-traffic blog posts to the money pages — the SEO half of the funnel fix.

**Verify**: `npm run build` exit 0; `curl`-free check — add/extend a unit test (Step 5) that imports the blog route handler output or asserts the snippet's presence in source.

### Step 4: Contextual CTA on money pages

Add `<ProductCTA variant="calculator" />` to `src/pages/CalculatorPage.tsx` and `<ProductCTA variant="trade-ups" />` to `src/pages/TradeUpsPage.tsx`, placed where a user who has seen the tool would convert (below the primary tool UI). Verify these pages don't already have a redundant signup CTA; if they do, consolidate rather than duplicate.

**Verify**: `npm run typecheck` + `npm run build` exit 0.

### Step 5: Tests

Add `tests/unit/blog-cta.test.ts` (or extend an existing blog test): assert the blog crawler HTML / `blogBodyHtml` assembly contains `href="/trade-ups"`, `href="/calculator"`, and a `nofollow` auth link, and that `rel="nofollow"` is present on the auth link only. Follow the source-string style of `tests/unit/seo-route-cache.test.ts`. If any existing source-string test (seo-*, internal-cross-linking) quotes lines you changed, update the expectation preserving intent.

**Verify**: `npm run build` then `npm run test:unit` — all green.

### Step 6: Full gate

**Verify**: `npm run typecheck && npm run test:unit && npm run build` all exit 0; verify-seo-html passes for 18 routes.

## Done criteria

- [ ] `ProductCTA` component exists and renders on every blog post (React) and both money pages
- [ ] Blog crawler HTML contains followed `/trade-ups` + `/calculator` links and a nofollow `/auth/steam` link
- [ ] New test asserts the crawler-HTML CTA links + nofollow-on-auth-only
- [ ] `npm run typecheck`, `npm run test:unit`, `npm run build` green; only in-scope files modified
- [ ] No `/auth` link is followed (Googlebot must not crawl auth); no product link is nofollow

## STOP conditions

- The blog crawler HTML path differs from `server/blog-routes.ts:37` (e.g. moved to seo.ts) — map it first; report if ambiguous.
- Adding the CTA breaks verify-seo-html (e.g. an unclosed tag in the crawler snippet) twice — report.

## Maintenance notes

- Conversion is measured by plan "022b" `?ref` attribution (separate) — once both land, organic→signup becomes a real number.
- New blog posts inherit the CTA automatically (component + crawler snippet are central). New money pages should add the matching `ProductCTA` variant.
