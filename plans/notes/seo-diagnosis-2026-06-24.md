# SEO Diagnosis — why no movement after batch 2 (2026-06-24)

Inputs: GSC Performance export (Mar 23–Jun 22), GSC Coverage export (data ends **Jun 11**), live Googlebot curls of tradeupbot.app, competitive curls + SERP checks. Batch-2 SEO (plans 012–014) deployed **Jun 10–11**.

## TL;DR

We have not "gotten worse at the important queries" — three things are true at once:

1. **It is genuinely too early to read the data.** Batch-2 deployed Jun 10–11. The Coverage export's chart *stops Jun 11*, so it contains **zero** post-fix days. The Performance window is "last 3 months," ~92% of which is the pre-fix state. Google takes 4–12 weeks to re-rank and consolidate. Judging batch 2 on Jun 24 is reading a photo taken before the work landed.
2. **The money queries are owned by domains we cannot out-rank with title tags.** SERP for "cs2 trade up calculator" / "cs2 trade up simulator" = csfloat.com, pricempire.com, steamanalyst.com (marketplace giants, DA ~50–70) + exact-match domains (cstradeupsimulator.com, casecalculator.app, tradeuplab.com, csskinlab.com). tradeupbot.app is **not in the top 10**. This is an authority + on-page-depth gap, not a metadata gap.
3. **Our actual money page is a thin stub.** `/calculator` crawler HTML = **553 words, 2 internal links, 0 JSON-LD**. The ranking competitor steamanalyst.com/tradeup-calculator on the identical H1 = **~3,000 words, 80+ internal links, 8-question FAQ, collections grid, schema-ready**. We give Google almost nothing to rank.

## Question 1 — "still not top of important queries"

Position deltas, Jun-10 export → Jun-24 export (all essentially flat or noise):

| Query | Impr | Position Jun-10 | Position Jun-24 | CTR |
|---|---|---|---|---|
| cs2 trade up calculator | 176 | ~60.9 | **59.81** | 0.57% |
| trade up calculator | 165 | — | 58.98 | 0% |
| trade up simulator | 156 | ~47.5 | 47.51 | 0% |
| csfloat selling fee percentage | 43 | ~9.7 | **10.23** | 0% |
| csfloat seller fee percentage | 33 | ~9.6 | 9.58 | 0% |
| what is adjusted float cs2 | 30 | ~9.7 | 9.37 | 0% |
| what is float in cs2 | 64 | — | 86.14 | 0% |

Only **branded** terms convert (tradeupbot 56% CTR @4.5; "trade up bot" @1.1; tradeupbot.app @1.0). Every generic money term is page 5–9 (calculators) or page-1-but-zero-CTR (fees/float knowledge terms).

**Why title changes didn't move position:**
- Calculator family @ position ~60 = page 6. Titles change *CTR at a given position*; they do not move you 50 positions up. That requires authority + on-page depth + internal links — none of which batch 2 touched.
- Fees/float terms are page-1 (pos ~9–10) with 0% CTR. Here the batch-2 retitle *should* help CTR, but (a) only 13 days old and Google may not have refreshed the displayed snippet, and (b) for a 30–60 impression/month term, a CTR lift is a rounding error in clicks.
- **Signal splitting (now fixed at source, not yet consolidated):** the fees post is indexed at BOTH `/blog/cs2-trade-up-marketplace-fees` (965 impr, pos 9.74) and `…/` slash (55 impr, pos 12.53). The homepage is indexed as `tradeupbot.app`, `www.tradeupbot.app`, AND `http://www.…` — three separate rows. Each blog post's ranking power is split across 2 URLs; the homepage across 3 hosts. Live curls confirm the **redirects + canonicals are now correct** (www→apex 301, http→https 301, no-slash→slash 301, self-referential slash canonicals, slash-form sitemap) — so this is *historical* index cruft that Google will consolidate slowly. It inflates the impression counts on duplicate rows and depresses the apparent position of the canonical.

