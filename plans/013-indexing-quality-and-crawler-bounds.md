# Plan 013: Indexing quality — sitemap hysteresis, stale-link pruning, bounded crawler pages

> **Executor instructions**: Follow this plan step by step with verification. STOP conditions are binding. Reviewer maintains plans/README.md.
>
> **Drift check (run first)**: `git diff --stat 5fbb497..HEAD -- server/routes/sitemap.ts server/index.ts server/seo.ts`
> On in-scope drift, compare excerpts; mismatch = STOP.

## Status

- **Priority**: P1 — **Effort**: M — **Risk**: MED (changes what Google gets told to index) — **Depends on**: none — **Category**: seo
- **Planned at**: commit `5fbb497`, 2026-06-10

## Why this matters

GSC (2026-06-10): **103 Not-found (404), 3 soft-404, 202 crawled-currently-not-indexed, 28 5xx**, with not-indexed counts trending up (535→547 over 10 days). Three code-level causes, all verified:

1. **Zero hysteresis between sitemap inclusion and noindex**: `buildSkinSitemap` includes skins with `listing_count >= 5` (server/routes/sitemap.ts:89-91) while `/skins/:slug` flips to `noindex` below 5 (server/index.ts, skin handler `robots = listingCount < 5 ? "noindex, follow" : ...`). Listings churn constantly — a skin enters the sitemap at 5 listings and is noindexed (or worse) by the time Googlebot arrives. Sitemap-promised pages that answer noindex/404 are exactly the 404/soft-404/crawled-not-indexed cohorts.
2. **Stale trade-ups stay internally linked**: stale/preserved trade-up pages get `noindex` (server/index.ts trade-up detail handler) but collection trade-up pages and related-link blocks keep linking them — recurring crawls of noindex pages.
3. **Unbounded crawler pages**: `/trade-ups/collection/:slug` crawler query has NO LIMIT (server/index.ts, `SELECT DISTINCT ON (t.id) ... WHERE ti.collection_name = $1 AND ... profit_cents > 0` — the handler then renders up to 20/type but fetches everything) and includes penny-profit (>0 cents) trade-ups, producing huge, thin, volatile pages.

## Current state (verify before editing — locate by pattern, plans 004/005 shifted line numbers)

- `server/routes/sitemap.ts:89-101` — `buildSkinSitemap(base, skins, lastmod, minListings = 5)` filters `listing_count >= minListings`; caller at :176. The skins query at :170 has no HAVING (filtering happens in the builder).
- `server/index.ts` `/skins` crawler hub: `HAVING COUNT(l.id) >= 5`.
- `server/index.ts` `/skins/:slug` handler: `robots = listingCount < 5 ? "noindex, follow" : "index, follow"`. KEEP this at 5 — the hysteresis comes from raising only the sitemap side.
- `server/index.ts` `/trade-ups/collection/:slug` crawler branch: unbounded query; per-type slice(0, 20) happens in JS after fetching all rows.
- `server/routes/sitemap.ts` sitemap-collection-tradeups.xml query: `profit_cents > 0`.
- Related-links blocks: `renderTradeUpDetail` related list + `collRelated`/`skinRelated` in server/index.ts; the trade-up detail's "related" collection links don't filter staleness (the trade-ups listed on collection pages come from the unbounded query above — bound + filter there).

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| Unit | `npm run test:unit` | all pass |
| Integration | `npm test` | all pass (tradeupbot_test PG) |
| Build + SEO gate | `npm run build` | exit 0 |

Build once before test:unit (dist/ dependency).

## Scope

**In scope**: `server/routes/sitemap.ts`, the `/trade-ups/collection/:slug` and `/skins`-hub handlers in `server/index.ts`, `server/seo.ts` ONLY if a renderer signature must accept already-filtered rows; tests.
**Out of scope**: the noindex thresholds themselves (keep `<5`), robots.txt, blog routes, `/skins/:slug` handler internals beyond reading them, the Redis caching added by plan 005 (keep cache keys/TTLs as-is — your changes alter the cached VALUES, which is fine; do not restructure the caching).

## Steps

### Step 1: Sitemap hysteresis

`buildSkinSitemap` default `minListings` 5 → **10** (or pass 10 at the call site — choose the call site so the function default documents the floor). Same raise for the `/skins` crawler hub HAVING clause (>= 10): the hub is an internal-link feeder, same churn problem.

**Verify**: unit-test `buildSkinSitemap` directly (it's exported and pure — seed rows at counts 4/7/10/12, assert only >=10 included), model after existing sitemap tests if any (grep tests/ for buildSkinSitemap; create tests/unit/sitemap-thresholds.test.ts if none). `npm run test:unit` green.

### Step 2: Bound the collection crawler page and raise its profit floor

In the `/trade-ups/collection/:slug` crawler branch: change `profit_cents > 0` → `profit_cents > 100`, add `LIMIT 120` to the query (6 types × 20 shown), and keep the JS per-type slice(0, 20). Apply `profit_cents > 100` to the sitemap-collection-tradeups.xml query too (a collection sitemap entry should exist only if it has at least one >$1 trade-up). Mind plan 005's caching: the crawler HTML cache key (`seo_coll_tu:`) and count key (`coll_tu_count:`) — update the COUNT query for the non-crawler meta path to the same `> 100` threshold so the description number matches the page.

**Verify**: integration test (tests/integration/, model on trade-ups-counts.test.ts seeding style — note these handlers live in server/index.ts, so test via source-string assertions in tests/unit/seo-route-cache.test.ts style instead if mounting is infeasible: assert `profit_cents > 100` appears in both files and `LIMIT 120` in the handler). `npm test` green.

### Step 3: Stop linking stale trade-ups

In the same collection crawler query add `AND t.listing_status = 'active'` (verify it's already there — it is) AND exclude preserved-stale: add `AND t.preserved_at IS NULL` (read the staleness semantics in the trade-up detail handler first: stale = status 'stale' OR preserved_at older than 7 days; mirror exactly — `AND (t.preserved_at IS NULL OR t.preserved_at > NOW() - INTERVAL '7 days')`).

**Verify**: source-string/integration assertion as in Step 2; `npm test` green.

### Step 4: Full gate + live spot check

**Verify**: `npm run typecheck && npm test && npm run build` all green. After deploy (operator): `curl -A Googlebot https://tradeupbot.app/trade-ups/collection/<big-collection>` → row count per type ≤ 20, no penny-profit rows.

## Done criteria

- [ ] Sitemap + skins hub thresholds at 10; noindex stays at 5 (hysteresis window exists)
- [ ] Collection crawler query LIMITed and filtered (>$1, non-stale); sitemap-collection-tradeups matches
- [ ] Non-crawler meta count uses the same threshold
- [ ] New threshold unit test passes; `npm run typecheck`, `npm test`, `npm run build` green
- [ ] Only in-scope files modified

## STOP conditions

- The skin sitemap query/builder interaction differs from the excerpt (e.g. threshold also enforced in SQL elsewhere) — map it fully first; report if ambiguous.
- Raising thresholds would empty a sitemap on the local dev DB AND the logic looks wrong for prod scale — distinguish data-poverty from logic error; report only the latter.

## Maintenance notes

- The 5→10 gap is the hysteresis knob; if GSC 404s persist after 4-6 weeks, widen it (sitemap 15) before touching noindex.
- 28 5xx in GSC predate today's perf work (plans 005/008 removed the likely causes: 5s+ cold SEO paths and deploy 502 windows); expect that cohort to drain on its own — recheck the next GSC export before doing more.
