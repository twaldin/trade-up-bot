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
QA_OUT=/opt/cursor/artifacts/screenshots node scripts/preview-tour.mjs
QA_OUT=/opt/cursor/artifacts/screenshots node scripts/preview-qa.mjs
node scripts/preview-capture-device.mjs              # refresh the landing stills
```

`preview-clicks.mjs` exits non-zero and prints `CLICK QA FAIL` with a reason.
`preview-tour.mjs` walks every route in both modes, shoots each one, and fails
on leaked production utility classes or a non-token radius. `preview-qa.mjs`
writes the board screenshots and prints tile measurements.
`preview-capture-device.mjs` re-shoots the landing device stills — run it last,
after the board is final, so the laptop shows what shipped.

Then open the routes yourself and interact. Code-only checks are not enough.

1. `/preview` — landing with Ledger laptop (desktop width) and Orbit phone (narrow width). The lid must show a current capture of the board.
2. `/preview/trade-ups` — live board inside the Outlay sidebar shell.
3. Click an **input** tile's art. It must `window.open` live listing URL(s) (`csfloat.com`, `dmarket.com`, `skinport.com`, or `buff.market`). It must not navigate the preview SPA to `/skins/...`.
4. Click an **output** tile's art. It must open a marketplace float/price URL or `https://tradeupbot.app/skins/<slug>`. If the page says **skin not found**, fail the PR.
5. Click a tile's **name**. It must open `/preview/skins/:slug` inside the shell, with the sidebar still there.
6. Click the **card body**. It must expand, and show the larger tick strip, the EV waterfall, the CDF, the listing rows, **and** Verify/Claim (`https://tradeupbot.app/trade-ups/:id` in a new tab). Listings-only is a fail.
7. Walk `/preview/skins`, `/preview/collections`, `/preview/calculator`, `/preview/account`, and open the currency menu.
8. Toggle dark / light on every one of them.

## Fail the PR if any of these are true

- Any tile click lands on a local `/skins` 404 or “skin not found”
- Input click opens only a skin page instead of listing URL(s)
- Cards use 220px images, 140px tiles, or `min-height: 280px`
- A card **header band** or an expand button is back
- The same stat appears in more than one place on a card
- Inputs are missing cost, count, or a 4 dp float; outputs are missing price or odds
- The payoff strip is fat orbs rather than slim ticks on a 2px rail
- Inputs are painted the output rarity (a Covert trade-up buys **Classified** inputs)
- Profit is any colour other than the lime axis, or loss any red other than `--loss`; lime is never a rarity
- A radius that is not `var(--r-panel)` / `var(--r-control)` / `var(--r-chip)` outside the drawn device frames
- Leaked production chrome: `rounded-md`, `text-muted-foreground`, `border-border`, a shadcn control, or the plated favicon
- A fake P/L sine spark, an invented time series, or a bucket histogram is visible
- The word “contract” appears anywhere on the preview surface
- Expand is listings-only, or leaves a ragged empty gutter under a short column
- Sidebar shell is missing on any console route, including skins and collections
- `pv-embed` or production chrome is iframed

## Screenshots (required)

Save under `/opt/cursor/artifacts/screenshots/`:

- `board-light.png`, `board-dark.png` — the collapsed board
- `board-expanded.png`, `board-expanded-light.png` — one expanded row
- `landing-laptop.png` — landing at desktop width
- `tour-<route>-<mode>.png` — every route in both modes, from `preview-tour.mjs`
- `tour-currency-<mode>.png` — the currency menu open

Attach those files to PR 138. The session that took them must be a browser you drove, not a guessed layout.
