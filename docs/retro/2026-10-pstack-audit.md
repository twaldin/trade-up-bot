# pstack audit, October 2026

Tree `d6b21a3` on 2026-10-07. Production deploy of that tree was confirmed by the QA live sweep (bundle `index-Co1S_JBH.js`, homepage last-modified Mon 05 Oct 2026). This pass adds the verification skill and this plan. It does not change prices, plans, the score formula, fee math, or rate-limit values.

Three reviews are cited and not redone.

- Autoresearch code audit, 2026-10-06, tree `d6b21a3e2f9d4b0bbc13049c2ea089644066797f`. Code only. Schema `2026-10-02.4`. Counts in that document are 1 P0, 9 P1, 8 P2.
- QA live sweep, 2026-10-06, prod `d6b21a3e`. 230 read-only requests, 0 organic 5xx, 0 rate limits. That document counted 0 P0, 1 P1, and 12 P2. The P1 (F-07) was later refuted in GA4 Realtime and is not in the counts below.
- Frontend first-session teardown, 2026-10-06, prod `d6b21a3e`, guest only, 1280 and 390. That document counted 3 P0, 5 P1, and 12 P2. Screenshots are in `reviews/pstack-frontend-audit-2026-10-06/`. Blog and canonical items it lists as already known are the copy and skin-canonical findings in this report, so they are not counted again.

Labels used below. **Observed-live** means this run, the QA sweep, or the Frontend teardown saw it on tradeupbot.app. **Code-only** means the file was read and production was not exercised for that path. Daemon findings stay code-only. Prod is not claimed fixed.

## Counts

| Bucket | Count | What is included |
| --- | --- | --- |
| P0 | 6 | Banned public copy, skin canonical after a client click, merge-batch deadlock (PR 194, in flight), mobile trade-up header, claim pop-up with no Pro step, SEO pages whose main button is raw Steam sign-in |
| P1 | 16 | Autoresearch AR-P1-1 through AR-P1-9, two GA4 properties on one page, `sign_up` under-firing, internal traffic in GA4, the untracked "Find Real Tradeups" click, upgrade clicks PR 193 does not cover, the unsaved activation funnel, and the calculator dead end |
| P2 | 29 | Autoresearch AR-P2-1 through AR-P2-8, QA F-01 F-02 F-03 F-04 F-05 F-06 F-12 F-13, list-cache keys, Redis `commandTimeout`, the detail tier header, the board hub without ItemList, plus nine Frontend items (empty board peek, blank skin art, filler copy, pricing card order at 390, pricing copy accuracy, pricing resume after sign-in, masked landing errors, intent rows labelled only by id, footer separators) |

F-08 through F-11 are the same copy slice as the P0 posts. They are not a second set of findings. The teardown's two-property P1 is the GA4 split already in this table. Its tap-target P2 is F-05. Its board-sort P2 is part of the SEO-button P0. Its ad-safe scan found no new banned phrase, so it adds no finding. Several seed items were refuted and are listed under the seed checklist so they are not in these counts.

## P0

### Banned public copy

Observed-live. Googlebot HTML for these posts is HTTP 200 and still uses the banned framing. The approved metric wording is "share of outcomes above cost".

- `https://tradeupbot.app/blog/cs2-trade-up-calculator-guide/` contains "chance-to-profit", "finishes green", and "bankroll".
- `https://tradeupbot.app/blog/profitable-trade-ups-theory-vs-reality/` contains "100% chance to profit".

The shipped bundle `index-Co1S_JBH.js` contains those phrases and also "Win rate · ". Signed-in My trade-ups was not opened. The label is in `src/preview/pages/PreviewAccount.tsx` at the Win rate span, and the legacy page `src/pages/MyTradeUpsPage.tsx` still has "Win Rate:". QA F-11 confirms the two posts are unchanged. QA F-08 through F-10 add the rest of the sweep.

Same slice, same wording.

- `server/routes/llms.ts` and live `https://tradeupbot.app/llms.txt`. "chance-to-profit" and "chance to profit". "nothing is guaranteed" stays.
- `src/data/blog-posts.ts` post `cs2-trade-up-probability-expected-value`. "$4 guaranteed profit" and "mild gamble".
- Post `how-to-use-tradeupbot`. "will win most of the time" and "safer bet".
- Post `best-cs2-trade-up-simulator`.
- "odds" in `best-cs2-collections-knife-trade-ups-2026`, `how-cs2-trade-ups-work`, and `why-cs2-trade-up-calculators-disagree` (including JSON-LD).
- Discord command and embed strings that say "chance to profit".
- Legacy pages that still ship inside the client bundle (`FaqPage`, `PricingPage`, `CalculatorPage`, `TradeUpSharePage`, `TradeUpTable`).

