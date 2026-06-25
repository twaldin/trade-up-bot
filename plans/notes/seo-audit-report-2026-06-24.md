# SEO Audit Report — tradeupbot.app (2026-06-24)

Run with the `seo-audit` skill framework. Complements `seo-diagnosis-2026-06-24.md` (strategy/positioning) — this is the systematic technical/on-page checklist pass. Site = SaaS CS2 trade-up finder; goal = signups/customers; moat = real-listing float-exact pricing.

## Executive summary

**Overall health: technically sound foundation, with specific high-leverage gaps.** The crawl/redirect/canonical layer is now correct (fixed in batches 1–2), server response is fast (TTFB 0.3–0.7s post-CPX41), mobile viewport is set, and — importantly — the framework's biggest international risk does **not** apply (translation is client-side only; no thin locale pages for Google to index). The real issues are on-page and structural, not infrastructural.

**Top 5 priority issues:**
1. **Schema missing on 4 key pages** — `/calculator`, `/skins`, `/faq`, `/pricing` emit **zero** JSON-LD (verified in server-rendered crawler HTML). `/faq` having no FAQPage schema is the most egregious; `/calculator` is the money page. (Skin detail pages, by contrast, have excellent Product/AggregateOffer/FAQPage schema — a strength to replicate.)
2. **Keyword cannibalization** — `how-cs2-trade-ups-work` vs `how-do-cs2-trade-ups-work` compete for one intent; `best-cs2-trade-up-simulator` (1,357 impr) + `cs2-trade-up-calculator-guide` both cannibalize the actual `/calculator` page for "calculator/simulator" queries.
3. **Thin money page** — `/calculator` = 553 words, 2 internal links vs competitors' ~3,000 words / 80+ links (from diagnosis).
4. **Titles over length** — `/calculator` 66, `/trade-ups` 69, blog titles 68–75 chars; truncated in SERP (~60 char limit), weakening CTR. The "| TradeUpBot Blog" suffix wastes budget.
5. **Funnel/internal-linking** — money pages near-orphaned; best content has no CTA (being fixed in plan 022).

## Technical SEO findings

| Issue | Impact | Evidence | Fix | Priority |
|---|---|---|---|---|
| Schema absent on /calculator, /skins, /faq, /pricing | **High** | curl as Googlebot → `"@type"` grep returns NONE on those 4; present on /, /trade-ups, /skins/:slug, /collection/:slug, /blog/:slug | Add SoftwareApplication/WebApplication + FAQPage to /calculator; FAQPage to /faq; CollectionPage/ItemList to /skins; Product/Offer to /pricing | **1** |
| Crawl/canonical/redirect | OK ✓ | www→apex 301, http→https 301, slash 301, self-ref canonicals, slash sitemap (batch-1/2) | none | — |
| TTFB / server speed | OK ✓ | 0.29–0.74s across 5 page types | none (CWV field data still worth watching in GSC) | — |
| Mobile viewport | OK ✓ | `width=device-width, initial-scale=1.0` present | none | — |
| HSTS header | Low | none returned | Add `Strict-Transport-Security` at nginx (bonus hardening) | 4 |
| i18n / hreflang | OK (by design) | locale URLs (/pt/,/tr/,/zh/) all 200 with English content; no real locale routes; translation client-side; no hreflang; html lang=en | **No action** — avoids thin-locale penalty. International indexable pages = a *future* option, not a fix; only pursue once English authority is established | — |
| Index bloat (crawled-not-indexed 257, 404 churn 141) | Med | GSC coverage; ~2,000 thin auto-pages | Plan 026 (410 tombstones, tighten skin-page indexability) | 2 |

## On-page findings

| Issue | Impact | Evidence | Fix | Priority |
|---|---|---|---|---|
| Keyword cannibalization (how-work ×2; simulator/calculator-guide vs /calculator) | **High** | sitemap lists both `how-cs2-trade-ups-work` + `how-do-cs2-trade-ups-work`; `best-cs2-trade-up-simulator` (1357 impr @55) + `cs2-trade-up-calculator-guide` compete with `/calculator` | Consolidate the two "how it works" posts (301 the weaker → stronger, merge content); re-point the simulator/calculator blog posts to *support* (internal-link to) `/calculator` as the canonical target for that intent, differentiate their angles, or 301 if redundant | **1** |
| Titles >60 chars (truncated) | Med | /calculator 66, /trade-ups 69, blogs 68–75 | Trim to ≤60; shorten blog suffix to `| TradeUpBot` (drop "Blog"); front-load primary keyword | 2 |
| Thin /calculator content | High | 553 words / 2 links | Plan 023 (depth + the float-exact demo) | 1 |
| Internal linking impoverished | High | /calculator 2 links | Plan 024 (clusters + hub) | 2 |
| Image alt text / optimization | Low–Med | (spot-check during 023/024) | Verify alt text on skin images, calculator screenshots | 3 |

## Content findings

| Issue | Impact | Evidence | Fix | Priority |
|---|---|---|---|---|
| Money page lacks the differentiator story | High | /calculator has no float-exact-vs-condition explanation | Make float-exact pricing the on-page narrative + live demo (positioning doc) | 1 |
| E-E-A-T: original data is the strength | Positive | "CS2 Trade-Up Calculators Are Wrong: $2,778 Data Test" post already embodies first-hand data | Expand into a content pillar (025); add author/credibility where natural | 2 |
| AI-content risk for programmatic pages (025) | Med (preventive) | upcoming long-tail generation | Apply `references/ai-writing-detection.md` patterns (no em-dash spam, no filler, vary structure); codex gate checks each page reads human + claims verified against engine | 2 |
| Comparison/alternative pages missing | Med | no "TradeUpBot vs X" pages (SaaS pattern) | Mechanism-based comparison content (025) — float-exact vs condition pricing, fairly stated | 3 |

## Prioritized action plan

**1 — Critical (indexation/ranking blockers + highest leverage):**
- Schema on /calculator, /faq, /pricing, /skins → **plan 023** (expanded scope).
- Resolve cannibalization (consolidate how-work ×2; re-point simulator/calculator-guide to /calculator) → **new plan 023b**.
- /calculator depth + float-exact demo → **plan 023 / 028**.

**2 — High-impact:**
- Internal-linking + clusters → **plan 024**.
- Index-bloat hygiene → **plan 026**.
- Title-length trims (≤60, drop "Blog" suffix) → fold into **023b**.

**3 — Quick wins:**
- HSTS header at nginx.
- Alt-text sweep on images.

**4 — Long-term:**
- Long-tail content engine (025), off-site authority/creators, AI-search (the rising "AI Assistant" channel — schema + data pages feed it).

## Net delta vs prior diagnosis

New findings the framework surfaced: **keyword cannibalization** (not previously flagged), **schema gaps on /faq + /pricing + /skins** (prior diagnosis only flagged /calculator), **title-length truncation**, **TTFB is healthy** (rules out speed as a cause), and **i18n is a non-issue by design** (rules out a whole risk category). These refine plan 023's scope and add plan 023b (cannibalization + titles).
