# pstack audit, October 2026

Tree `d6b21a3` on 2026-10-07. Production deploy of that tree was confirmed by the QA live sweep (bundle `index-Co1S_JBH.js`, homepage last-modified Mon 05 Oct 2026). This pass adds the verification skill and this plan. It does not change prices, plans, the score formula, fee math, or rate-limit values.

Two code audits are cited and not redone.

- Autoresearch code audit, 2026-10-06, tree `d6b21a3e2f9d4b0bbc13049c2ea089644066797f`. Code only. Schema `2026-10-02.4`. Counts in that document are 1 P0, 9 P1, 8 P2.
- QA live sweep, 2026-10-06, prod `d6b21a3e`. 230 read-only requests, 0 organic 5xx, 0 rate limits. That document counted 0 P0, 1 P1, and 12 P2. The P1 (F-07) was later refuted in GA4 Realtime and is not in the counts below.

Labels used below. **Observed-live** means this run or the QA sweep saw it on tradeupbot.app. **Code-only** means the file was read and production was not exercised for that path. Daemon findings stay code-only. Prod is not claimed fixed.

## Counts

| Bucket | Count | What is included |
| --- | --- | --- |
| P0 | 3 | Banned public copy, skin canonical after a client click, merge-batch deadlock (PR 194, in flight) |
| P1 | 12 | Autoresearch AR-P1-1 through AR-P1-9, two GA4 properties on one page, `sign_up` under-firing, internal traffic in GA4 |
| P2 | 20 | Autoresearch AR-P2-1 through AR-P2-8, QA F-01 F-02 F-03 F-04 F-05 F-06 F-12 F-13, plus list-cache keys, Redis `commandTimeout`, the detail tier header, and the board hub without ItemList |

F-08 through F-11 are the same copy slice as the P0 posts. They are not a second set of findings. Several seed items were refuted and are listed under the seed checklist so they are not in these counts.

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

User impact is ad and SEO copy that the review already banned. Blast radius is content, `llms.txt`, Discord user strings, and the account label. One Frontend PR. Extend the banned-copy test so the next agent cannot land the phrases again.

### Skin canonical after a client click

Observed-live. A direct GET of `/skins` and `/skins/ak-47-redline` has the right canonical for both user agents. After clicking `a.preview-skin` from `/skins` to `/skins/mp5-sd-neon-squeezer`, the h1 and title update and the canonical stays `https://tradeupbot.app/skins`.

`PreviewSkinPage` in `src/preview/pages/PreviewSkins.tsx` sets `<title>` and does not call `useCanonicalSlot` for `https://tradeupbot.app/skins/${slug}`. The collections page in the same file does. One Frontend PR.

### Merge-batch deadlock exits the daemon

Code-only. AR-P0-1. A 40P01, or any non-connection database error, in the Phase 5 merge update kills the process. `server/engine/db-save.ts` update batch uses `withRetry` without lock handling and sets `listing_status = 'active'`. `isTransientDbError` in `server/engine/utils.ts` does not treat 40P01, 55P03, or 57014 as transient. `mergeTradeUps` at `server/daemon/index.ts` is outside try/catch. `server/daemon.ts` calls `process.exit(1)`. A pm2 restart drops the in-memory `queuedMergeBatches`.

