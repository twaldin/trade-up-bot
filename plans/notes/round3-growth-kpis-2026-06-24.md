# Round 3 — Growth master plan & KPIs (2026-06-24)

Companion to `seo-diagnosis-2026-06-24.md`. User directive: **push everything (technical SEO + long-tail content + off-site), but anchor it to core KPIs and grow users/customers** — not vanity rankings.

## Funnel baseline (prod DB + GSC, 2026-06-24)

| Metric | Value | Source |
|---|---|---|
| Total users (Steam signups) | **108** | `users` table |
| Paying — Pro ($15/mo) | **2** | tier='pro' |
| Paying — Basic ($5/mo) | **0** | tier='basic' |
| Est. MRR | **~$30/mo** | 2× Pro |
| Free→paid conversion | **1.9%** | 2/108 |
| Signups, last 30d | 12 | created_at |
| Signups, last 7d | **0** | created_at |
| Signup rate (8-wk avg) | ~5/week | — |
| Organic clicks (3 mo) | **208** (~2/day) | GSC |
| Organic clicks→signup path | **broken** | top blog post = 0 signup links, 0 CTA |

**The brutal read:** organic search is a near-zero contributor today, and the little traffic we get **dead-ends** — our best page (1,647 impr) has no CTA, no signup link, no calculator link. The 108 users came from *other* channels (Reddit/Steam/word-of-mouth — to be confirmed). Signups went to **0 in the last 7 days**, coinciding with the mid-June daemon stall (degraded product freshness, now fixed by plans 020/021 + the CPX41 rescale).

## North-star & KPI tree

- **North-star:** paying customers (now **2**) → MRR (now **~$30**).
- **Leading indicators:** weekly signups (now ~5), free→paid conversion (now 1.9%).
- **Channel — organic:** organic clicks (now ~2/day), **organic→signup rate** (now ~0, the key broken number), indexed-money-page positions, duplicate-row consolidation.
- **Product health (gates conversion):** daemon discovery freshness (fixed), # fresh profitable trade-ups shown.

We will instrument organic→signup attribution (lightweight: a `?ref=` / referrer capture on `/auth/steam` start, logged to `users`) so every later SEO claim is measured in **signups**, not impressions.

## Why the ordering is funnel-first, not rank-first

Rankings are a 4–12 week+ lever gated by domain authority we don't have. **Converting existing traffic and fixing product→signup leaks pays back in days and is fully in our control.** So round 3 runs cheapest-fastest-certain → slowest-uncertain:

| # | Plan | Lever | Payback | Google-dependent? |
|---|---|---|---|---|
| 022 | Funnel conversion (CTAs blog/money → signup+product) | Convert traffic we already have | days | **No** |
| (instr) | `?ref` organic→signup attribution | Measure the funnel | days | No |
| 023 | On-page depth + JSON-LD schema on money pages | Rank ceiling + CTR + rich results | weeks | partial |
| 024 | Internal linking + topical clusters | Authority flow + dwell + crawl | weeks | partial |
| 026 | Index-bloat hygiene (410 tombstones, thin-page indexability) | Site-quality signal, crawl budget | weeks | yes |
| 025 | Long-tail content engine (programmatic profitability pages) | New rankable surface our live data owns | 1–3 months | yes |
| off | Off-site growth plan (Reddit/Steam/YouTube/backlinks) | Authority + direct traffic that already converts | weeks–months | n/a |

## Execution loop (per plan)

Workflow (executor in worktree → 2 claude verifiers) → **`codex exec` adversarial review of the diff** (user-mandated pre-deploy gate) → advisor review → merge → CI → deploy → verify live. Codex prompt template lives in each plan. Content plans (025) carry a higher bar: codex checks factual/profitability claims against `server/engine/fees.ts` + live data, not just code.

## Realistic targets (8 weeks, measured in the product not GSC)

- Organic→signup rate from ~0 → first measurable cohort (CTAs live + attribution).
- Signups/week ~5 → 10+ (funnel fixes + product freshness restored).
- First Basic-tier conversions (currently 0) via clearer value path.
- Money-page positions: calculator/trade-ups out of page-6 territory toward page 2–3; long-tail collection pages into top-10 (the collections-knife post already sits at pos 12 — proof the long-tail is winnable).
- Re-pull GSC ~Jul 8 / ~Jul 22 filtered to `date>=2026-06-11` to isolate the fixed period; track duplicate-row collapse.

## Status

| Plan | Title | Status |
|---|---|---|
| 022 | Funnel conversion + `?ref` attribution | TODO (next) |
| 023 | On-page depth + schema | TODO |
| 024 | Internal linking + clusters | TODO |
| 026 | Index-bloat hygiene | TODO |
| 025 | Long-tail content engine | TODO |
| off | Off-site growth plan | TODO |