`tests/unit/banned-copy.test.ts` scans `src/preview` and a short server list. It does not scan `src/data/blog-posts.ts`. The allowlist still contains "Win rate", which is why the account label stays green. Negated lines "never guaranteed" and "not guaranteed" stay allowed. Do not rename the database column `chance_to_profit`. Do not edit engine comments in this slice.

The free board is delayed 3 hours, so two labels overstate it. The board heading defaults to "Live trade-ups" in `src/preview/pages/PreviewBoard.tsx`. The nav CTA is `PREVIEW_CTA_PRIMARY` ("Find Real Tradeups ->") in `src/preview/lib/copy.ts`, rendered from `PreviewChrome`. The same CTA is hardcoded in `src/preview/pages/PreviewPricing.tsx` and `server/static-seo-pages.ts`. Make them honest. "Trade-ups" and "Find trade-ups" are the examples. Keep a delayed-view note where a surface does not already say the free list is 3 hours behind. The board already has that banner, so do not add a second one there.

PR 193 (`cursor/free-paid-conversion-1406`) already edits `src/preview/lib/copy.ts`, `src/preview/pages/PreviewBoard.tsx`, `src/preview/pages/PreviewPricing.tsx`, and `src/preview/pages/PreviewLanding.tsx`. Leave those files alone until 193 merges, then rebase this copy PR onto that result. `server/static-seo-pages.ts` is not in 193.

User impact is ad and SEO copy that the review already banned, plus a free-tier promise the delay makes false. Blast radius is content, `llms.txt`, Discord user strings, the account label, the board heading, and the primary nav CTA. One Frontend PR. Extend the banned-copy test so the next agent cannot land the phrases again. Update the tests that pin "Find Real Tradeups".

### Skin canonical after a client click

Observed-live. A direct GET of `/skins` and `/skins/ak-47-redline` has the right canonical for both user agents. After clicking `a.preview-skin` from `/skins` to `/skins/mp5-sd-neon-squeezer`, the h1 and title update and the canonical stays `https://tradeupbot.app/skins`.

`PreviewSkinPage` in `src/preview/pages/PreviewSkins.tsx` sets `<title>` and does not call `useCanonicalSlot` for `https://tradeupbot.app/skins/${slug}`. The collections page in the same file does. One Frontend PR.

### Merge-batch deadlock exits the daemon

Code-only. AR-P0-1. A 40P01, or any non-connection database error, in the Phase 5 merge update kills the process. `server/engine/db-save.ts` update batch uses `withRetry` without lock handling and sets `listing_status = 'active'`. `isTransientDbError` in `server/engine/utils.ts` does not treat 40P01, 55P03, or 57014 as transient. `mergeTradeUps` at `server/daemon/index.ts` is outside try/catch. `server/daemon.ts` calls `process.exit(1)`. A pm2 restart drops the in-memory `queuedMergeBatches`.

