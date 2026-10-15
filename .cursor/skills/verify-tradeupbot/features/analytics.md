# Analytics

Production loads GA4 and does not load the Meta Pixel. A signed-out Go Pro click does not emit `begin_checkout`. `claim_trade_up` is the activation event, and `verify_complete` is the supporting event. Both require a real signed-in success, which this driver does not fake.

## Sub-features

- `analytics-ids` records every `G-` id in the browser HTML for `/`.
- `analytics-pixel` fails if the HTML includes `fbq('init'` or `connect.facebook.net`.
- `analytics-bundle` finds `claim_trade_up`, `verify_complete`, and `begin_checkout` in the `/assets` bundle.
- `analytics-checkout-gate` clicks Go Pro while signed out and fails if `begin_checkout` was pushed.
- `analytics-unit` is the signed-in half. `tests/unit/preview-checkout.test.ts` shows `begin_checkout` only after subscribe returns 2xx. `tests/unit/conversions-client.test.ts` covers `claim_trade_up` and `verify_complete`.

## How to get to it (user POV)

- Load any console page. The document head configures GA4.
- Pricing, then Go Pro, is the checkout event. It fires only after `/api/subscribe` returns 2xx (`src/preview/lib/checkout.ts`).
- Claim and Verify on a trade-up the user can act on fire `claim_trade_up` and `verify_complete` (`src/lib/conversions.ts`).

## Driving it with the verify-tradeupbot driver

Preconditions:

- Doctor has exited 0.
- The Chrome profile is fresh, so no session cookie is present.

- **Head and signed-out click.** Run `node .cursor/skills/verify-tradeupbot/scripts/drive.mjs analytics`. Exit code 0.
- **Resulting state.** `analytics.json` has `pixel` false, `bundle.claim`, `bundle.verify`, and `bundle.begin` true, and `failures` empty.
- **Ids.** `uniqueIds` lists the measurement ids in the HTML. Two ids means the legacy property is still installed. Record them. Do not delete either id from this check.
- **Unit half.** Run `npx vitest run tests/unit/preview-checkout.test.ts tests/unit/conversions-client.test.ts`. The checkout tests must show no `begin_checkout` on 409 and 500, and one `begin_checkout` on a 2xx response.

## Gotchas

- The driver installs its own `gtag` and `fbq` stubs before page scripts run, so it can see calls. A stub is not a pass by itself. The pass is the absence of `begin_checkout` and of Meta init in the HTML.
- Meta stays a no-op while `META_PIXEL_ID` is unset. Do not set it to make the pixel fire.
- `claim_trade_up` does not mirror to Meta. Do not add a pixel call for it while proving this feature.
- Legacy `G-EKWRB4FE37` is still in `index.html` next to the property injected at build. Retiring it is a separate change. This feature records both.
