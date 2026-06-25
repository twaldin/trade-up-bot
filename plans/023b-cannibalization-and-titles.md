# Plan 023b: Resolve keyword cannibalization + trim over-length titles

> **Executor instructions**: Follow step by step with verification. STOP conditions binding. Reviewer maintains plans/README.md.
>
> **Drift check (run first)**: `git diff --stat 8cd6d32..HEAD -- src/data/blog-posts.ts src/data/blog-meta.ts server/blog-routes.ts server/canonical-redirects.ts server/index.ts server/static-seo-pages.ts`

## Status
- **Priority**: P1 — **Effort**: M — **Risk**: MED (301s on indexed URLs; do carefully) — **Depends on**: none — **Category**: seo/onpage
- **Planned at**: commit `8cd6d32`, 2026-06-24

## Why this matters
Audit (`plans/notes/seo-audit-report-2026-06-24.md`): **keyword cannibalization** splits ranking signal.
1. `how-cs2-trade-ups-work` AND `how-do-cs2-trade-ups-work` — two blog posts, one intent ("how (do) cs2 trade ups work").
2. `best-cs2-trade-up-simulator` (1,357 impr @55) AND `cs2-trade-up-calculator-guide` both target "calculator/simulator" intent and **outrank the actual `/calculator` page** (176 impr @60) — a blog post is eating the money page's term.
Plus **titles run 66–75 chars** (truncated in SERP at ~60), weakening CTR; the "| TradeUpBot Blog" suffix wastes budget.

## Current state (verify before editing)
- Blog posts: `src/data/blog-posts.ts` (content + `faq`), mirrored in `src/data/blog-meta.ts` (`tests/unit/blog-meta.test.ts` enforces per-field equality). Slugs in both.
- No-slash→slash 301 + canonical handled (server/blog-routes.ts + canonical-redirects.ts). For NEW 301s (post→post), add to `server/canonical-redirects.ts` (or blog-routes) following the existing redirect registration pattern — read it first.
- GSC impressions (decide winner by data): `how-cs2-trade-ups-work` (898+173) vs `how-do-cs2-trade-ups-work` (lower); `best-cs2-trade-up-simulator` 1,357 — KEEP as a supporting asset but re-point its intent toward /calculator.
- Titles set in blog-posts.ts (blog) and in server/index.ts / static-seo-pages.ts (money pages).

## Commands
`npm run typecheck` / `npm run test:unit` / `npm run build` green; build before test:unit.

## Scope
**In scope**: `src/data/blog-posts.ts` + `src/data/blog-meta.ts` (consolidate/merge content, title trims, internal links — NO slug changes except the one being retired), `server/canonical-redirects.ts` or `server/blog-routes.ts` (register the post→post 301), `server/index.ts` + `server/static-seo-pages.ts` (money-page title trims), tests.
**Out of scope**: schema (023), the live trade-ups/calculator app logic, creating new posts.

## Steps
### Step 1: Consolidate the duplicate "how it works" posts
Pick the winner by GSC impressions (likely `how-cs2-trade-ups-work`). Merge any unique value from the loser into the winner's content. **301 the loser slug → the winner** (register in canonical-redirects.ts following its pattern). Remove the loser from blog-posts.ts + blog-meta.ts + the prerender ROUTES (scripts/prerender.ts) + sitemap (it's generated from posts, so removing the post drops it). Ensure no internal links point to the retired slug (grep).
**Verify**: `curl -sI https://… /blog/<loser>/` would 301 (post-deploy); locally `npm run build` green, retired slug absent from dist/sitemap; blog-meta test green.

### Step 2: Re-point simulator/calculator-guide posts toward /calculator
Do NOT delete `best-cs2-trade-up-simulator` (1,357 impr is real). Instead: (a) add a prominent internal link + CTA from both posts to `/calculator` as the canonical tool, (b) differentiate their angles so they support rather than compete (e.g. the simulator post = "how to verify a trade-up live", linking to the tool; the calculator-guide = conceptual guide linking to the tool), (c) ensure the `/calculator` page title/H1 owns "calculator" + "simulator" terms (it does: "Free CS2 Trade-Up Calculator…"). If `cs2-trade-up-calculator-guide` is fully redundant with /calculator, consider 301'ing it to /calculator instead — decide by whether it has unique educational content worth keeping.
**Verify**: both posts link to /calculator; build green.

