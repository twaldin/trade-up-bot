# Production health

The public site and the API answer with the document or JSON a later check can trust.

## Sub-features

- `health-pages` loads `/`, `/trade-ups`, and `/pricing` as HTML with a title on `/`.
- `health-status` loads `/api/status` as JSON.
- `health-auth-me` loads `/api/auth/me` as JSON. A signed-out body is `null`.
- `health-unknown-api` loads an unknown `/api` path as 404 JSON, not the SPA document.

## How to get to it (user POV)

- Open `https://tradeupbot.app/`.
- Open Trade-Ups, then Pricing, from the console nav.
- The status and auth endpoints are not linked in the nav. The driver requests them directly.

## Driving it with the verify-tradeupbot driver

Preconditions:

- The base URL is reachable.
- You have not pointed `--base` at a server you do not own, other than `https://tradeupbot.app`.

- **Pages and API.** Run `node .cursor/skills/verify-tradeupbot/scripts/drive.mjs doctor`. Exit code 0. `doctor.json` lists `home`, `board`, `pricing`, `api-status`, `api-auth-me`, and `api-unknown` with `"ok": true`.
- **Unknown API.** In that same file, `api-unknown` has status 404 and a JSON content type. The snippet in `notes` does not start with `<!doctype html` when the check fails.

## Gotchas

- `/api/auth/me` returns `null` when nobody is signed in. That is a pass.
- A hanging `/api/auth/me` used to leave Pricing on "Checking…". The client now gives up after 8 seconds (`AUTH_ME_TIMEOUT_MS` in `src/preview/lib/auth-state.ts`). Doctor does not wait those 8 seconds. It only checks that the endpoint returns JSON.
- Do not treat a slow `/api/status` as a failure of this feature. The timing is a note.
