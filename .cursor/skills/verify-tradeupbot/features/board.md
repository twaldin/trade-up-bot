# Board

The trade-up board lists contracts, scrolls, and keeps the tier filter in the URL after a reload. An impossible filter says that nothing matched. It does not say the user was rate limited.

## Sub-features

- `board-load` shows one or more `article.preview-card` rows on `/trade-ups`.
- `board-scroll` moves the window down the list.
- `board-filter-url` sets Tier to Knife / Gloves and writes `type=covert_knife` on the URL.
- `board-reload` keeps that tier selected after a reload.
- `board-empty` shows `No trade-ups match these filters.` for a minimum expected P/L of `99999`.
- `board-429` is not forced against production. The sentence `Too many requests` is a failure if it appears for that empty filter. The deterministic 429 cases live in `tests/unit/trade-ups-board-fetch.test.ts`.

## How to get to it (user POV)

- Open Trade-Ups in the console nav, or go to `https://tradeupbot.app/trade-ups`.
- Change Tier, Sort, or a numeric filter. The URL updates.
- Clear returns the board to the default query.

## Driving it with the verify-tradeupbot driver

Preconditions:

- Doctor has exited 0.
- You are not already rate limited. If a page says `Too many requests`, stop and run cleanup.

- **Load, scroll, filter, reload, empty state.** Run `node .cursor/skills/verify-tradeupbot/scripts/drive.mjs board`. Exit code 0.
- **Resulting state.** `board.json` has `loaded.cards` greater than 0, `afterScroll.y` greater than the start, `filtered` containing `type=covert_knife`, `reloaded.tier` equal to `covert_knife`, and `empty.kind` equal to `empty_filter`.
- **Screenshots.** `board-filtered.png` and `board-empty.png` sit next to the JSON.

## Gotchas

- Do not scroll in a loop and do not refresh to manufacture a 429. One board command is one pass.
- Typing filters share one history entry while the field is focused. The tier select pushes `type`.
- Prices in the UI are dollars. The URL stores `min_profit` and `max_cost` as integer cents.
- Default filters leave the path as `/trade-ups` with no query string.
