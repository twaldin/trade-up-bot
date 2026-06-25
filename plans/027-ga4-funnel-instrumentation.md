# Plan 027: GA4 funnel instrumentation — key events, conversion/revenue, click params, ?ref attribution

> **Executor instructions**: Follow step by step with verification. STOP conditions binding. Reviewer maintains plans/README.md.
>
> **Drift check (run first)**: `git diff --stat 8cd6d32..HEAD -- index.html src/ server/auth.ts server/routes/stripe.ts server/db.ts`

## Status
- **Priority**: P1 (we're flying blind — everything downstream needs measurement) — **Effort**: M — **Risk**: LOW-MED (adds tracking + one nullable DB column) — **Depends on**: none — **Category**: analytics/growth
- **Planned at**: commit `8cd6d32`, 2026-06-24

## Why this matters
GA4 (`plans/notes/round3-growth-kpis-2026-06-24.md`): the property has **zero key events**, **revenue reads $0** (Stripe not wired to GA despite 2 Pro sales), and click events carry **no parameters**. We can't see the funnel. Until this lands, every channel/conversion claim is a guess. This makes activation (the real problem per `retention-vs-activation-2026-06-24.md`) and organic→signup measurable, and underpins the referral system for creator outreach.

## Current state (verified 2026-06-24)
- GA4 tag `G-EKWRB4FE37` loaded in `index.html:19-24` (gtag.js + default config). No custom events anywhere (grep `gtag(` → only index.html bootstrap).
- Steam auth start: `server/auth.ts:260 app.get("/auth/steam", …)` → `passport.authenticate("steam")`; callback `/auth/steam/callback` (auth.ts:229). New users inserted into `users` (columns: steam_id, display_name, tier, stripe_customer_id, created_at, …). **No `signup_ref` / attribution column.**
- Stripe: `server/routes/stripe.ts` (checkout + webhook). Purchase success is server-side (webhook) — GA purchase event needs either Measurement Protocol (server) or a client event on the post-checkout return page.
- `server/db.ts createTables` — schema changes MUST bump `SCHEMA_VERSION` (prod skips otherwise).

## Commands
`npm run typecheck` / `npm run test:unit` / `npm test` (integration, tradeupbot_test) / `npm run build`. Build before test:unit.

## Scope
**In scope**: a small client analytics helper `src/lib/analytics.ts` (typed `trackEvent` wrapper around gtag, no-op if gtag absent); event calls at key actions (signup success, calculator run, trade-up detail view, checkout start); `?ref`/referrer capture at `/auth/steam` start persisted to a new `users.signup_ref` column (+ `SCHEMA_VERSION` bump + migration); Stripe→GA purchase event (client event on checkout-return page, or Measurement Protocol in the webhook — choose the lower-risk client option first); a referral-code passthrough (store `?ref=<code>` so creator links attribute). Tests.
**Out of scope**: a full referral payout system (later); GA dashboard config (operator does in GA UI — document which key events to mark); changing auth/Stripe core logic.

## Steps
### Step 1: Typed analytics helper
`src/lib/analytics.ts`: `export function trackEvent(name: string, params?: Record<string, string|number|boolean>)` that calls `window.gtag?.("event", name, params)` guarded for SSR/absence. No `as any` — declare a minimal `gtag` type. Unit-test it (no-op when gtag undefined; forwards args when present, via a stub).
**Verify**: typecheck + unit test green.

### Step 2: Fire key events (client)
Instrument: `sign_up_start` (Steam button click — in ProductCTA + SiteNav signin), `calculator_run` (when the calculator computes a result in CalculatorPage), `tradeup_view` (trade-up detail open), `begin_checkout` (Pricing upgrade click). Use stable event names. Parameterize clicks with a `location`/`variant` param so we can see WHAT converts.
**Verify**: build green; grep shows trackEvent calls at the 4 sites.

### Step 3: `?ref` / referrer attribution → users table
- Add nullable `signup_ref TEXT` to `users` in `server/db.ts createTables` + **bump SCHEMA_VERSION** + idempotent `ALTER TABLE … ADD COLUMN IF NOT EXISTS`.
- At `/auth/steam` start (auth.ts:260), read `req.query.ref` (creator code) or fall back to `req.get('referer')`, stash in the session; on first insert in the callback, persist to `users.signup_ref`.
- Integration test (tradeupbot_test): hitting the start with `?ref=foo` then completing insert stores `signup_ref='foo'` (mock the passport identity per existing auth test patterns; if none, assert the helper that extracts+persists ref in isolation).
**Verify**: `npm test` green; column present.

### Step 4: Stripe → GA purchase event
Lower-risk path: on the post-checkout **return page** (Stripe success redirect target), fire `gtag('event','purchase',{value, currency:'USD', transaction_id})` once, reading the tier/price from the return context. (Avoid double-counting — fire only on the success route, ideally guarded by a session flag.) If a clean client signal isn't available, fall back to Measurement Protocol from the webhook (needs GA API secret in env — document it). Pick one; document which.
**Verify**: build green; the success route fires exactly one purchase event (unit/integration as feasible; manual note for the operator to confirm in GA Realtime).

### Step 5: Full gate
`npm run typecheck && npm test && npm run build` green.

## Done criteria
- [ ] `analytics.ts` helper + 4 key events firing with params (no `as any`)
- [ ] `users.signup_ref` column (SCHEMA_VERSION bumped) populated from `?ref`/referrer at signup
- [ ] purchase event wired (client success route or Measurement Protocol), documented which, no double-count
- [ ] tests green (incl. attribution integration); only in-scope files modified
- [ ] Operator note: which events to mark as Key Events in the GA UI

## STOP conditions
- The Stripe success redirect target can't carry the purchase value safely (e.g. no return page) — implement the webhook Measurement Protocol path instead and document the env var; do not guess values.
- Adding the column without bumping SCHEMA_VERSION (prod would skip the migration) — never do this.

## Maintenance notes
- Operator (GA UI, one-time): mark `sign_up_start`, `purchase`, `begin_checkout` as Key Events; build a funnel exploration. After this lands, GA becomes worth mining (browser-driving GA is then useful).
- `signup_ref` is the foundation for creator-link attribution (off-site plan) and the organic→signup KPI.

## MUST-FIX before executing (codex adversarial review, 2026-06-24)
1. **`?ref` is lost before `/auth/steam`** — auth links don't forward the page query (`LandingPage.tsx:64`, `SiteNav.tsx:224`, `App.tsx:339`, `ProductCTA.tsx:67`). A creator link `/?ref=foo` → sign-in becomes `/auth/steam` with no ref. **Add client-side capture**: on first load, read `?ref`, persist to localStorage/cookie, and append it to every Steam auth link (or a shared auth-link helper) so it reaches the server.
2. **SteamStrategy can't see `req`** — `passport.use(new SteamStrategy(...), cb)` lacks `passReqToCallback: true` (`auth.ts:228,232`); the user insert is inside that callback (`auth.ts:240`). Either enable `passReqToCallback: true` (typed) and read `req.session.signupRef`, OR persist the ref AFTER `passport.authenticate` returns the user. Callback route is `auth.ts:268` (the `:229` ref in the plan is the returnURL — drift).
3. **`users` table is created in THREE places** — `server/db.ts` (createTables), `server/auth.ts:116` (its own CREATE TABLE), and `tests/integration/setup.ts:195` (test helper). Add `signup_ref` to ALL THREE + bump `SCHEMA_VERSION` + idempotent ALTER. Missing any one breaks prod or tests.
4. **Stripe client purchase is spoofable/undeduped** — success redirect is just `/?upgraded=${plan}` (`stripe.ts:50,55`), no session id/amount; `/?upgraded=pro` can be forged. Choose ONE: (a) change `success_url` to include `{CHECKOUT_SESSION_ID}` and retrieve verified session details server-side before firing, or (b) **webhook Measurement Protocol** (server-side, needs GA API secret env var). Prefer (b) for trust; document the env var.
5. **Event placement** — `ProductCTA` primary/secondary are normal links; only the 3rd is Steam (`ProductCTA.tsx:66`). Other sign-in entry points omitted: `LandingPage.tsx:64`, `App.tsx:421`, `TradeUpSharePage.tsx:197`. **Define a shared auth-link/CTA helper** and instrument there, or enumerate every site exactly.
6. **Test guidance is wrong** — integration setup bypasses Steam auth (`setup.ts:1`); there's no passport-mock pattern. Extract the ref-extract-and-persist logic into a pure helper and unit-test that in isolation (don't try to mock the full Steam flow).
