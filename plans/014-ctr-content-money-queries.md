# Plan 014: Convert existing impressions — titles, descriptions, and content for the money queries

> **Executor instructions**: Follow step by step with verification. STOP conditions binding. Reviewer maintains plans/README.md.
>
> **Drift check (run first)**: `git diff --stat 5fbb497..HEAD -- src/data/ server/static-seo-pages.ts server/index.ts server/seo.ts`
> On drift, compare excerpts; mismatch = STOP.

## Status

- **Priority**: P1 — **Effort**: M — **Risk**: LOW-MED (content/meta changes are reversible; SEO gates protect structure) — **Depends on**: none — **Category**: seo/content
- **Planned at**: commit `5fbb497`, 2026-06-10

## Why this matters

GSC (3 months to 2026-06-10) shows the site EARNING impressions it fails to convert:

- `/blog/cs2-trade-up-marketplace-fees`: **972 impressions at position 9.7, ZERO clicks.** The fee queries it ranks for ("csfloat selling fee percentage" 43 imp @9.7, "csfloat seller fee percentage" 33 @9.6, "...2026" 21 @9.3) want a NUMBER; the title "3 CS2 Marketplace Fees That Can Kill Trade-Up Profit" answers none of them.
- Calculator-intent queries (~500 combined impressions: "trade up calculator" 94 @57.7, "cs2 trade up calculator" 82 @60.9, "trade up simulator" 93 @47.5, "generator/calc" variants ~150 more) all rank 45-65 with zero clicks — `/calculator`'s crawler HTML is 3 thin paragraphs (server/static-seo-pages.ts) and nothing on the site targets "simulator"/"generator" as synonyms.
- `/trade-ups` (the core hub) sits at position 50.9 for the "cs2 trade up" family (443 impressions, 2 clicks).
- Knowledge queries ("what is adjusted float cs2" @9.7, fee queries @9-10) rank page-1 with zero clicks — no FAQ-shaped answers for snippet extraction.

## Current state (verified)

- `src/data/blog-posts.ts:373-378` — fees post: title `3 CS2 Marketplace Fees That Can Kill Trade-Up Profit`, excerpt `Compare CSFloat, DMarket, and Skinport fees from 0% buyer fees to 12% seller cuts. Check fee traps before your next contract.`
- **Sync constraint**: `src/data/blog-meta.ts` mirrors slug/title/excerpt/publishedAt/readTime/author — `tests/unit/blog-meta.test.ts` enforces per-field equality. Every blog-posts.ts metadata edit MUST be mirrored in blog-meta.ts.
- **Fee facts** (from `server/engine/fees.ts` — read it and use ITS numbers, not these from memory): CSFloat buyer 2.8% + $0.30, seller 2%; DMarket buyer 2.5%, seller 2%; Skinport buyer 0%, seller 12%. The post content already documents them.
- `server/static-seo-pages.ts` `/calculator` entry: title `CS2 Trade-Up Calculator — Estimate Profit, EV & Float | TradeUpBot`, 3-paragraph bodyHtml, no FAQ/steps/synonyms.
- `server/index.ts` `/trade-ups` handlers (crawler + non-crawler): title `Profitable CS2 Trade-Ups — Live Contracts from Real Listings | TradeUpBot`; body from `renderTradeUpsHub` (server/seo.ts:341 region).
- Blog posts support an optional `faq` array (check the BlogPost type in blog-posts.ts and how blog-routes.ts renders FAQPage JSON-LD — read both before adding entries).
- Gates that protect you: `npm run build` postbuild runs prerender + `verify-seo-html.ts`; `tests/unit/seo-pages.test.ts`, `internal-cross-linking.test.ts` (reads blog-posts.ts source), `marketing-assets.test.ts`.

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Typecheck / Unit / Build | `npm run typecheck` / `npm run test:unit` / `npm run build` | all green |

Build once before test:unit (dist/ dependency).

## Scope

**In scope**: `src/data/blog-posts.ts` (fees post title/excerpt/faq; float-guide faq; NO slug changes), `src/data/blog-meta.ts` (mirror), `server/static-seo-pages.ts` (/calculator entry), `server/index.ts` (/trade-ups titles/descriptions only), `server/seo.ts` (`renderTradeUpsHub` opening copy + an internal link to /calculator), tests.
**Out of scope**: slugs/URLs (changing the fees post slug would 404 a page-1 ranking — FORBIDDEN), React page components (CalculatorPage.tsx etc.), any non-listed handler, structured-data plumbing in seo.ts beyond what renderers already emit.