## Question 2 — "unindexed pages increased"

Not-indexed climbed 547 (late May) → **651** (Jun 8–11). Composition (Jun-24 coverage export):

| Reason | Pages | Note |
|---|---|---|
| Crawled - currently not indexed | **257** (was 202) | Thin programmatic skin/collection pages Google crawled and *declined*. Largely by-design for ~2,000 near-identical auto-pages. |
| Not found (404) | **141** (was 103) | Churn: stale trade-ups deleted by the daemon → their detail URLs 404; skin pages dropping below listing thresholds. |
| Alternate page w/ proper canonical | 114 | **Benign** — correctly-canonicalized duplicates. Not an error despite the "critical" label. |
| Blocked by robots.txt | 88 (was 85) | /auth/ /api/ links Google still has queued (batch-2 nofollow'd them; drains slowly). |
| Server error 5xx | 28 | Pre-dates perf work; expected to drain. |
| Excluded by noindex | 7 | Intentional. |
| Soft 404 | 3 | — |

**Two hard facts:** (a) the entire increase happened **before Jun 11**, i.e. before batch-2's hysteresis/pruning could act, and the coverage chart can't yet show the fix; (b) the increase is dominated by **crawled-not-indexed (+55)** and **404 churn (+38)** — both symptoms of having flooded the index with ~2,000 thin auto-generated pages of low unique value. That's an index-bloat / page-quality problem, not a regression in the pages that matter.

## Root causes, ranked by leverage (what we can actually change)

1. **`/calculator` + `/trade-ups` crawler HTML is thin and schema-less.** 553 words / 2 links / 0 JSON-LD vs competitors' 3,000 / 80+ / FAQPage. *Fixable, high leverage, directly on the #1 money page.* Plan 014 fixed the title but not the body depth or schema.
2. **Impoverished internal linking.** The money page has 2 internal links; competitors have 80+. We don't flow equity to money pages or build topical clusters (calculator ↔ collections ↔ skins ↔ blog).
3. **Index bloat / 404 churn.** ~2,000 thin pages → crawled-not-indexed + 404s dilute crawl budget and site-quality signals. Batch-2 (013) started; needs to (a) stop deleted-trade-up URLs returning bare 404 (use 410, or keep a noindex tombstone), (b) tighten which skin pages are indexable to only those with genuine unique value.
4. **Duplicate consolidation lag.** Fixed at source; verify no remaining internal links to non-canonical forms, then let it ride + request validation.
5. **Domain authority gap (the ceiling).** Structural. No amount of on-page work beats csfloat.com for the head term short-term. *Implication:* stop optimizing for saturated head terms; **own the long-tail our live-data product is uniquely suited for** (specific collections, specific skins, "is X trade up profitable", "best Y collection trade ups") where authority matters less and freshness/coverage is our edge. The best-performing page already proves this: `/blog/best-cs2-collections-knife-trade-ups-2026/` = 1,647 impr @ pos 12 (our single best non-branded page — it's a specific long-tail topic).

## What is NOT worth doing

- Chasing "cs2 trade up calculator" head term to page 1 in <3 months. Realistic near-term target: top-10 on long-tail collection/skin/"is-it-profitable" queries + CTR capture on the page-1 knowledge terms.
- Concluding batch 2 "failed." It cannot be measured yet. Re-export Coverage *after* Jul 1 (so it includes post-fix days) and Performance with a Jun-11→present window to isolate the fixed period.

## Verification method (so the next round is measurable)

Lock a baseline now (this file). Re-pull GSC ~Jul 8 and ~Jul 22 filtered to `date >= 2026-06-11`. Track: (a) duplicate rows collapsing (www/slash), (b) calculator/trade-ups position trend, (c) not-indexed composition (404 + crawled-not-indexed should fall as 013/round-3 act), (d) CTR on the page-1 knowledge terms.
