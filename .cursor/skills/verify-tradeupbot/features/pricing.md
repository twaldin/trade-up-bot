# Pricing

A signed-out visitor can open Go Pro and see the Steam step. The click does not start Stripe and does not fire `begin_checkout`.

## Sub-features

- `pricing-ready` replaces the button label `Checking…` with `Go Pro` for a signed-out session.
- `pricing-steam` opens a dialog whose continue link is `Continue with Steam` and points at `/auth/steam`.
- `pricing-no-stripe` does not navigate to `checkout.stripe.com` and does not request `/api/subscribe`.
- `pricing-no-event` does not push `begin_checkout` before a successful subscribe. The 2xx path is `tests/unit/preview-checkout.test.ts`.

## How to get to it (user POV)

- Open Pricing in the nav, or go to `https://tradeupbot.app/pricing`.
- Choose Monthly, Yearly, or Lifetime, then Go Pro.
- A signed-out click opens the Steam sheet. Continue with Steam leaves for Steam. Not now closes the sheet.

## Driving it with the verify-tradeupbot driver

Preconditions:

- Doctor has exited 0.
- The browser has no TradeUpBot session. The driver uses a fresh Chrome profile, so this holds.

- **Go Pro, then stop.** Run `node .cursor/skills/verify-tradeupbot/scripts/drive.mjs pricing`. Exit code 0.
- **Resulting state.** `pricing.json` has `button.label` equal to `Go Pro`, `dialog.href` containing `/auth/steam`, `failures` empty, and `blocked` empty.
- **Screenshot.** `pricing-steam.png` shows the Steam sheet.
- **Do not click Continue with Steam in a follow-up.** The auth feature checks the redirect with `curl` semantics. Clicking through completes nothing useful and leaves a Steam page.

## Gotchas

- `Checking…` means `/api/auth/me` has not returned. The client treats a hang as signed out after 8 seconds. If the button never leaves `Checking…`, the command fails on timeout. That is a finding, not a reason to click anyway.
- A signed-in Pro session changes the button to `Current plan`. This command does not cover that session. Do not borrow a production cookie to get there.
- The driver aborts Stripe and `/api/subscribe` if a bug requests them. A non-empty `blocked` list is a failure.