## Steps

### Step 1: Fees post — answer the query in the title

In `src/data/blog-posts.ts` (fees post), set:
- title: `CSFloat, DMarket & Skinport Fees (2026) — Exact Buyer & Seller Percentages`
- excerpt: `CSFloat charges 2% seller fee (2.8% + $0.30 buyer). DMarket: 2% seller, 2.5% buyer. Skinport: 12% seller, 0% buyer. Full CS2 marketplace fee breakdown for trade-ups.`
(VERIFY the percentages against `server/engine/fees.ts` first; if they differ, use fees.ts values.) Add 3 `faq` entries (exact-answer style): "What is the CSFloat seller fee?", "What fees does Skinport charge?", "Which CS2 marketplace has the lowest fees for trade-ups?" — one-to-two-sentence numeric answers. Mirror title/excerpt in `blog-meta.ts`.

**Verify**: `npx vitest run tests/unit/blog-meta.test.ts` pass; `npm run build` exit 0 (verify-seo-html + internal-cross-linking constraints hold — if internal-cross-linking asserts the OLD title text, update that expectation preserving intent).

### Step 2: Calculator page — match the query family

In `server/static-seo-pages.ts` `/calculator`: title `Free CS2 Trade-Up Calculator — Profit, Float & EV | TradeUpBot`; description `Free online CS2 trade-up calculator and simulator. Enter 10 skins to calculate profit, expected value, float outcomes, ROI and chance to profit — with live CSFloat, DMarket and Skinport pricing.`; expand bodyHtml with: h2 "What the calculator does" (inputs/outputs), h2 "Calculator, simulator, or generator?" (one paragraph claiming the synonyms), h2 "How to use it" (3-4 numbered steps), h2 FAQ (3 Q/As: fees included? float precision? which collections eligible?). Keep existing internal links; keep HTML in the same single-template-string style.

**Verify**: `npm run build` exit 0; `curl -s -A Googlebot localhost:3001/calculator | grep -c "<h2>"` ≥ 4 after booting the server locally (SKIP_STARTUP_MIGRATIONS=1 ok), or assert via the prerendered dist/calculator/index.html instead (it's a prerendered route — grep the built file).

### Step 3: /trade-ups hub — sharpen title + opening

In `server/index.ts` BOTH /trade-ups handler branches: title `CS2 Trade-Ups — Live Profitable Contracts, Updated Daily | TradeUpBot`; description mentioning live listings + calculator. In `renderTradeUpsHub` (server/seo.ts) add an opening paragraph (TradeUpBot discovers executable trade-ups from real listings across CSFloat/DMarket/Skinport; every contract links live skins with exact prices, floats, fee-adjusted profit) and one `<a href="/calculator">trade-up calculator</a>` link in the body.

**Verify**: `npm run test:unit` (seo source-string tests may quote the old title — update expectations preserving intent); `npm run build` green.

### Step 4: Float-guide FAQ for snippet extraction

Add `faq` entries to `cs2-trade-up-float-values-guide` in blog-posts.ts: "What is float in CS2?" (0.00-1.00 wear number, FN 0.00-0.07 ... ranges), "What is adjusted float in CS2 trade-ups?" (normalized-to-output-range average formula, one sentence + formula). Check how blog-routes.ts renders faq (FAQPage JSON-LD) and that verify-seo-html accepts it.

**Verify**: `npm run build` exit 0; `grep -c FAQPage dist/blog/cs2-trade-up-float-values-guide/index.html` ≥ 1.

### Step 5: Full gate

**Verify**: `npm run typecheck && npm run test:unit && npm run build` all green.

## Done criteria

- [ ] Fees post title/excerpt answer fee-percentage queries; faq present; blog-meta mirror green
- [ ] /calculator prerendered HTML has the new title + ≥4 h2 sections incl. FAQ + simulator/generator coverage
- [ ] /trade-ups title updated in both branches; hub body links /calculator
- [ ] Float guide emits FAQPage JSON-LD with the two new Q/As
- [ ] All gates green; only in-scope files modified; NO slug changed

## STOP conditions

- Any step would change a URL/slug.
- fees.ts numbers contradict the post content itself (not just my excerpt draft) — report the discrepancy, don't guess.
- verify-seo-html fails twice after a content change.

## Maintenance notes

- Titles/excerpts now target specific queries — future edits should check the GSC queries report before rewording.
- Expect CTR effects to show in GSC over 2-6 weeks; re-export and compare (the fees post's 972 impressions are the benchmark).
