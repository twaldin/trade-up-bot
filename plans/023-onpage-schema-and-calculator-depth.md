# Plan 023: JSON-LD schema on bare pages + /calculator depth & float-exact demo

> **Executor instructions**: Follow step by step with verification. STOP conditions binding. Reviewer maintains plans/README.md.
>
> **Drift check (run first)**: `git diff --stat 8cd6d32..HEAD -- server/static-seo-pages.ts server/seo.ts`
> Expected empty. Compare excerpts if drifted.

## Status
- **Priority**: P1 — **Effort**: M — **Risk**: LOW (additive schema + crawler-HTML content) — **Depends on**: none — **Category**: seo/onpage
- **Planned at**: commit `8cd6d32`, 2026-06-24

## Why this matters
Audit (`plans/notes/seo-audit-report-2026-06-24.md`): `/calculator`, `/faq`, `/pricing`, `/skins` emit **zero JSON-LD** (verified via Googlebot curl). `/faq` with no FAQPage schema and `/calculator` (the money page) with no SoftwareApplication/FAQPage are the worst. Skin detail pages already carry Product/AggregateOffer/FAQPage — replicate that quality. Schema drives rich results AND the rising "AI Assistant" citation channel (GA: 12 new users/28d from AI assistants). Separately, `/calculator` crawler HTML is thin vs competitors (~3,000 words) — and must carry the **float-exact-vs-condition-pricing** differentiator (`plans/notes/positioning-float-accuracy-2026-06-24.md`), our verified moat.

## Current state (verified 2026-06-24)
- `server/seo.ts:120 buildSeoHtml(meta)` already accepts `meta.jsonLd` (single or array) and emits `<script type="application/ld+json">` (seo.ts:128-130). **The mechanism exists; static pages just don't pass jsonLd.**
- `server/static-seo-pages.ts:8 STATIC_SEO_PAGES[]` defines `/calculator`, `/faq`, `/pricing` entries with `path/title/description/bodyHtml` — **no `jsonLd` field**. `/calculator` bodyHtml already has 4 h2s + FAQ text (plan 014) but no schema and modest depth.
- `/skins` hub crawler HTML: locate its handler (likely `server/index.ts` `/skins` branch) — no schema.
- Skin detail (`/skins/:slug`) emits BreadcrumbList + Product + AggregateOffer + FAQPage — the reference pattern.
- `floatToCondition` + `CONDITION_BOUNDS` from engine; fees from `server/engine/fees.ts` (CSFloat 2%/2.8%+$0.30, DMarket 2%/2.5%, Skinport 8%/0%). Any number in content MUST match fees.ts.

## Commands
`npm run typecheck` / `npm run test:unit` / `npm run build` (all green; verify-seo-html passes). Build once before test:unit (dist/ dep).

## Scope
**In scope**: `server/static-seo-pages.ts` (add `jsonLd` to /calculator, /faq, /pricing entries; expand /calculator bodyHtml); the `/skins` hub handler (add CollectionPage/ItemList jsonLd + a schema check) wherever it lives (`server/index.ts` or a route); `server/seo.ts` ONLY if a typing tweak is needed to thread jsonLd through static pages; tests.
**Out of scope**: skin detail / collection / blog / trade-ups schema (already present); pricing logic; React components; cannibalization/titles (plan 023b).

## Steps
### Step 1: Schema on /calculator
Add to the `/calculator` STATIC_SEO_PAGES entry a `jsonLd` array: (a) `SoftwareApplication` (name "TradeUpBot CS2 Trade-Up Calculator", applicationCategory "UtilityApplication"/"GameApplication", operatingSystem "Web", offers Price 0 / free, url `https://tradeupbot.app/calculator`), (b) `FAQPage` built from the FAQ Q/As already present in the bodyHtml (extract verbatim — body and schema must match, Google requires visible parity), (c) `BreadcrumbList` (Home → Calculator). Verify the existing FAQ text in bodyHtml; schema answers must equal visible answers.
**Verify**: `npm run build`; `curl -s -A Googlebot localhost:3001/calculator` (boot server, `SKIP_STARTUP_MIGRATIONS=1` ok) OR grep the static page source → contains `"@type":"SoftwareApplication"` and `"@type":"FAQPage"`.

### Step 2: Schema on /faq
Add `FAQPage` jsonLd to the `/faq` entry, built from its on-page Q/As (parity required), plus `BreadcrumbList`. If `/faq` content lives in a React page not the static bodyHtml, add the schema to the static crawler entry that serves /faq to bots (mirror how /calculator is served).
**Verify**: build; `/faq` crawler HTML contains `"@type":"FAQPage"`.