### Step 3: Trim over-length titles (≤60 chars)
Shorten so the SERP-visible portion leads with the keyword:
- Blog suffix `| TradeUpBot Blog` → `| TradeUpBot` (saves 5 chars); trim each blog title ≤60.
- `/trade-ups` (69) and `/calculator` (66) → ≤60, keyword-first, keep brand at end. Mirror any blog title change in blog-meta.ts.
Source-string tests (seo-*, blog-meta) quote titles — update expectations preserving intent.
**Verify**: re-run the title-length check (all ≤60); `npm run test:unit` green.

### Step 4: Full gate
`npm run typecheck && npm run test:unit && npm run build` green.

## Done criteria
- [ ] One "how it works" post remains; the other 301s to it; no internal links to the retired slug; not in sitemap
- [ ] simulator/calculator-guide posts link to /calculator and no longer compete for the head term (or 301 if redundant)
- [ ] All audited titles ≤60 chars, keyword-first, `| TradeUpBot` suffix
- [ ] blog-meta parity + all source-string tests green; typecheck/build green; only in-scope files modified

## STOP conditions
- A retired slug has meaningful inbound backlinks (check GSC Links if available) — still 301 (preserves equity) but note it; never 404 it.
- A 301 would create a redirect chain (no-slash→slash→other-post). Register the 301 to the FINAL canonical (slash form of winner) to avoid chains.

## Maintenance notes
- After deploy: in GSC, request indexing on the winner; the retired URL drains from the index over weeks.
- One canonical page per intent going forward — check existing posts before adding a new one targeting a nearby query.

## MUST-FIX before executing (codex adversarial review, 2026-06-24)
1. **Sitemap claim is FALSE** — blog slugs are HARDCODED in `BLOG_SLUGS` (`server/routes/sitemap.ts:8,17-19`, emitted at `:62-65`), NOT generated from posts. Removing a post does NOT drop it from the sitemap. **Add `server/routes/sitemap.ts` + `tests/unit/sitemap.test.ts:27-30` (expects the loser slug) to scope** and remove the retired slug there.
2. **Redirect will 404 as written** — `server/blog-routes.ts:14-30` 404s unknown slugs BEFORE redirecting; `canonical-redirects.ts` has no post→post pattern. Removing the loser from `blogPosts` makes both `/blog/<loser>` and `/blog/<loser>/` 404. **Add explicit retired-slug 301 routes in `blog-routes.ts` BEFORE the metadata lookup** (handle both slash forms; point to the winner's slash URL to avoid chains).
3. **Title suffix is appended in code, not data** — `| TradeUpBot Blog` is added in `server/blog-routes.ts:32`, `src/pages/BlogPostPage.tsx:50-53`, `scripts/seo-html.ts:34-37` (+ `tests/unit/seo-html-verify.test.ts:21-24`). Editing blog-posts.ts titles alone won't shorten SERP titles. **Add those files + tests to scope.**
4. **/calculator parity** — client title is `CS2 Trade-Up Calculator — Float & Profit Calculator | TradeUpBot`, H1 just `CS2 Trade-Up Calculator` (`CalculatorPage.tsx:386-406`); static/crawler title is separate (`static-seo-pages.ts:10-13`). Add `src/pages/CalculatorPage.tsx` to scope if aligning client metadata.
5. **Prerender** — `scripts/prerender.ts:15-21` derives ROUTES from `blogPosts.map`; there's no explicit loser entry. Reframe Step 1 as "verify the slug drops from dist after removing it from blogPosts," not "remove from ROUTES."
6. **Preserve fee constants** when merging "how it works" content — fees.ts is source of truth (CSFloat 2%/2.8%+$0.30, DMarket 2%/2.5%, Skinport 8%/0%, Buff 2.5%/3.5%+$0.15); existing blog copy has fee passages (`blog-posts.ts:75,124-136`).
