# Trade-up ids

A contract id in the URL is 1 to 10 digits and at most 2147483647. Anything else is a 404. The API answers JSON. Googlebot does not receive the homepage.

## Sub-features

- `ids-api` requests `/api/trade-ups/abc`, `/api/trade-ups/2147483648`, and `/api/trade-ups/999999999999`.
- `ids-bot` requests the same three ids on `/trade-ups/:id` with the Googlebot user agent.

## How to get to it (user POV)

- Someone opens a shared link whose id is not a real contract.
- The page says the trade-up is gone, or was never there.
- The request finishes quickly.

## Driving it with the verify-tradeupbot driver

Preconditions:

- Doctor has exited 0.
- Each probe aborts at 8 seconds. Do not retry a hung id in a loop.

- **Probe.** Run `node .cursor/skills/verify-tradeupbot/scripts/drive.mjs ids`.
- **Resulting state.** `ids.json` lists `status` and `ms` for each name.
- **Pass.** Every row is HTTP 404 in under 8 seconds. Bot rows do not use canonical `https://tradeupbot.app/`.

## Gotchas

- Today an id above 2147483647 can hang until nginx returns 504 at 60 seconds. The driver aborts at 8 seconds and records that as a failure.
- `/trade-ups/abc` as Googlebot is already a 404. The API path is the one that can hang.
- Do not add more probes after a timeout. One aborted call is enough evidence.
