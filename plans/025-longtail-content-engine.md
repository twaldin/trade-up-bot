# Plan 025: Long-tail content engine — float-exact profitability pages + comparison pillar

> **Executor instructions**: Follow step by step with verification. STOP conditions binding. Reviewer maintains plans/README.md. **This plan ships public content — the codex gate must verify every factual/profitability claim against the engine before deploy.**
>
> **Drift check (run first)**: `git diff --stat 8cd6d32..HEAD -- server/index.ts server/seo.ts src/data/blog-posts.ts`

## Status
- **Priority**: P2 (1–3 month compounding payoff; our defensible moat surface) — **Effort**: L — **Risk**: MED-HIGH (public content + profitability claims) — **Depends on**: 023, 023b, 024 — **Category**: seo/content
- **Planned at**: commit `8cd6d32`, 2026-06-24

## Why this matters
Strategy (`seo-diagnosis` + `positioning-float-accuracy`): we can't beat csfloat/pricempire for the head term, but we **own the long-tail our live data uniquely answers** — "is [collection] trade-up profitable", "best [collection] trade-ups", with **float-exact, real-listing** numbers competitors literally cannot generate (verified moat: `core.ts calculateOutputFloat` + KNN float-exact output pricing). Proof it works: `/blog/best-cs2-collections-knife-trade-ups-2026/` (1,647 impr @12) and the existing "CS2 Trade-Up Calculators Are Wrong: $2,778 Data Test" post are exactly this. Goal: systematize it.

## Current state (verify)
- Collection pages already render at `server/index.ts:214 /trade-ups/collection/:slug` with ItemList/Breadcrumb schema (bounded, profit>100, non-stale per plan 013). Skin pages at `:605`. These are the *programmatic surface* — they exist but are thin/templated.
- Blog posts in `src/data/blog-posts.ts` are the *editorial surface*.
- Live data: trade_ups table (real discovered contracts), float-exact pricing in the engine.

## Two workstreams (do 1 first; 2 is larger)

### Workstream A — Editorial comparison pillar (smaller, higher authority value)
Expand the "calculators are wrong" angle into a small cluster of genuinely-written posts (NOT scaled AI spam — see `references/ai-writing-detection.md` in the seo-audit skill; vary structure, no em-dash/filler patterns, real data):
1. "Why CS2 trade-up calculators disagree: condition-average vs float-exact pricing" (the mechanism, fairly stated, no unverified per-competitor accusations).
2. "How much does output float change trade-up profit?" (a real data study using our engine — pick N real outputs, show condition-avg price vs float-exact price delta).
Each: original data from our engine, internal links (024), CTA (022), FAQPage schema (023 pattern). Mirror metadata in blog-meta.ts.

### Workstream B — Programmatic profitability pages (larger, the moat at scale)
Make the existing collection/skin programmatic pages genuinely useful + add an "is it profitable" answer surface:
- On each collection page, add a server-rendered, data-backed summary: "Best profitable trade-up in [collection] right now: +$X at Y% (float-exact)", pulled from live trade_ups. This makes the page uniquely valuable (real, fresh, float-exact) rather than templated-thin.
- Ensure these pages meet the indexability bar (tie to plan 026 — only index collections/skins with genuine current value; noindex thin/empty ones).
- **Anti-thin-content guard:** a programmatic page with no current profitable trade-up should NOT be a thin doorway — either show genuinely useful float/price data or noindex it (026). Do not mass-generate empty templated pages (Google scaled-content-abuse risk).

## Commands
`npm run typecheck` / `npm test` / `npm run build` green; build before test:unit.

## Scope
**In scope**: `src/data/blog-posts.ts` + blog-meta.ts (Workstream A posts), collection/skin crawler handlers in `server/index.ts` + `server/seo.ts` (Workstream B data-backed summaries), tests.
**Out of scope**: changing the discovery engine/pricing math; the calculator app; creating pages with no unique value (forbidden — scaled-content risk).

## Steps (suggested sequence)
1. **A1** — write post #1 (mechanism); codex verifies claims vs engine/fees.ts; ship.
2. **A2** — write post #2 (float→profit data study) using real engine output; codex verifies the numbers reproduce; ship.
3. **B1** — add the live "best profitable trade-up right now" summary to collection pages (server-rendered, float-exact, from trade_ups); cache per plan 005 conventions; integration test it.
4. **B2** — wire indexability so only valuable programmatic pages are indexed (coordinate with 026).
Each step is independently shippable; do NOT batch all into one deploy.

## Done criteria (per shipped unit)
- [ ] Every published number reproduces from the engine/live data (codex-verified) and matches fees.ts
- [ ] Content reads human (passes ai-writing-detection heuristics); unique value per page; no scaled-thin doorways
- [ ] Internal links (024) + CTA (022) + schema (023) present; blog-meta parity
- [ ] typecheck/test/build green; only in-scope files modified

## STOP conditions
- A profitability claim can't be reproduced from live data/engine — STOP, don't publish.
- Workstream B would create indexable pages with no unique content — STOP, gate on 026's indexability rules first.
- Any comparison content names a competitor with an unverified claim — STOP, make it a mechanism claim instead.

## Maintenance notes
- This is the moat surface — quality over quantity. A few genuinely-useful data pages beat hundreds of templated ones.
- Feeds the AI-citation channel (schema + original data). Re-measure long-tail positions in GSC at 4–8 weeks.
