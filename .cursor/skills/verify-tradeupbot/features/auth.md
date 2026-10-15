# Steam sign-in

The sign-in entry sends the browser to Steam OpenID and comes back to TradeUpBot. This check stops at Steam's redirect. It does not log in.

## Sub-features

- `auth-entry` requests `GET /auth/steam?return=/pricing` and records a redirect to `steamcommunity.com` or `steampowered.com`.
- `auth-return-param` keeps `return` as a relative path. The driver does not follow the redirect, so it does not create a session.

## How to get to it (user POV)

- Pricing, then Go Pro, then Continue with Steam.
- My trade-ups, then Sign in with Steam.
- An intent page, then Sign in with Steam.
- The href is `/auth/steam` plus a `return` query when the page has one.

## Driving it with the verify-tradeupbot driver

Preconditions:

- Doctor has exited 0.
- You will not complete the Steam form.

- **Redirect only.** Run `node .cursor/skills/verify-tradeupbot/scripts/drive.mjs auth`. Exit code 0.
- **Resulting state.** `auth.json` has status 301 or 302, `followed` false, and a `location` on a Steam host.

## Gotchas

- Following the redirect all the way through Steam creates or resumes a real account. Do not do that from this check.
- `return` must be a relative path. The server drops values that are not a single-slash path (`server/auth.ts`).
- A failed callback sends the browser to `/?auth=failed`. This command does not reach the callback.
