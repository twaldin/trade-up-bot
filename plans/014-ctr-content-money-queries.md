# Plan 014: Convert existing impressions — titles, descriptions, and content for the money queries

> **Executor instructions**: Follow step by step with verification. STOP conditions binding. Reviewer maintains plans/README.md.
>
> **Drift check (run first)**: `git diff --stat 5fbb497..HEAD -- src/data/ server/static-seo-pages.ts server/index.ts server/seo.ts`
> On drift, compare excerpts; mismatch = STOP.

## Status

- **Priority**: P1 — **Effort**: M — **Risk**: LOW-MED (content/meta changes are reversible; SEO gates protect structure) — **Depends on**: none — **Category**: seo/content
- **Planned at**: commit `5fbb497`, 2026-06-10
- **Revised**: 2026-06-10 after executor STOP — `server/engine/fees.ts` declares Skinport sellerFee `0.08` ("8% seller fee (reduced from 12%, July 2025)") while blog content says 12% in nine places across three posts. fees.ts is authoritative (it drives production profit math). Step 1a added: correct every 12%-Skinport reference and recompute dependent examples. All excerpt/FAQ drafts below updated to 8%.

## Why this matters

GSC (3 months to 2026-06-10) shows the site EARNING impressions it fails to convert:

- `/blog/cs2-trade-up-marketplace-fees`: **972 impressions at position 9.7, ZERO clicks.** The fee queries it ranks for ("csfloat selling fee percentage" 43 imp @9.7, "csfloat seller fee percentage" 33 @9.6, "...2026" 21 @9.3) want a NUMBER; the title "3 CS2 Marketplace Fees That Can Kill Trade-Up Profit" answers none of them.
- Calculator-intent queries (~500 combined impressions: "trade up calculator" 94 @57.7, "cs2 trade up calculator" 82 @60.9, "trade up simulator" 93 @47.5, "generator/calc" variants ~150 more) all rank 45-65 with zero clicks — `/calculator`'s crawler HTML is 3 thin paragraphs (server/static-seo-pages.ts) and nothing on the site targets "simulator"/"generator" as synonyms.
- `/trade-ups` (the core hub) sits at position 50.9 for the "cs2 trade up" family (443 impressions, 2 clicks).
- Knowledge queries ("what is adjusted float cs2" @9.7, fee queries @9-10) rank page-1 with zero clicks — no FAQ-shaped answers for snippet extraction.

## Current state (verified)

- `src/data/blog-posts.ts:373-378` — fees post: title `3 CS2 Marketplace Fees That Can Kill Trade-Up Profit`, excerpt `Compare CSFloat, DMarket, and Skinport fees from 0% buyer fees to 12% seller cuts. Check fee traps before your next contract.`
- **Sync constraint**: `src/data/blog-meta.ts` mirrors slug/title/excerpt/publishedAt/readTime/author — `tests/unit/blog-meta.test.ts` enforces per-field equality. Every blog-posts.ts metadata edit MUST be mirrored in blog-meta.ts.
- **Fee facts** (from `server/engine/fees.ts` — read it and use ITS numbers, not these from memory): CSFloat buyer 2.8% + $0.30, seller 2%; DMarket buyer 2.5%, seller 2%; Skinport buyer 0%, seller **8%** (fees.ts:11, "reduced from 12%, July 2025"). The post content still documents the OLD 12% rate — Step 1a fixes that.
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

**In scope**: `src/data/blog-posts.ts` (fees post title/excerpt/faq; float-guide faq; Skinport fee corrections in ANY post body per Step 1a; NO slug changes), `src/data/blog-meta.ts` (mirror), `server/static-seo-pages.ts` (/calculator entry), `server/index.ts` (/trade-ups titles/descriptions only), `server/seo.ts` (`renderTradeUpsHub` opening copy + an internal link to /calculator), tests.
**Out of scope**: slugs/URLs (changing the fees post slug would 404 a page-1 ranking — FORBIDDEN), React page components (CalculatorPage.tsx etc.), any non-listed handler, structured-data plumbing in seo.ts beyond what renderers already emit.

