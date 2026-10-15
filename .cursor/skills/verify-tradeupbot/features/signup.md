# New account return

`sign_up` is the GA4 event for a newly created Steam account. A returning login emits `login` and does not emit `sign_up`. The driver simulates the return URL. It does not complete Steam OpenID and it does not send hits to GA4.

## Sub-features

- `signup-new` loads `/?auth=new` and expects one `sign_up` in the page dataLayer.
- `signup-reload` loads `/` again and expects no further `sign_up`.
- `signup-return` loads `/?auth=return` and expects `login` with no `sign_up`.
- `signup-server-flag` reads `/api/auth/me` during the new-account load. The command fails while that body has no consumed new-account flag, because an unauthenticated `auth=new` URL is not a new account.

## How to get to it (user POV)

- A person chooses Continue with Steam.
- Steam sends them back to the site.
- A brand-new account should record one `sign_up`.
- The same person signing in later should record `login`.

## Driving it with the verify-tradeupbot driver

Preconditions:

- Doctor has exited 0.
- GA collect stays blocked. Do not remove `Network.setBlockedURLs` to watch a hit land in the GA4 property.

- **Simulate the return.** Run `node .cursor/skills/verify-tradeupbot/scripts/drive.mjs signup`.
- **Resulting state.** `signup.json` records `first.signUp`, `second.signUp`, `returned.login`, `returned.signUp`, and `me`.
- **Pass.** `failures` is empty. That requires one `sign_up` on the new-account load, none on the reload, none on `auth=return`, and a server-consumed new-account flag on `/api/auth/me`.

## Gotchas

- Today `/?auth=new` emits `sign_up` even when `/api/auth/me` is null. The command fails on that gap until the slice lands.
- The head strip removes `auth` before React boots. The driver reads the dataLayer, not the address bar.
- Do not follow `/auth/steam` through the Steam login form.
