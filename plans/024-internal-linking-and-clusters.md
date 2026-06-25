# Plan 024: Internal-linking overhaul + topical clusters (flow equity to money pages)

> **Executor instructions**: Follow step by step with verification. STOP conditions binding. Reviewer maintains plans/README.md.
>
> **Drift check (run first)**: `git diff --stat 8cd6d32..HEAD -- src/components/SiteFooter.tsx server/seo.ts server/index.ts src/data/blog-posts.ts`

## Status
- **Priority**: P2 — **Effort**: M — **Risk**: LOW — **Depends on**: 023, 023b (so link targets/titles are final) — **Category**: seo/onpage
- **Planned at**: commit `8cd6d32`, 2026-06-24

## Why this matters
Audit + diagnosis: `/calculator` has **2 internal links** vs competitors' **80+**; money pages are near-orphaned and we don't flow equity or build topical authority. Best content (collections-knife post) barely links into the product. Internal linking is the cheapest authority lever fully in our control.

## Current state (verify)
- `src/components/SiteFooter.tsx` — global footer (rendered on React pages). Likely thin. The competitor pattern is a footer hub of categorized internal links (tools, top collections, popular skins, guides).
- Crawler HTML: footer/links must ALSO appear in server-rendered crawler HTML (footer in React won't be in the static crawler bodyHtml for /calculator, /trade-ups, /skins, collection/skin pages). Check `server/seo.ts buildSeoHtml` template — does it include a shared footer block? If not, add a shared crawler-footer link hub there so every crawler page carries it.
- Collection pages (`server/index.ts:214`), skin pages (`:605`), trade-ups hub (`renderTradeUpsHub`), collections hub (`renderCollectionsHub` seo.ts:181) — candidates for contextual cross-links.

## Commands
`npm run typecheck` / `npm run test:unit` / `npm run build` green; build before test:unit.

## Scope
**In scope**: `src/components/SiteFooter.tsx` (React footer hub), `server/seo.ts` (shared crawler-HTML footer link hub in buildSeoHtml so crawler pages carry the same links), contextual cross-links in `renderTradeUpsHub`/`renderCollectionsHub`/skin+collection handlers (`server/index.ts`/`seo.ts`), blog post bodies linking to relevant collections/skins/calculator (`src/data/blog-posts.ts`), tests.
**Out of scope**: nav restructure, new pages (025), schema (023), pricing logic. Don't over-link (keep ≤~100 links/page; descriptive anchors, no keyword stuffing).

## Steps
### Step 1: Footer hub (React + crawler parity)
Build a categorized footer hub: **Tools** (Calculator, Trade-Ups, Skins, Listing Sniper), **Top Collections** (~8–12 highest-value collection pages), **Popular Skins** (~8–12), **Guides** (the blog posts). Use descriptive anchors ("Dreams & Nightmares trade-ups", not "click here"). Implement in `SiteFooter.tsx` AND ensure the same link set is in the crawler HTML (shared block in `buildSeoHtml`, or a server constant rendered into both). The "top" lists can be a curated static array (avoid per-request DB cost; revisit if dynamic needed).
**Verify**: build; `curl -A Googlebot` on /calculator, /trade-ups, a skin page → footer links present; React pages render the footer.

### Step 2: Contextual cross-links on money/hub pages
- `/calculator` ↔ `/trade-ups` ↔ `/skins` mutual links (some exist from 022/023 — ensure all three interlink).
- Trade-ups hub → top collection pages; collections hub → top collections; collection page → its skins + the calculator; skin page → its collection + calculator.
- Keep anchors descriptive + relevant.
**Verify**: build; spot-check each page type has ≥5 relevant internal links.

### Step 3: Blog → product/topical links
In `src/data/blog-posts.ts`, ensure each post links to the specific collections/skins/calculator it discusses (beyond the 022 CTA). E.g. the collections-knife post links to each collection page it names. Mirror any metadata changes in blog-meta.ts (only if title/excerpt change — body links don't).
**Verify**: build; internal-cross-linking.test.ts green (it asserts blog↔page links — extend if needed).

### Step 4: Full gate
`npm run typecheck && npm run test:unit && npm run build` green.

## Done criteria
- [ ] Footer hub (categorized, descriptive anchors) live in BOTH React and crawler HTML on all page types
- [ ] /calculator has ≥15 internal links (up from 2); money pages mutually interlinked; collection/skin pages cross-link
- [ ] Blog posts link to the specific collections/skins they discuss
- [ ] typecheck/test:unit/build green; only in-scope files modified; no page exceeds ~100 links

## STOP conditions
- `buildSeoHtml` has no shared footer slot and adding one risks the verify-seo-html structure — add minimally and confirm the gate passes; report if it breaks twice.
- A curated "top collections/skins" list would 404 if a slug is wrong — verify each linked slug resolves 200 before shipping.

## Maintenance notes
- Keep the curated footer lists fresh quarterly (or make dynamic later).
- New blog posts should link to the entities they mention.