This is in flight as [PR 194](https://github.com/twaldin/trade-up-bot/pull/194) on `cursor/merge-deadlock-retry-f431` ("Retry merge-update deadlocks so the daemon stays up"). Autoresearch has signed it. It is waiting on QA isolation. Do not open a second PR for the same deadlock.

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

One Frontend slice. Fire `sign_up` exactly once per newly created account, using a server-side signal that is consumed once (auth return or `/api/auth/me`). A returning login stays `login`. An unauthenticated `?auth=new` must not count. Add a unit or integration test. The skill command `signup` already fails on the missing server flag. Interstitial events need no transport change. Two live Go Pro then Continue with Steam runs at 9:52 PM PT showed `pro_interstitial_view` 2, `steam_continue` 2, and `sign_up_start` 2 in GA4 Realtime for G-2474G4P5QE. The earlier capture that saw those events only on the legacy property was a QA harness artifact.

### Internal traffic in GA4

Direct traffic jumped to 631 sessions in six days. QA and this run both drive production from headless browsers. This run's pricing command loaded `/pricing` before collect was blocked. Later driver commands block `google-analytics.com`, `analytics.google.com`, and `googletagmanager.com`.

One Frontend slice. When the user agent contains `HeadlessChrome` or `TradeUpBotVerify`, every gtag event includes `traffic_type: "internal"`, which the GA4 Internal Traffic filter excludes. The verification driver already sends `TradeUpBotVerify`, sets a `tub_internal` cookie, and adds `tub_internal=1` on browser navigations. A normal browser that only has the query param must not be tagged, so a copied link does not mark a person. Deploy smoke curls and `scripts/board-network-qa.mjs` now send the verification user agent. Prices and plans stay as they are.

### Two GA4 properties on one page

Observed-live. Homepage HTML contains hardcoded `G-EKWRB4FE37` in `index.html` and injected `G-2474G4P5QE` in `window.tubTracking`. QA re-check saw one `page_view` per id, with the right `dl`, and no Meta pixel. Retire the legacy id in its own small change after the measurement slice. Do not delete it in the audit PR. `trackSpaPageView` sends only a pixel page view. GA4 history hits depend on the property's enhanced measurement. That admin setting was not opened, so a missing SPA `page_view` is not filed as its own bug.

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
| F-05 | QA measured at 390px. Filter selects about 16px tall, number inputs about 14px, nav chips 24px. This run measured the intent "Sign in with Steam" control at 28 by 131px. `--control` is 28px in `src/preview/kit/outlay/theme.css` | Wave 1. Coarse pointer min-height 44px for those controls and the earlier primary CTAs. Do not raise the global token for every desktop control |
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

About ten was the original cap. Later instructions added the QA DoS, the header and SEO items, and the post-194 daemon work, so this list is the full mandated wave.

| Order | Slice | Owner | Status |
| --- | --- | --- | --- |
| 1 | Retry merge-update deadlocks so the daemon stays up | Autoresearch | In flight. PR 194. Do not duplicate |
| 2 | 404 bad trade-up ids, and turn async throws into 500s (F-01, F-02) | Autoresearch | New. Skill `ids` fails until this lands |
| 3 | `sign_up` once per new account | Frontend | No interstitial beacon change. F-07 refuted |
| 4 | `traffic_type: internal` for automation user agents | Frontend | Driver already sets the marker and blocks collect |
| 5 | Daemon hardening after PR 194 merges. Loop guards, re-queue cap, `release(err)`, merge-failed counts. Tiny sibling PR for `lock_timeout` 5s on merge-update | Autoresearch | Start after 194 is on main. Score and fees untouched |
| 6 | Banned-copy sweep, including llms.txt, the three extra posts, "odds", and Win rate | Frontend | One PR. Extend `banned-copy.test.ts` |
| 7 | Skin page canonical on client navigation | Frontend | |
| 8 | CSP, HSTS, and `Referrer-Policy: strict-origin-when-cross-origin` on nginx `/`, strip `auth` and `lid` before assets load, and stop doubling API security headers (F-06) | Autoresearch | |
| 9 | Expired share keeps HTTP 410 and gains the site shell, nav, and a link to the board (F-03) | Frontend | |
| 10 | Reserve the board placeholder height (F-04) and use 44px targets on coarse pointers for filter selects, number inputs, nav, and the earlier primary CTAs (F-05) | Frontend | |
| 11 | `noindex` on unknown skin, collection, and blog slugs (F-12) | Frontend | |
| 12 | Landing hero must not show "10,001 trade-ups" before the real count (F-13) | Frontend | Neutral placeholder, or the server-rendered count |

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