This is in flight as [PR 194](https://github.com/twaldin/trade-up-bot/pull/194) on `cursor/merge-deadlock-retry-f431` ("Retry merge-update deadlocks so the daemon stays up"). Autoresearch has signed it. It is waiting on QA isolation. Do not open a second PR for the same deadlock.

### Trade-up header breaks at 390

Observed-live in the Frontend teardown, on `/trade-ups/781571674` at 390 by 844. The title sits in a column about 130px wide, Copy link is clipped at the right edge, and "Verify or claim this trade-up" starts near y 598. `.preview-page__meta` sets `flex-shrink: 0` in `src/preview/preview.css` (the meta rule under `.preview-page__head`). That meta row does not shrink, so the title column collapses. There is no document-level horizontal overflow, which is why a page overflow check misses it.

User impact is every phone visitor who opens a trade-up from the board. Blast radius is that header. One Frontend PR. Under `max-width: 599px`, let `.preview-page__head` wrap and let `.preview-page__meta` shrink, wrap, and take the full width. Playwright at 390 by 844 on a live id. The title is at least 320px wide, Copy link is fully on screen, and the main button sits inside the first 450px. Desktop screenshots of the board, pricing, and calculator headers stay unchanged. `preview.css` is also on PR 193, so rebase onto main after that PR merges before editing the file.

### Claim pop-up has no Pro step

Observed-live. The claim dialog says Verify and Claim are Pro, then its only button is Continue with Steam, and the next line says the guest comes back to this trade-up. The Free return still has no Verify and no Claim. Upgrading is a second trip through Pricing. The current upgrade control is a small "Compare plans" text link. PR 193 adds a delay sentence on the share panels and leaves this dialog alone. `upgrade_cta_click` arrives in 193.

User impact is the path from a guest trade-up to checkout. Blast radius is `src/preview/lib/steam-interstitial.ts`, `src/preview/components/SteamInterstitial.tsx`, and the upgrade id in `src/lib/conversions.ts`. One Frontend PR, based on main after PR 193 merges. Add a visible "See Pro plans" button at least 44px tall that fires `upgrade_cta_click`. The copy says plainly that Verify and Claim need Pro, and it uses the price string already shown on the pricing page. The price stays as it is. The Continue with Steam href stays byte-identical. Hillclimb metric is `upgrade_cta_click`.

### SEO pages send the main button to Steam

Observed-live on `/best-cs2-trade-ups`, `/trade-ups/tiers`, and `/trade-ups/tiers/covert`. The lime primary is a raw Steam sign-in. It skips the pop-up. The return path is `/trade-ups` rather than the page the visitor was on. A Free account still cannot verify or claim. "Open the live board" is the secondary action and lands on the default Score sort, so the table the visitor just read is not the board they land on. PR 193 adds See Pro plans as a third button and keeps raw Steam as the primary. The page file is `src/preview/pages/PreviewIntent.tsx`.

User impact is the first action on the indexable intent pages. Blast radius is that page. One Frontend PR, rebased after PR 193. The main button goes to Pro or opens the pop-up, and Steam returns to the page the visitor came from. The intent block's controls are at least 44px at 390.

## P1 measurement

### `sign_up` under-fires

Observed-live for the client half, on 2026-10-07, with Google collect blocked so the property was not incremented. Loading `/?auth=new` queued exactly one `sign_up` with `send_to` `G-2474G4P5QE`. The address bar no longer contained `auth`. A reload queued zero `sign_up`. `/?auth=return` queued `login` and did not queue another `sign_up`. `/api/auth/me` was `null` while that `sign_up` was queued. Evidence is `signup.json` from the verification driver.

The property G-2474G4P5QE shows `sign_up` first on Oct 1 and once across Oct 1 to 6, against 666 sessions, while there are paying subscribers. The code path explains the gap.

1. Steam OpenID returns through `GET /auth/steam/callback` in `server/auth.ts`. The upsert is `INSERT ... ON CONFLICT DO UPDATE ... RETURNING (xmax = 0) AS inserted`. `just_created` is that boolean. There is an integration test that the flag is true on the first insert and false on the repeat.
2. `authReturnLocation` in `server/tracking/registration.ts` appends `auth=new` only when that flag is true and `browserTrackingOn(env)` is true. Otherwise the redirect is the bare return path. `browserTrackingOn` is true only when the API process has `GA4_MEASUREMENT_ID` or `META_PIXEL_ID`. Deploy sets `GA4_MEASUREMENT_ID` on the Vite build step in `.github/workflows/deploy.yml` and does not pass it into `pm2 reload`. Whether the VPS process has the variable was not read. If it does not, real new accounts never receive `auth=new`.
3. The head strip in `index.html` and `shared/auth-return-strip.ts` copies `auth` and `lid` onto `window.__tubAuthReturn` and removes them from the URL before gtag config. `consumeAuthReturn` does not read `location.search`. A document without that strip drops the signal forever.
4. `App` then fetches `/api/auth/me` and calls `trackAuthReturn("sign_up")` whenever the stash says `new`, including when `me` is null. `/api/auth/me` returns steam id, tier, and avatar. It has no new-account field and nothing is consumed server-side. A refresh cannot retry.
5. There is no consent gate. The gtag stub in `index.html` exists before the module. A module on the live page can see `gtag` (`typeof gtag === "function"`). A missing gtag function is not the drop on this build.
6. There is no server-side GA4 `sign_up`. Meta CompleteRegistration is a different pipe, and the pixel is unset in prod.

Fire `sign_up` exactly once per newly created account, using a server-side signal that is consumed once (auth return or `/api/auth/me`). A returning login stays `login`. An unauthenticated `?auth=new` must not count. Add a unit or integration test. The skill command `signup` already fails on the missing server flag. This fix ships in the measurement PR at the front of wave 1, with the legacy-tag retirement and the `cta_click` ids. `server/auth.ts` and `src/lib/conversions.ts` are on PR 193, so those hunks rebase after 193 merges. Interstitial events need no beacon or `event_callback` change. Two live Go Pro then Continue with Steam runs at 9:52 PM PT showed `pro_interstitial_view` 2, `steam_continue` 2, and `sign_up_start` 2 in GA4 Realtime for G-2474G4P5QE. The earlier capture that saw those events only on the legacy property was a QA harness artifact.

### Internal traffic in GA4

Direct traffic jumped to 631 sessions in six days. QA and this run both drive production from headless browsers. This run's pricing command loaded `/pricing` before collect was blocked. Later driver commands block `google-analytics.com`, `analytics.google.com`, and `googletagmanager.com`.

One Frontend slice. When the user agent contains `HeadlessChrome` or `TradeUpBotVerify`, every gtag event includes `traffic_type: "internal"`, which the GA4 Internal Traffic filter excludes. The verification driver already sends `TradeUpBotVerify`, sets a `tub_internal` cookie, and adds `tub_internal=1` on browser navigations. A normal browser that only has the query param must not be tagged, so a copied link does not mark a person. Deploy smoke curls and `scripts/board-network-qa.mjs` now send the verification user agent. Prices and plans stay as they are.

### Two GA4 properties on one page

Observed-live. Homepage HTML contains hardcoded `G-EKWRB4FE37` in `index.html` and injected `G-2474G4P5QE` in `window.tubTracking`. The Frontend teardown saw `page_view` on both properties. `sendGa4` events, including `cta_click`, `sign_up`, `login`, `begin_checkout`, and `claim_trade_up`, go to G-2474 only. `trackEvent` calls without `send_to` (`pro_interstitial_view`, `steam_continue`, `sign_up_start`, `interstitial_dismiss`) go to both properties.

CEO decision. `G-2474G4P5QE` is the single canonical property. The GA4 account does not contain `G-EKWRB4FE37`, so that tag has no readers and it splits the event stream. Retire the hard-coded tag in `index.html` in the measurement PR now. Every event goes to G-2474, including `page_view` and the sign-in pop-up events. After the change, one page load records one `page_view` on that property. Leave the tag in place in this audit PR.

`trackSpaPageView` sends only a pixel page view. GA4 history hits depend on the property's enhanced measurement. That admin setting was not opened. A missing SPA `page_view` stays unfiled until that setting is checked.

### "Find Real Tradeups" fires no event

Observed-live. The hero, the sticky nav, the live section, the peek section, and the pricing footer navigate with a SPA `page_view` and no `cta_click`. "Try the calculator" is the control that already fires `cta_click` with `home_hero_calculator`.

Same measurement PR, no visible change. Extend `CtaId` in `src/lib/conversions.ts` with `home_hero_board`, `nav_board`, `home_live_board`, `home_peek_board`, and `pricing_board`. Wire `onClick` in `PreviewLanding.tsx`, `PreviewChrome.tsx`, and `PreviewPricing.tsx`. The honest-label copy PR may rename the visible string later. These ids stay on the control. `conversions.ts`, `PreviewLanding.tsx`, and `PreviewPricing.tsx` are on PR 193. `PreviewChrome.tsx` is not. Rebase the 193 files after that PR merges.

### Upgrade clicks PR 193 does not cover

193 covers board See Pro, redacted View Plans, the landing hero See Pro, the share upgrade panel, intent See Pro, and pricing Go Pro. Still open after that. The landing Pro tile "Compare plans", the Free user's share-header Verify chip (a full document load to `/pricing`, currently counted as `verify_click`), and the nav and footer Pricing links. The interstitial "Compare plans" control is the claim-pop-up P0.

A later Frontend PR, after 193, adds `upgrade_cta_click` ids `landing_plan_tile`, `share_bar`, and `nav_pricing`, and turns the share-bar upgrade anchor into a client `Link`.

### No saved activation funnel

Claim is Pro-only, so a first session cannot move `claim_trade_up` inside a test window. The steps exist in code. `verify_click`, `claim_interstitial_view`, `steam_continue` or `sign_up_start`, `sign_up`, `upgrade_cta_click`, `begin_checkout`, purchase, then `claim_trade_up`. There is no saved funnel, so the P0 flow fixes have no named intermediate readout.

No code PR. The CEO saves that funnel exploration in G-2474G4P5QE, seven days, Pacific time. Each slice names its own hillclimb step. The claim pop-up uses `upgrade_cta_click`. The SEO pages use the intent `cta_click` and `upgrade_cta_click`.

### Calculator example ends with nowhere to go

Observed-live. Load example evaluates to about -$0.33 expected P/L (ten Zeus x27 | Olympus inputs, 50% of outcomes above cost) and then offers no next action. `calculator_complete` does fire on G-2474. The preferred example id is `PREFERRED_EXAMPLE_TRADE_UP_ID` in `shared/calculator-example.ts`.

This waits for the trust slice. Pick an example that shows the tool honestly, and add a next step to live trade-ups. Fee math and the EV formula stay as they are.

`begin_checkout` is gated in `src/preview/lib/checkout.ts` and in `tests/unit/preview-checkout.test.ts`. The signed-out pricing command opened Continue with Steam and did not post `/api/subscribe`. Meta stayed absent.

## Daemon and fetchers

Source is the Autoresearch code audit of 2026-10-06 on `d6b21a3`. PR 186 is merged. Its insert-path relink holds. Of the ten follow-up themes, nine are still open, none are fully fixed, and theme 5 (release on error) is partly mitigated. Prod behavior of the daemon is not confirmed. No Mac hop was done.

| Id | Sev | What | Wave |
| --- | --- | --- | --- |
| AR-P0-1 | P0 | Merge-update 40P01 exits the daemon | PR 194, in flight |
| AR-P1-1 | P1 | Recalc reads 500 rows and then sets `last_recalc_at` to now, so the rest are never repriced | Wave 2. Locked-safe if only the SELECT order and the timestamp change |
| AR-P1-2 | P1 | Relink `statement_timeout` 57014 deletes a live listing | Wave 2. Add `57014` to `RELINK_DEFER_CODES` |
| AR-P1-3 | P1 | Relink proceeds when the target row is gone | Wave 2 |
| AR-P1-4 | P1 | Merge-update and revive write `active` without the PR 186 guard | HOLD until the QA race harness has numbers |
| AR-P1-5 | P1 | Claim route reads inputs before the lock | HOLD, same harness |
| AR-P1-6 | P1 | Daemon staleness upserts fuzzy DMarket titles under the wrong skin | Wave 2 |
| AR-P1-7 | P1 | A malformed DMarket 200 reads as every offer gone | Wave 2 |
| AR-P1-8 | P1 | A failed migration leaves the API process up without listening | Wave 2, code half only |
| AR-P1-9 | P1 | Verify can leave all-live seeds `partial`, then the 24h purge deletes them | HOLD, same harness. This is the seed item about verify seeds. They end `partial` with listings still live |

HOLD means AR-P1-4, AR-P1-5, and AR-P1-9 stay put until the race harness reports p20, p50, and p100. Do not start them on sequential tests alone.

Observe only. The score trigger drop and recreate, and `trimGlobalExcess` tie behavior, stay with the score owner. Do not slice them here.

### Daemon hardening after PR 194

One wave-1 slice, started only after PR 194 is on main so the base includes that retry. Score and fees stay untouched. A two-session Postgres deadlock test is optional.

1. Guard the other unguarded daemon-loop calls so they log and continue instead of `process.exit(1)`. That is the expired-claim transaction, the confirmed-purchase transaction, Phase 4b recalc, revive, collection scores, and global trim. Autoresearch listed these next to the merge call in AR-P0-1. PR 194 covers the merge update. This slice covers the rest.
2. Separately, a tiny PR sets `lock_timeout` to 5s on the merge-update transaction, matching inserts.
3. Cap the in-memory merge re-queue (AR-P2-1). It is lost on restart today.
4. `release(err)` on the insert and save paths, and `ROLLBACK` before `RESET` (AR-P2-2).
5. Add counts to the `merge failed` log line.

Reviewer is Autoresearch.

## P2 from the QA sweep

| Id | Evidence | Slice |
| --- | --- | --- |
| F-01 | Observed this run. `/api/trade-ups/abc`, `/api/trade-ups/2147483648`, and `/api/trade-ups/999999999999` were aborted at 8s with no status. QA measured `999999999999` to nginx 504 at 60.2s. `server/routes/trade-ups.ts` around the `GET /api/trade-ups/:id` handler has no try/catch, so Express 4 never answers when Postgres throws integer out of range | Wave 1 with F-02 |
| F-02 | Observed this run. Googlebot on `/trade-ups/2147483648` and `/trade-ups/999999999999` is HTTP 200 with canonical `https://tradeupbot.app/`. `/trade-ups/abc` is 404 in 98ms. `handleTradeUpShareSeo` catch calls `next()` | Same PR as F-01 |
| F-03 | QA. A real browser on an expired id gets 410 and unstyled text, no nav, no link to the board | Wave 1. Keep 410 |
| F-04 | QA. Board CLS 0.283 desktop and 0.217 mobile, one shift near 2.7s when the placeholder collapses. Field CrUX still open | Wave 1 with F-05 |
| F-05 | QA measured at 390px. Filter selects about 16px tall, number inputs about 14px, nav chips 24px. This run measured the intent "Sign in with Steam" control at 28 by 131px. The Frontend teardown added the share primary at 338 by 28, board Verify and See Pro at about 24px tall, pricing tabs at 28px, Go Pro at 34px, calculator controls at 28px, the mobile header CTA at 28px, and FAQ summaries at about 20px. `--control` is 28px in `src/preview/kit/outlay/theme.css` | Wave 1. Coarse pointer min-height 44px for those controls. The intent block's 44px rule ships with the SEO-button P0. Do not raise the global token for every desktop control |
| F-06 | QA plus this run. nginx `/` has no CSP, no Referrer-Policy, no HSTS. Asset requests can carry `auth` and `lid` in Referer before the strip script runs. Node sends both `no-referrer` and `strict-origin-when-cross-origin`. `/api/status` also doubles `X-Frame-Options` (SAMEORIGIN and DENY) | Wave 1, merged with the doubled-header work |
| F-12 | QA. Unknown skin, collection, and blog slugs return 404 with no `X-Robots-Tag`. Tier 404 already sends noindex | Wave 1 |
| F-13 | QA saw "10,001 trade-ups" on the landing hero, then 820,934 after global stats. `landingStatsFromSources` falls back to the board total, and `LIST_TOTAL_CAP` is 10001 | Wave 1 |

The F-01 and F-02 PR rejects any id that is not 1 to 10 digits or is above 2147483647 with a fast 404, wraps async routes so a throw becomes a 500, and uses the same guard in `server/trade-up-share-seo.ts`. The skill command `ids` encodes the check and currently fails. Add tests in that PR. Non-numeric API ids hang the same way as overflow ids. That was probed once, at an 8s cap, on 2026-10-07.

## Other P2

Autoresearch AR-P2-3 (per-cycle counters), AR-P2-5 (sweep duplicate guard), AR-P2-6 (fetcher pool error listener), AR-P2-7 (relink map assert exits immediately), and AR-P2-8 (confirmed-purchase ids popped from Redis before the delete commits) stay behind the hardening slice. AR-P2-4 is measure-first and not a code change until lock time is known.

Code-only, not in wave 1.

- `tradeUpsCacheKey` copies every query key, so unknown params fragment the list cache.
- `server/redis.ts` sets `maxRetriesPerRequest` and does not set `commandTimeout`.
- Detail and inputs set `X-Effective-Tier` from the session user only. The list treats an internal bearer as pro.
- `/trade-ups` Googlebot HTML has FAQPage and WebApplication and no ItemList, by the template in `server/index.ts`. `/best-cs2-trade-ups` does include ItemList. Optional SEO, not a broken hub.

## Frontend P2

| Id | What | Where it goes |
| --- | --- | --- |
| FE-P2-1 | "A peek at the live board" renders no cards. `usePreviewTradeUps({ perPage: 3 })` feeds the hero and the featured row, so the peek slice is empty | Trust slice |
| FE-P2-2 | A trade-up opened in a new tab never calls `warmBoardFaces`. Board Verify opens a new tab, so those visitors see blank skin art. `PreviewShare.tsx` is the page. The calculator already warms faces | Trust slice |
| FE-P2-3 | Filler on first-session surfaces. The share lede describes the verify and claim flow. The expanded board says it opens the live trade-up on this site. Board meta shows rows loaded and a column count. How-it-works mentions request rate, swap optimization, and float-target counts. The covert page repeats the same input and output sentence | Later copy polish, after the banned-phrase PR |
| FE-P2-4 | At 390 the pricing first screen is the Free card. Go Pro starts near y 961. Billing tabs are 28px tall | Later. Pro card first under 600px, tabs at least 44px, 1280 layout unchanged, plan values unchanged |
| FE-P2-5 | The Pro lede says "full analytics" while the compare table gives Free a check for price analytics. Three Pro lines repeat Claim. The Free list marks the 3-hour delay like a feature. PR 193's delay sentence does not cover these lines | Later. Every number stays byte-identical ($6.99, 20/hr, 10/hr, 5, 30 min) |
| FE-P2-6 | Controls under 44px beyond the intent page | Same PR as F-05 |
| FE-P2-7 | After Steam, pricing comes back on the Monthly tab and the visitor has to find Go Pro again | Later. Restore the chosen billing tab and point at Go Pro. No auto-checkout. Stripe stays untouched |
| FE-P2-8 | `LandingGraph` never checks `res.ok`, so an error draws an empty scatter. Hero proof says the board is refreshing for any failure | Later |
| FE-P2-9 | "Open the live board" uses the default Score sort, so the intent table's top row is not the board's top row | Part of the SEO-button P0 |
| FE-P2-10 | Intent rows are labelled only by id | Later. Use the first output name when the list payload includes it. No new API params |
| FE-P2-11 | Footer GitHub, Discord, and email stack with stray period separators | Later |
| FE-P2-12 | Visible text on the seven first-session surfaces had no new banned phrase. "guaranteed" showed up only inside disclaimers | No slice |

The trust slice is one Frontend PR after the wave-1 front. The landing peek renders cards from the same single trade-up request. A trade-up opened in a new tab requests faces and shows skin art where a face exists. The calculator example is one that shows the tool honestly, with a next step after the result. Fee math, the EV formula, prices, and plan gates stay as they are.

Two notes from that sweep stay out of the UI slices. The guest board's top cards can share one input listing, so one purchase removes all of them. That is ranking. The free list returned `total` 10001 and `total_profitable` 0 while its rows had positive P/L. The landing display of that cap is F-13.

## Seed checklist

| Seed | Result |
| --- | --- |
| Mobile controls near 28px | Confirmed. Folded into F-05 |
| Bad tier soft 404 | Direct and Googlebot are HTTP 404. In-app is the already loaded shell. Not a P0 |
| ItemList missing on `/trade-ups` | By design of that template. Not filed as a bug |
| Related block missing Every tier | Refuted on the knife page and the best page |
| Skin canonical | Confirmed. P0 above |
| Spent-claims Retry on the account page | Not reproduced at the cited line |
| Pricing "Checking…" forever | Fixed. `AUTH_ME_TIMEOUT_MS` is 8s |
| Unknown `GET /api/*` returns the SPA | Fixed. `/api/__pstack_missing__` is 404 JSON |
| Cold global-stats around 3s | Not reproduced. A hot call was about 131ms with `X-Cache: HIT` |
| `toBeLessThan(400)` in tests | Absent. The weak assert that exists is `toBeLessThan(1280)` on the end line. Page 5 in `tests/unit/board-pagination-history.test.ts` can still hang the runner |
| Free claimer sees their own fresh row | Low impact. Free cannot claim. Do not change delay numbers. PR 193 owns the delay copy |
| F-07 interstitial events missing on G-2474 | Refuted. GA4 Realtime at 9:52 PM PT recorded `pro_interstitial_view` 2, `steam_continue` 2, and `sign_up_start` 2 on G-2474G4P5QE after two Go Pro then Continue with Steam runs. Harness artifact. No beacon fix |
| `tier = 'lifetime'` string | Webhook writes `tier` pro and `lifetime` true. A raw string would not count as pro. Not seen in prod data |
| `input_sources` on a redacted list payload | Not on the sample list payload |

PR 193 is still open (`cursor/free-paid-conversion-1406`). Do not duplicate its delay-gap copy. PR 186 is merged.

## Agent mistakes worth encoding

Mined from recent history. No product lint was added in this pass. The class that already shipped banned copy is the one the copy PR closes by scanning blog bodies.

Repeated shapes, for the next agent. A new public URL falls through nginx `try_files` to the homepage (`/best-cs2-trade-ups` needed #192). A non-OK fetch gets drawn as an empty list. A listing id is rewritten on one writer and skipped on the next. Titles and canonicals are copied per surface. Conversion events fire before the server result. The barrel rule is skipped by scripts that import `server/engine/` files directly.

Claude thermo-nuclear review and a second-family interrogate did not run. Those models were over the usage limit. File sizes alone are not findings.

## Wave 1

About ten was the original cap. The QA sweep, the post-194 daemon work, and the Frontend teardown expanded it. The Frontend slices are first. Frontend signs the UI and SEO ones. Score, fees, prices, plan gates, rate limits, and Stripe stay out of every slice.

| Order | Slice | Owner | Status |
| --- | --- | --- | --- |
| 1 | One measurement PR. `G-2474G4P5QE` is the only GA4 property. Retire the hard-coded `G-EKWRB4FE37` tag in `index.html` now. Every event goes there, including `page_view`, `pro_interstitial_view`, `steam_continue`, and `sign_up_start`. Confirm one `page_view` per load. Add `cta_click` ids for the Find Real Tradeups controls in the hero, nav, and landing sections, with no visible change. Fold in `sign_up` once per newly created account | Frontend | First. Rebase `conversions.ts`, `PreviewLanding.tsx`, `PreviewPricing.tsx`, and `server/auth.ts` after PR 193. `index.html`, `src/lib/analytics.ts`, and `PreviewChrome.tsx` are not on 193 |
| 2 | `traffic_type: internal` for `HeadlessChrome` and `TradeUpBotVerify` | Frontend | Alongside row 1. The driver already sets the marker and blocks collect |
| 3 | Trade-up page header at 390. Let `.preview-page__meta` shrink and let the head row wrap | Frontend | Playwright at 390 by 844. Title at least 320px wide, Copy link fully on screen, main button inside the first 450px, desktop screenshot diff unchanged. Rebase `preview.css` after PR 193 |
| 4 | Claim and verify pop-up gets a visible 44px "See Pro plans" button that fires `upgrade_cta_click`. Copy states that Verify and Claim need Pro, using the pricing-page price as it already reads. The Steam href stays byte-identical | Frontend | After PR 193 merges. Hillclimb metric is `upgrade_cta_click` |
| 5 | SEO main button on `/best-cs2-trade-ups`, `/trade-ups/tiers`, and `/trade-ups/tiers/covert` goes to Pro or the pop-up, and Steam returns to the page the visitor came from | Frontend | Rebase `PreviewIntent.tsx` after PR 193 |
| 6 | Retry merge-update deadlocks so the daemon stays up | Autoresearch | In flight. PR 194. Do not duplicate |
| 7 | 404 bad trade-up ids, and turn async throws into 500s (F-01, F-02) | Autoresearch | Skill `ids` fails until this lands |
| 8 | Daemon hardening after PR 194 merges. Loop guards, re-queue cap, `release(err)`, merge-failed counts. Tiny sibling PR for `lock_timeout` 5s on merge-update | Autoresearch | Start after 194 is on main. Score and fees untouched |
| 9 | Banned-copy sweep, plus honest board heading and nav ("Trade-ups" / "Find trade-ups") | Frontend | One PR. Rebase after PR 193. The `cta_click` ids from row 1 stay on the control when the visible label changes |
| 10 | Skin page canonical on client navigation | Frontend | |
| 11 | CSP, HSTS, and `Referrer-Policy: strict-origin-when-cross-origin` on nginx `/`, strip `auth` and `lid` before assets load, and stop doubling API security headers (F-06) | Autoresearch | |
| 12 | Expired share keeps HTTP 410 and gains the site shell, nav, and a link to the board (F-03) | Frontend | |
| 13 | Reserve the board placeholder height (F-04) and use 44px targets on coarse pointers for the controls in F-05, including the share primary | Frontend | Do not raise the global `--control` token. The intent block is row 5 |
| 14 | `noindex` on unknown skin, collection, and blog slugs (F-12) | Frontend | |
| 15 | Landing hero must not show "10,001 trade-ups" before the real count (F-13) | Frontend | Neutral placeholder, or the server-rendered count |

## Later slices

One Frontend trust PR. The landing peek renders cards. A trade-up opened in a new tab shows skin art. The calculator example shows the tool honestly and then offers a next step. Fee math and the EV formula stay as they are.

Still later, each its own Frontend PR. Remaining upgrade clicks (`landing_plan_tile`, `share_bar`, `nav_pricing`). Pricing card order at 390. Pricing copy with every number left byte-identical. Restore the chosen billing tab after Steam, with no auto-checkout. Landing errors that must not draw an empty chart. Intent rows that name a skin. Footer separators. Filler copy on the share lede, the board meta, and the how-it-works lines.

The activation funnel is a CEO save inside G-2474G4P5QE. It is not a code PR.

Wave 2, Autoresearch, in the sign order from that audit. AR-P1-2, AR-P1-3, AR-P1-1, AR-P1-7, AR-P1-6, AR-P1-8, then the remaining P2 hygiene that wave 1 did not absorb.

## Verification

The skill is `.cursor/skills/verify-tradeupbot/`. Maintenance is `/maintain-verification-skill`.

Proved against `https://tradeupbot.app` on 2026-10-07.

- `doctor` passed. Unknown `/api/__pstack_missing__` is 404 JSON.
- `crawler` passed after the homepage assertion was corrected. Intent routes have FAQPage and no `/assets` bundle. `/trade-ups` has FAQPage and WebApplication. `/trade-ups/tiers/not-a-real-tier` is 404.
- `auth` passed. `GET /auth/steam?return=/pricing` is 302 to Steam and the driver does not follow it.
- `pricing` passed. Signed-out Go Pro opens Continue with Steam. No Stripe request. No `begin_checkout`.
- `signup` fails on purpose. One `sign_up` from `auth=new` while `/api/auth/me` is null.
- `ids` fails on purpose. API ids abort at 8s. Overflow ids are a 200 homepage for Googlebot.

Browser commands block analytics collect, Stripe, and `/api/subscribe`. Cleanup does not delete the JSON evidence.