### Step 3: Schema on /pricing
Add jsonLd to `/pricing`. **CORRECTED PRICING (codex-verified against src/pages/PricingPage.tsx + server/routes/stripe.ts):** there is NO Basic tier. Live offers: **Free $0**, **Pro $6.99/mo**, **Pro yearly $59.99/year** (shown as ~$5/mo), **Pro lifetime $74.99**. Stripe checkout supports `pro`, `pro-yearly`, `pro-lifetime` (`basic` is grandfathered-only in webhook mapping, NOT a current offer). Emit `Offer`s for the real tiers only — never the false $5/$15. priceCurrency USD. Include `BreadcrumbList`. Read PricingPage.tsx + stripe.ts and use those exact numbers.
**Verify**: build; `/pricing` crawler HTML `"@type":"Offer"` prices === the live tiers (6.99/59.99/74.99), no invented prices.

### Step 4: Schema on /skins hub + (light) depth
Find the `/skins` hub crawler handler. Add `CollectionPage` + `ItemList` jsonLd (the listed skins as ItemList elements) + `BreadcrumbList`. Keep it consistent with the collection page's ItemList shape.
**Verify**: build; `/skins` crawler HTML contains `"@type":"ItemList"`.

### Step 5: /calculator depth + float-exact narrative
Expand the `/calculator` bodyHtml toward ~1,200–1,800 words by ADDING (do not remove existing): an h2 **"Why most CS2 trade-up calculators are wrong"** explaining condition-average vs float-exact output pricing (a 0.002 Factory New ≠ a 0.06 Factory New; competitors price the output at condition average, TradeUpBot prices the exact predicted float via real sales) — make the MECHANISM claim, no unverified per-competitor accusations; a worked example with real numbers consistent with fees.ts; an h2 linking to specific collections/skins (internal links). Keep the single-template-string style. This also feeds the "calculator wrong" query cluster + AI citations.
**Verify**: build; verify-seo-html passes; word count up; new internal links present.

### Step 6: Full gate
`npm run typecheck && npm run test:unit && npm run build` green. Add/extend a unit test (source-string style, e.g. `tests/unit/seo-pages.test.ts`) asserting /calculator+/faq+/pricing+/skins carry their expected `@type`s.

## Done criteria
- [ ] /calculator (SoftwareApplication+FAQPage+BreadcrumbList), /faq (FAQPage), /pricing (Offer×2), /skins (ItemList) all emit JSON-LD in crawler HTML
- [ ] FAQ schema answers match visible answers verbatim (parity)
- [ ] /calculator bodyHtml expanded with float-exact narrative + worked example (numbers match fees.ts) + internal links
- [ ] New test asserts the @types; typecheck/test:unit/build green; only in-scope files modified

## STOP conditions
- The /faq or /skins crawler HTML is generated somewhere other than static-seo-pages.ts and threading jsonLd needs a signature change beyond a small typing tweak — report the actual path.
- Any fee/number in new content contradicts `server/engine/fees.ts` — STOP, use fees.ts.

## Maintenance notes
- Validate post-deploy with Google Rich Results Test (renders JS; the audit skill flags curl can miss schema — but our SSR emits it, so curl is reliable here).
- New static pages should pass `jsonLd`; the builder already supports it.

## MUST-FIX before executing (codex adversarial review, 2026-06-24)
1. **`StaticSeoPage` has no `jsonLd` field** — `buildSeoHtml` supports jsonLd, but the static route (`server/index.ts:~1138`) passes only title/description/url/bodyHtml. Add a `jsonLd?` field to the `StaticSeoPage` interface AND thread `staticPage.jsonLd` into the buildSeoHtml call. Without this, nothing emits.
2. **`/faq` static crawler body has NO Q/A pairs** (`server/static-seo-pages.ts:~34`, generic paragraphs only). The React `FaqPage.tsx` has its own FAQPage schema + visible Qs, but crawlers get the STATIC route. Mirror the visible FAQ Q/As into the static `/faq` bodyHtml FIRST, then add crawler FAQPage schema (parity is mandatory) — or skip FAQPage for /faq.
3. **Pricing corrected inline above** — no Basic/$5/$15; use 6.99/59.99/74.99 from PricingPage.tsx + stripe.ts.
4. **ItemList pattern reference is wrong** — `/collections/:slug` has CollectionPage only; the ItemList example lives at `/trade-ups/collection/:slug` (`server/index.ts:~328`). Copy that pattern for /skins.
5. **`/skins` crawler HTML is Redis-cached** under key `seo_skins_list` (3600s, `server/index.ts:~1100`). Bump the cache key (or clear that key on deploy) or schema verification falsely fails until TTL expiry.
6. **fees.ts also includes Buff** (buyer 3.5%+$0.15, seller 2.5%, `fees.ts:8`). Any "all marketplace fees" wording in Step 5 must include Buff OR scope the sentence to "the marketplaces shown."
7. **No SCHEMA_VERSION bump** — this plan touches no `createTables`; state explicitly there is no DB migration.