## Steps

### Step 1a: Correct the stale Skinport seller fee (12% → 8%) everywhere in blog content

`server/engine/fees.ts:11` is authoritative: Skinport seller fee is **8%** (comment: "reduced from 12%, July 2025"). The blog content predates the cut. In `src/data/blog-posts.ts`, fix every Skinport-12% reference and recompute the numeric examples that depend on it (verified sites as of revision; re-grep `12%` to catch all):

- ~line 75 (mistakes post): "Skinport takes 12% from sellers" → 8%.
- ~line 133 (fee list in another post): "Skinport: 12% seller fee" → "Skinport: 8% seller fee".
- Fees post body (~lines 391-449): "0% to buyers and 12% to sellers" → 8%; "$100 output nets you only $88 after the 12% seller fee" → "$92 after the 8% seller fee"; "Skinport takes 12% — that same output nets you $88. The difference is $10" → "takes 8% — nets you $92. The difference is $6"; the breakeven example "$95 * 0.88 = $83.60. Profit: $83.60 - $83.31 = $0.29. Essentially breakeven." → "$95 * 0.92 = $87.40. Profit: $87.40 - $83.31 = $4.09." (rewrite the surrounding sentence: the fee no longer erases the profit, it cuts it by more than half vs CSFloat's $9.79 — preserve the section's point that seller-side fees change the outcome materially); arbitrage section "losing 12%" → "losing 8%"; existing FAQ answer "Skinport takes 12% from sellers" → 8%.
- Optionally add one parenthetical "(reduced from 12% in July 2025)" at the first fees-post mention — it matches the "...2026" query family's freshness intent.

Recompute ALL arithmetic you touch by hand; every dollar figure must follow from the stated percentages.

**Verify**: `grep -n "12%" src/data/blog-posts.ts` → only hits (if any) are explicitly historical ("reduced from 12%"); `npm run typecheck` exit 0.

### Step 1: Fees post — answer the query in the title

In `src/data/blog-posts.ts` (fees post), set:
- title: `CSFloat, DMarket & Skinport Fees (2026) — Exact Buyer & Seller Percentages`
- excerpt: `CSFloat charges 2% seller fee (2.8% + $0.30 buyer). DMarket: 2% seller, 2.5% buyer. Skinport: 8% seller, 0% buyer. Full CS2 marketplace fee breakdown for trade-ups.`
(VERIFY the percentages against `server/engine/fees.ts` first; if they differ, use fees.ts values.) Add 3 `faq` entries (exact-answer style): "What is the CSFloat seller fee?", "What fees does Skinport charge?", "Which CS2 marketplace has the lowest fees for trade-ups?" — one-to-two-sentence numeric answers using the 8% Skinport rate. Mirror title/excerpt in `blog-meta.ts`.

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

- [ ] No non-historical "12%" Skinport references remain in blog-posts.ts; recomputed examples are arithmetically correct
- [ ] Fees post title/excerpt answer fee-percentage queries with fees.ts numbers (Skinport 8%); faq present; blog-meta mirror green
- [ ] /calculator prerendered HTML has the new title + ≥4 h2 sections incl. FAQ + simulator/generator coverage
- [ ] /trade-ups title updated in both branches; hub body links /calculator
- [ ] Float guide emits FAQPage JSON-LD with the two new Q/As
- [ ] All gates green; only in-scope files modified; NO slug changed

## STOP conditions

- Any step would change a URL/slug.
- fees.ts numbers differ from THIS REVISED plan's figures (CSFloat 2% seller / 2.8%+$0.30 buyer; DMarket 2% seller / 2.5% buyer; Skinport 8% seller / 0% buyer; the 12%→8% discrepancy is already known and resolved by Step 1a) — report, don't guess.
- verify-seo-html fails twice after a content change.

## Maintenance notes

- Titles/excerpts now target specific queries — future edits should check the GSC queries report before rewording.
- Expect CTR effects to show in GSC over 2-6 weeks; re-export and compare (the fees post's 972 impressions are the benchmark).
