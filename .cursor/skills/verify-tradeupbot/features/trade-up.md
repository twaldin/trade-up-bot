# Trade-up page

Opening a contract shows its cost. Googlebot receives a titled, canonical HTML document for the same id.

## Sub-features

- `trade-up-open` loads `/trade-ups/:id` for one id from the live list and shows the word Cost.
- `trade-up-bot` fetches that same URL with the Googlebot user agent and records title, canonical, and whether the `/assets` bundle is present.

## How to get to it (user POV)

- On the board, the card line links Verify to `/trade-ups/:id` in a new tab.
- Intent tables link the id.
- The landing page links `Open this trade-up`.

## Driving it with the verify-tradeupbot driver

Preconditions:

- Doctor has exited 0.
- `GET /api/trade-ups?per_page=1` returns at least one id. The driver reads that id. You do not hard-code one.

- **Open the contract.** Run `node .cursor/skills/verify-tradeupbot/scripts/drive.mjs trade-up`. Exit code 0.
- **Resulting state.** `trade-up.json` has `seen.hasCost` true, `bot.status` 200, and a non-null `bot.title` and `bot.canonical`.
- **Screenshot.** `trade-up.png` shows the contract page.

## Gotchas

- Free viewers see a delay notice on young rows. Cost can still be on the page. The check is the word Cost, not a listing URL.
- Do not click Verify in a way that posts a claim. This command only opens the page.
