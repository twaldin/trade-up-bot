# Crawler HTML

Googlebot receives server-rendered HTML for the SEO routes. The document has a title and a canonical URL. Intent pages include FAQPage JSON-LD and do not include the `/assets` bundle.

## Sub-features

- `crawler-home` fetches `/` with the Googlebot user agent.
- `crawler-board` fetches `/trade-ups` and requires FAQPage and no `/assets` script.
- `crawler-intent` fetches `/best-cs2-trade-ups`, `/trade-ups/tiers`, `/trade-ups/tiers/knife`, and `/trade-ups/tiers/mil-spec`.
- `crawler-rest` fetches `/calculator`, `/faq`, `/blog`, and `/pricing`.
- `crawler-bad-tier` fetches `/trade-ups/tiers/not-a-real-tier` and records the status. A 404 is the expected direct response.

## How to get to it (user POV)

- These URLs are public. A person can open them in a browser. Googlebot is a different response than the SPA shell, so this feature uses the Googlebot user agent rather than a normal click.

## Driving it with the verify-tradeupbot driver

Preconditions:

- Doctor has exited 0 against the same base URL.

- **SEO routes.** Run `node .cursor/skills/verify-tradeupbot/scripts/drive.mjs crawler`. Exit code 0. `crawler.json` has `"ok": true`.
- **Each row.** `title` and `canonical` are non-null. `canonical` is on `https://tradeupbot.app`.
- **Intent rows.** `types` includes `FAQPage`. `assets` is false.
- **Home row.** `/` is the nginx app shell. It has a title and a canonical. `assets` may be true. JSON-LD on that shell is `WebSite` and `Organization`. The driver records those types and does not require `FAQPage` there.
- **Board row.** `/trade-ups` includes `FAQPage` and `assets` is false. `ItemList` is recorded in `types` when the template emits it. The board hub template emits `WebApplication` and `FAQPage`.
- **Bad tier.** The row `route` `/trade-ups/tiers/not-a-real-tier` has status 404.

## Gotchas

- A normal browser user agent on `/trade-ups` gets the SPA shell, including `/assets`. That is not a crawler failure.
- `/blog/:slug/` keeps the trailing slash. Other routes do not.
- Client-side navigation is a different feature. This command only sees the first HTML response.
