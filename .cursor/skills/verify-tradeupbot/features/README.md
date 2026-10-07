# TradeUpBot verification map

This directory is the source for proving user-facing behavior of TradeUpBot. Read this index, then follow one feature file. A pass through a different entry point does not cover a feature listed here.

## Baseline preconditions

- Default base is `https://tradeupbot.app`. Do not deploy, restart, or complete a Stripe checkout.
- Run `node .cursor/skills/verify-tradeupbot/scripts/drive.mjs doctor` and require exit 0 before a browser command.
- Browser commands start their own headless Chrome. Do not drive a Chrome you did not start.
- Two production reads can run together. Two local `npm run dev` processes cannot share ports 3001 and 5173.
- Evidence stays in the directory the driver prints. Cleanup must not delete it.

## Driving conventions

- Start from the feature file's preconditions.
- Prefer the accessible names in the feature file over coordinates.
- Run every command as written. The driver is `node .cursor/skills/verify-tradeupbot/scripts/drive.mjs`.
- A 429 from production is a stop, not a prompt to refresh in a loop.

## Proof and skip reporting

- Record the action and the resulting state. The JSON file is the proof. A screenshot alone is not.
- Name the feature command and the URL in the note you keep with the artifact.
- If a precondition is missing, report the command you ran and the unmet precondition. Do not mark a different path as a pass.

## Features

- [Production health](./prod-health.md) covers the public pages and `/api`.
- [Crawler HTML](./crawler-html.md) covers Googlebot HTML for the SEO routes.
- [Board](./board.md) covers scroll, filters, URL state, and the empty-filter sentence.
- [Trade-up page](./trade-up.md) covers `/trade-ups/:id`.
- [Pricing](./pricing.md) covers Go Pro up to, and not through, Stripe.
- [Steam sign-in](./auth.md) covers the Steam entry redirect.
- [Analytics](./analytics.md) covers GA4 ids, the Meta no-op, and `begin_checkout`.
- [New account return](./signup.md) covers the simulated Steam return that should emit one `sign_up`.
- [Trade-up ids](./ids.md) covers out-of-range and non-numeric contract ids.
