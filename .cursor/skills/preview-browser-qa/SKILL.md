---
name: preview-browser-qa
description: Browser QA for the /preview kit app. Use when changing preview landing, board, shell, tiles, or clicks.
---

# Preview browser QA

Laptop `~/.cursor/skills` are not available in cloud/background runs. Use this repo skill.

Preview-only. Do not merge. Do not deploy `/preview` to production. Do not edit `/`, `/trade-ups`, `/calculator`, scoring, fees, CSFloat, or D&N.

## Start the preview host

1. If Vite is not already serving the app, start it with the live API:

```bash
API_PROXY=https://tradeupbot.app npx vite --host 127.0.0.1 --port 5173
```

2. Wait until the preview host responds at `http://127.0.0.1:5173/preview`.

## Drive a real browser

Two scripts do the driving. Both need `puppeteer` (already a dependency) and a
running preview host. Run them, then **look at the images** — the scripts catch
broken links, not ugly layout.

```bash
node scripts/preview-clicks.mjs                      # click + href assertions
QA_OUT=/opt/cursor/artifacts/screenshots node scripts/preview-qa.mjs
```

`preview-clicks.mjs` exits non-zero and prints `CLICK QA FAIL` with a reason.
`preview-qa.mjs` writes the five screenshots below and prints tile measurements.

Then open the routes yourself and interact. Code-only checks are not enough.

1. `/preview` — landing with Ledger laptop (desktop width) and Orbit phone (narrow width). The device screen must render real skin art, not placeholder blocks.
2. `/preview/trade-ups` — live board inside the Outlay sidebar shell.
3. Click an **input** tile. It must `window.open` live listing URL(s) (`csfloat.com`, `dmarket.com`, `skinport.com`, or `buff.market`). It must not navigate the preview SPA to `/skins/...`.
4. Click an **output** tile. It must open a marketplace float/price URL or `https://tradeupbot.app/skins/<slug>`. If the page says **skin not found**, fail the PR.
5. Expand a card. It must show the larger payoff strip, the EV waterfall, the CDF, the listing rows, **and** Verify/Claim (`https://tradeupbot.app/trade-ups/:id` in a new tab). Listings-only is a fail.
6. Toggle dark / light. Check both.

## Fail the PR if any of these are true

- Any tile click lands on a local `/skins` 404 or “skin not found”
- Input click opens only a skin page instead of listing URL(s)
- Cards use 220px images, 140px tiles, or `min-height: 280px`
- Cost, EV, Profit + ROI, chance of profit, median, or worst/best is missing
- Per-output price or odds is missing from the tile
- A **Qty chip** is on the card, or the inline stats became a row of mini-cards
- Inputs are painted the output rarity (a Covert trade-up buys **Classified** inputs)
- Lime is used as a rarity, a status, or a chart series — it is a fill for CTAs and positive profit only
- A radius that is not `var(--r-panel)` / `var(--r-control)` / `var(--r-chip)`
- A fake P/L sine spark, an invented time series, or a bucket histogram is visible
- The word “contract” appears anywhere on the preview surface
- Expand is listings-only, or leaves a ragged empty gutter under a short column
- Sidebar shell is missing on console routes
- `pv-embed` or production chrome is iframed

## Screenshots (required)

Save under `/opt/cursor/artifacts/screenshots/`:

- `board-light.png` — compact light board
- `board-dark.png` — compact dark board
- `board-expanded.png` — one expanded row, dark
- `board-expanded-light.png` — the same row, light
- `landing-laptop.png` — landing at desktop width

Attach those files to PR 138. The session that took them must be a browser you drove, not a guessed layout.
