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

Open these routes and interact. Code-only checks are not enough.

1. `/preview` — landing with Ledger laptop (desktop width) and Orbit phone (narrow width).
2. `/preview/trade-ups` — live board inside the Outlay sidebar shell.
3. Click an **input** tile. It must `window.open` live listing URL(s) (`csfloat.com`, `dmarket.com`, `skinport.com`, or `buff.market`). It must not navigate the preview SPA to `/skins/...`.
4. Click an **output** tile. It must open a marketplace float/price URL or `https://tradeupbot.app/skins/<slug>`. If the page says **skin not found**, fail the PR.
5. Expand a card. Confirm compact listing chips plus Verify/Claim (`https://tradeupbot.app/trade-ups/:id` in a new tab, or a preview route — never old `/trade-ups/:id` chrome inside the preview SPA).
6. Toggle dark / light.

## Fail the PR if any of these are true

- Any tile click lands on a local `/skins` 404 or “skin not found”
- Input click opens only a skin page instead of listing URL(s)
- Cards still use 220px images or `min-height: 280px`
- Cost, Qty, EV, or per-output price/odds are missing
- A fake P/L sine spark / invented time-series is visible
- Sidebar shell is missing on console routes
- `pv-embed` or production chrome is iframed

## Screenshots (required)

Save under `/opt/cursor/artifacts/screenshots/`:

- `board-light.png` — compact light board
- `board-dark.png` — compact dark board
- `board-expanded.png` — one expanded row
- `landing-laptop.png` — landing at desktop width

Attach those files to PR 138. The session that took them must be a browser you drove, not a guessed layout.
