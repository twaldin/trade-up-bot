---
name: verify-tradeupbot
description: Drive TradeUpBot (tradeupbot.app) the way a user does. Covers production health, Googlebot HTML, the trade-up board, a contract page, pricing up to Stripe, the Steam sign-in entry, and the GA4 event gates. Use before claiming a UI, SEO, checkout, or analytics change works.
---

# Verify TradeUpBot

TradeUpBot is a web app. The user-facing surface is the console at `https://tradeupbot.app` (React routes in `src/App.tsx` render `src/preview`). The API is Express on the same host under `/api`. A local dev server exists, and it is not required to prove production.

Read `features/README.md` before driving a feature. Drive the entry point that file names. A pass through a different URL is not a pass for this one.

## Launch

Production is already running. The default base is `https://tradeupbot.app`. Do not start it, deploy it, or restart it.

Local launch, only when the feature file says the check needs a local server:

```bash
npm run dev
```

Vite answers on `http://127.0.0.1:5173` and proxies `/api` to Express on port 3001. Ready means both of these return a body:

```bash
curl -sf -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5173/
curl -sf -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3001/api/status
```

`npm run dev` needs `DATABASE_URL`, Redis, and a loaded `tradeupbot` database. Two local servers cannot share ports 3001 and 5173. If doctor reports a listener you did not start, do not kill it by name. Point `--base` at production instead.

Chrome for the browser commands is `/usr/local/bin/google-chrome` unless `CHROME_BIN` is set. The driver starts one headless Chrome with a private user-data dir and DevTools port `9333` (`VERIFY_CDP_PORT` overrides the port).

## Doctor

Run this first whenever a page looks wrong.

```bash
node .cursor/skills/verify-tradeupbot/scripts/drive.mjs doctor
```

Exit 0 means `/`, `/trade-ups`, `/pricing`, `/api/status`, `/api/auth/me`, and `/api/__pstack_missing__` answered the way a drive can use. `/api/__pstack_missing__` must be HTTP 404 JSON, not the SPA document. The JSON report is `doctor.json` in the evidence directory. Notes in that file (header snapshot, status timing) are observations, not failures.

Add `--base=http://127.0.0.1:5173` to point the same checks at a local server you started.

## Drive

The harness is `node .cursor/skills/verify-tradeupbot/scripts/drive.mjs <command>`.

| Command | What it does |
| --- | --- |
| `doctor` | Read-only health of the pages and `/api` above |
| `crawler` | Googlebot fetches of the SEO routes |
| `board` | Scroll, tier filter, URL reload, empty filter versus the rate-limit sentence |
| `trade-up` | Opens one live `/trade-ups/:id` and fetches the same URL as Googlebot |
| `pricing` | Signed-out Go Pro opens Steam and does not call Stripe |
| `auth` | `GET /auth/steam` redirects to Steam and the driver does not follow it |
| `analytics` | GA4 ids, Meta snippet absence, and no `begin_checkout` before subscribe |
| `signup` | Simulated `auth=new` and `auth=return` loads, with GA collect blocked |
| `ids` | Trade-up ids that are not 1 to 10 digits, or are above 2147483647, must 404 within 8s |
| `cleanup` | Stops the Chrome process this driver started |

Stable handles the browser commands use:

- Board cards are `article.preview-card`.
- The tier control is the `select` inside the label whose text is `Tier`. Knife and gloves is the option value `covert_knife`.
- Empty filters use the sentence `No trade-ups match these filters.`
- Rate limiting uses a sentence that contains `Too many requests`.
- Pricing uses the button `Go Pro` and the link `Continue with Steam`.
- Steam's href starts with `/auth/steam`.

The driver blocks any request whose URL contains `stripe.com` or `/api/subscribe` and records it as a failure. Do not remove that block. Do not complete a Stripe payment. Do not post a real subscribe call against production.

Browser commands also block `google-analytics.com`, `analytics.google.com`, and `googletagmanager.com`, override the UA to one that contains `TradeUpBotVerify`, set a `tub_internal=1` cookie, and add `tub_internal=1` to the page URL. That marker is how the internal-traffic slice will set `traffic_type`. A normal browser UA must not be tagged from the query param alone.

`claim_trade_up` and `verify_complete` need a signed-in session that has actually claimed or verified. This driver does not invent one. Those two events are covered by `tests/unit/conversions-client.test.ts`. `begin_checkout` after a 2xx subscribe is covered by `tests/unit/preview-checkout.test.ts`. The live pricing command proves the signed-out path does not fire `begin_checkout`.

## Evidence

The evidence directory is `VERIFY_OUT`, or `/opt/cursor/artifacts/verify-tradeupbot` when that parent exists, or `.verify-tradeupbot-artifacts` in the current directory.

Each command writes a JSON file named after the command. Browser commands also write PNG files. A proof includes the action and the resulting state in that JSON, not only the last screenshot.

Production checks are read-only GETs plus a signed-out click that stays on tradeupbot.app. Mocks are limited to the Stripe and `/api/subscribe` block, which exists so a bug cannot open Checkout.

## Cleanup

```bash
node .cursor/skills/verify-tradeupbot/scripts/drive.mjs cleanup
```

Cleanup sends `SIGTERM` to the Chrome pid stored in `VERIFY_STATE` (default `/tmp/verify-tradeupbot-state.json`) and deletes that Chrome profile. It does not delete the evidence directory. It does not kill Chrome by process name.

Do not leave a second Chrome on port 9333. If cleanup reports the pid is already gone, delete the state file by running cleanup once. It is safe to repeat.

## Helpers

The only helper is the driver. It is executable.

```bash
node .cursor/skills/verify-tradeupbot/scripts/drive.mjs doctor
node .cursor/skills/verify-tradeupbot/scripts/drive.mjs crawler
node .cursor/skills/verify-tradeupbot/scripts/drive.mjs board
node .cursor/skills/verify-tradeupbot/scripts/drive.mjs trade-up
node .cursor/skills/verify-tradeupbot/scripts/drive.mjs pricing
node .cursor/skills/verify-tradeupbot/scripts/drive.mjs auth
node .cursor/skills/verify-tradeupbot/scripts/drive.mjs analytics
node .cursor/skills/verify-tradeupbot/scripts/drive.mjs signup
node .cursor/skills/verify-tradeupbot/scripts/drive.mjs ids
node .cursor/skills/verify-tradeupbot/scripts/drive.mjs cleanup
```

## Maintenance

When a route, label, or event name changes, update the feature file in the same change. The maintenance pass is `/maintain-verification-skill`.
