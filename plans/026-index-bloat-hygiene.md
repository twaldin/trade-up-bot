# Plan 026: Index-bloat hygiene — 410 for deleted trade-ups + tighten thin-page indexability

> **Executor instructions**: Follow step by step with verification. STOP conditions binding. Reviewer maintains plans/README.md.
>
> **Drift check (run first)**: `git diff --stat 8cd6d32..HEAD -- server/index.ts server/routes/sitemap.ts`

## Status
- **Priority**: P2 — **Effort**: M — **Risk**: MED (changes HTTP status + indexability signals) — **Depends on**: none (coordinate with 025 on which programmatic pages stay indexable) — **Category**: seo/technical
- **Planned at**: commit `8cd6d32`, 2026-06-24

## Why this matters
Audit + GSC: not-indexed 651, dominated by **crawled-not-indexed 257** (thin programmatic pages Google declines) + **404 churn 141** (stale/deleted trade-ups returning bare 404). ~2,000 thin auto-pages dilute crawl budget and site-quality signals. Goal: (a) tell Google deleted trade-ups are permanently gone (410) so they drain fast, (b) ensure only genuinely-valuable programmatic pages are indexable.

## Current state (verify — locate by pattern, line numbers drift)
- Trade-up detail handler returns **`res.status(404)`** for missing/deleted/stale (`server/index.ts:~195`, `~377`). Stale trade-ups currently get `noindex` (`:~415 robots: isStale ? "noindex, follow" : ...`) but DELETED ones (row gone) get bare 404.
- Collection-trade-up + skin handlers also 404 on missing (`:~238, ~471, ~641, ~654`).
- Skin page indexability: `robots = listingCount < 5 ? "noindex, follow" : "index, follow"` (`:~662`) — set by plan 013.
- Sitemap excludes thin pages already (plans 013): skins ≥10 listings, collection trade-ups profit>100.

## Commands
`npm run typecheck` / `npm run test:unit` / `npm test` / `npm run build` green; build before test:unit.

## Scope
**In scope**: trade-up detail + collection-trade-up + skin handlers in `server/index.ts` (status codes + robots thresholds), tests.
**Out of scope**: the sitemap thresholds (013 owns), discovery/deletion logic, the calculator/blog.

## Steps
### Step 1: 410 for deleted trade-ups (distinguish gone vs never-existed)
For a trade-up ID that previously existed but is now deleted/stale-purged (row absent), return **`410 Gone`** instead of 404, with a minimal noindex body. Decision rule: an ID-shaped request whose row is absent → 410 (Google drops 410s faster than 404s). A malformed/never-valid path → keep 404. If we can't distinguish "was deleted" from "never existed" cheaply, default ID-shaped trade-up detail misses to 410 (these IDs only ever come from our own prior sitemap/links). Apply the same to collection-trade-up detail misses.
**Verify**: integration/source test — a missing trade-up ID returns 410; `npm test` green. Post-deploy: `curl -I` a known-deleted ID → 410.

### Step 2: Keep stale = noindex (confirm, don't regress)
Confirm stale-but-present trade-ups still return 200 + `noindex,follow` (already the case at `:~415`) so internal links don't 404 mid-crawl; only ABSENT rows 410. Don't change the stale path.
**Verify**: source test asserts the isStale→noindex branch intact.

### Step 3: Tighten thin skin-page indexability
The skin `noindex` floor is `<5` listings. Raise the INDEXABLE bar to align with genuine value: a skin page should be `index` only if it has enough unique data to deserve it (e.g. ≥5 listings AND has price/float data to render). Keep the sitemap floor (≥10, plan 013) as the stricter inclusion gate; the page-level noindex at <5 stays, but ensure pages between 5–9 (indexable but not in sitemap) genuinely render useful content (tie to 025 — if they're thin, noindex them too). Do NOT mass-noindex valuable pages; the goal is removing EMPTY/thin doorways, not de-indexing the catalog.
**Verify**: spot-check a <5-listing skin → noindex; a rich skin → index; `npm test` green.

### Step 4: Full gate
`npm run typecheck && npm test && npm run build` green.

## Done criteria
- [ ] Deleted/absent trade-up (and collection-trade-up) IDs return 410, not 404; minimal noindex body
- [ ] Stale-but-present trade-ups unchanged (200 + noindex,follow)
- [ ] Thin skin pages noindex; valuable ones index; no regression to the catalog's indexable set
- [ ] Tests green; only in-scope files modified

## STOP conditions
- Distinguishing "deleted" vs "never existed" requires a tombstone table or schema change — if so, STOP and report (don't add a migration here; default-to-410 for ID-shaped misses is the no-migration path).
- Raising the skin index bar would noindex pages currently driving impressions (check GSC top skin pages: awp-dragon-lore, mp5-sd-savannah-halftone, m4a1-s-fade) — keep those indexable; report if the rule would catch them.

## Maintenance notes
- After deploy: GSC "Not found (404)" cohort should shift to/through "410" and drain faster than 404; recheck next export.
- Coordinate indexability rules with plan 025 so we don't index thin programmatic pages 025 hasn't enriched yet.

## MUST-FIX before executing (codex adversarial review, 2026-06-24)
1. **Do NOT 410 `/trade-ups/collection/:slug`** — that's a collection LANDING page, not a trade-up detail; unknown collection slugs correctly 404 (`server/index.ts:214,236`). 410-ing it would mark real collections "permanently gone." The 410 applies ONLY to the trade-up DETAIL route.
2. **SEO route only — do NOT touch `/api/trade-ups/:id`** — SEO detail is `server/index.ts:369`; the API detail (`server/routes/trade-ups.ts:521`) returns 404 for missing and integration setup mounts the API routers (`tests/integration/setup.ts:472`), not the SEO handler. Change only the SEO route; say so explicitly.
3. **Define "ID-shaped" concretely** — `trade_ups.id` is SERIAL integer (`server/db.ts:129`); the SEO route passes `req.params.id` straight into the query (`:372`). Rule: `/^\d+$/` → absent numeric row = **410**; non-numeric/malformed = keep **404**.
4. **Skin indexability predicate must be concrete** — current rule is exactly `listingCount < 5` (`server/index.ts:658`); sitemap uses `>=10` (`sitemap.ts:89`). "Raise the bar" is too vague. Specify the actual predicate (e.g. `index` only if `listingCount >= 5 AND condPrices.length > 0` / has profitable-TU or collection data); do NOT mass-deindex the catalog. Keep GSC's top skin pages indexable (awp-dragon-lore, mp5-sd-savannah-halftone, m4a1-s-fade).
5. **Cache invalidation** — skin crawler HTML + meta (incl. robots) cached under `seo_skin:*` / `seo_skin_meta:*` (`:610,955`, 3600s). Any robots/status change needs a cache-key bump or deploy-time Redis clear, or verification reads stale robots.
6. **Red-first test update** — `tests/unit/seo-canonical.test.ts:69` asserts the exact `<5` skin robots expression and exactly two `noindex,follow` occurrences. A new predicate/410 body breaks it; update the expectation deliberately (red-first), don't leave it a surprise failure.
