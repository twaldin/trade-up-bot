# Plan 012: SEO crawl hygiene — nofollow auth links, prerender canonical consistency

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving on. If a STOP condition
> occurs, stop and report. The reviewer maintains plans/README.md.
>
> **Drift check (run first)**: `git diff --stat 5fbb497..HEAD -- src/ scripts/prerender.ts server/canonical-redirects.ts`
> On in-scope drift, compare "Current state" excerpts before proceeding; mismatch = STOP.

## Status

- **Priority**: P1 — **Effort**: S — **Risk**: LOW — **Depends on**: none — **Category**: seo
- **Planned at**: commit `5fbb497`, 2026-06-10

## Why this matters

Google Search Console (2026-06-10 export) reports **85 pages "Blocked by robots.txt" with FAILED validation**. robots.txt correctly disallows `/auth/` and `/api/`, but the site's rendered HTML contains plain crawlable `<a href>` links into those paths — Googlebot discovers them, queues them, then hits the robots block, generating the coverage errors and wasting crawl budget. Verified: 9 link sites lack `rel="nofollow"`. Secondarily, `scripts/prerender.ts` prerenders blog posts under their non-canonical (no-trailing-slash) URLs; the canonical tags come out correct anyway (forced by `normalizePrerenderedHead`), but the route list should match the canonical form so nothing downstream depends on that correction.

## Current state (verified 2026-06-10)

Un-nofollowed auth/api links (grep `href="/auth\|href="/api/auth\|href={\`/auth` in src/ minus nofollow):

- `src/App.tsx:200` — `/api/auth/discord` (UserMenu "Link Discord")
- `src/App.tsx:235` — `/auth/logout` (UserMenu "Sign Out")
- `src/App.tsx:339` — `/auth/steam?return=...` (AppShell sign-in; NOTE other steam links in this file already carry `rel="nofollow"` — match that)
- `src/components/SiteNav.tsx:205` — `/auth/logout`
- `src/components/SiteNav.tsx:223` — `/auth/steam?return=...`
- `src/pages/FeaturesPage.tsx:194` — `/auth/steam`
- `src/pages/TradeUpSharePage.tsx:198, 209, 243` — `/auth/steam...`

Prerender routes (`scripts/prerender.ts:15-25`): `...blogPosts.map((post) => \`/blog/${post.slug}\`)` — no trailing slash, while the runtime canonical is the slash form (`server/blog-routes.ts:12-21` redirects no-slash → slash 301; `scripts/seo-html.ts:38` sets canonical `${BASE_URL}/blog/${post.slug}/`). Canonicalization conventions are split by design: `server/canonical-redirects.ts:3` (`NO_TRAILING_SLASH_PATHS`) enforces no-slash for app pages; blog posts are slash-canonical — this is nowhere documented.

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| Unit | `npm run test:unit` | all pass |
| Build + SEO gate | `npm run build` | exit 0; prerender + verify-seo-html pass |

dist/ is gitignored — run `npm run build` once before `test:unit` (internal-cross-linking.test.ts reads dist/index.html).

## Scope

**In scope**: `src/App.tsx`, `src/components/SiteNav.tsx`, `src/pages/FeaturesPage.tsx`, `src/pages/TradeUpSharePage.tsx` (rel attributes only); `scripts/prerender.ts` (ROUTES array only); `server/canonical-redirects.ts` (doc comment only); tests/unit for any source-string expectations moved.
**Out of scope**: robots.txt, sitemap.ts, redirect logic, any server handler; GSC admin actions (operator notes in README).

## Steps

### Step 1: Add `rel="nofollow"` to all 9 link sites

For each link listed above add `rel="nofollow"` (keep any existing classes/attrs; for `<a>` opening in same tab no `noopener` needed). Match the existing pattern at `src/App.tsx:343` (AppShell steam link, already `rel="nofollow"`).

**Verify**: `grep -rn 'href="/auth\|href="/api/auth\|href={\`/auth' src/ | grep -v nofollow` → empty; `npm run typecheck` exit 0.

### Step 2: Prerender blog routes in canonical slash form

In `scripts/prerender.ts` ROUTES: `...blogPosts.map((post) => \`/blog/${post.slug}/\`)`. Read `prerenderRoute`'s outputPath logic first — it does `join(DIST_DIR, route, "index.html")`; a trailing slash in `route` must not break the path (join collapses it — verify by building).

**Verify**: `npm run build` → exit 0, 18 routes prerendered, SEO verification passes; `grep -o 'rel="canonical" href="[^"]*"' dist/blog/*/index.html | head -4` → all slash-form canonicals (unchanged from today).

### Step 3: Document the canonicalization convention

Top of `server/canonical-redirects.ts`, add a comment block: site-wide canonical form is NO trailing slash, EXCEPT blog posts (`/blog/:slug/` — slash-canonical, enforced by server/blog-routes.ts; prerendered as directories). New routes must pick one and register the matching redirect.

**Verify**: `npm run test:unit` all pass (seo source-string tests unaffected — comment only).

### Step 4: Full gate

**Verify**: `npm run typecheck && npm run test:unit && npm run build` all exit 0.

## Done criteria

- [ ] Zero un-nofollowed `/auth/`+`/api/auth` hrefs in src/ (grep above empty)
- [ ] Prerender ROUTES use slash-form blog URLs; build + verify-seo-html green
- [ ] Convention comment present in canonical-redirects.ts
- [ ] `npm run typecheck`, `npm run test:unit`, `npm run build` all pass; only in-scope files modified

## STOP conditions

- Step 2 changes any prerendered file's canonical href vs today's output (diff them) — report.
- A source-string test quotes one of the edited link lines and the fix would weaken the assertion.

## Maintenance notes

- New sign-in/logout links must carry `rel="nofollow"` — the grep in Done criteria is the check.
- Operator (GSC): after deploy, in Search Console start validation on the "Blocked by robots.txt" cohort; coverage errors should drain over ~2-4 weeks.
