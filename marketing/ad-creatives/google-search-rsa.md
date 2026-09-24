# Google Search — ad group A, calculator

Landing page: `https://tradeupbot.app/calculator`

Campaign context is in the ads plan. This file is the responsive search ad for the calculator ad group only. One honesty line is pinned. Phrases in `src/copy/banned.json` are rejected by `npm run check:copy`.

Character counts include spaces and punctuation. Limits: headline 30, description 90, sitelink text 25, callout 25.

## Headlines

| # | Pin | Chars | Text |
|---|-----|------:|------|
| 1 | | 23 | CS2 Trade-Up Calculator |
| 2 | | 22 | Exact Float + Fee Math |
| 3 | | 22 | Not Condition Averages |
| 4 | | 24 | Built From Live Listings |
| 5 | | 26 | CSFloat, DMarket, Skinport |
| 6 | | 19 | Free CS2 Calculator |
| 7 | | 25 | Fees Included in the Math |
| 8 | | 21 | Verify Before You Buy |
| 9 | | 23 | Free, Then Pro at $6.99 |
| 10 | | 22 | Price the Output Float |
| 11 | | 26 | Real Listings, Real Floats |
| 12 | | 22 | CS2 Tradeup Calculator |
| 13 | | 23 | Trade Up Calculator CS2 |
| 14 | | 20 | Estimates After Fees |
| 15 | 1 | 18 | You Can Lose Money |

Headline 15 is pinned to position 1. It is the honesty line: every impression leads with it.

Pro at $6.99 a month was read from the live pricing page on 24 Sep 2026 (`$6.99/mo`). The same page says a subscription can be cancelled at any time.

## Descriptions

| # | Pin | Chars | Text |
|---|-----|------:|------|
| 1 | | 86 | Estimates only, after fees. A trade-up can lose money. Verify listings before you buy. |
| 2 | | 88 | Model cost, expected value, and profit after marketplace fees. Listings move, so verify. |
| 3 | | 82 | Most tools use average prices. TradeUpBot prices the output float from real sales. |
| 4 | | 68 | Free with a data delay. Pro is $6.99 a month. No profit is promised. |

## Sitelinks

| Text | Chars | URL |
|------|------:|-----|
| Calculator | 10 | https://tradeupbot.app/calculator |
| Live trade-ups | 14 | https://tradeupbot.app/trade-ups |
| Pricing | 7 | https://tradeupbot.app/pricing |
| FAQ on fees | 11 | https://tradeupbot.app/faq |

Description line 1 (35 max) and line 2 for each sitelink:

| Sitelink | Line 1 | Line 2 |
|----------|--------|--------|
| Calculator | Cost, float, and fees | Estimates, not a promise |
| Live trade-ups | Contracts from listings | Verify before you buy |
| Pricing | Free, then Pro at $6.99 | Cancel anytime |
| FAQ on fees | What each market charges | You can lose money |

## Callouts

| Chars | Text |
|------:|------|
| 19 | After-fee estimates |
| 15 | Verify listings |
| 14 | Can lose money |
| 19 | Free tier available |

## Final URL

`https://tradeupbot.app/calculator?utm_source=google&utm_medium=cpc&utm_campaign=tu_w1_search_calc&utm_content=calc&utm_term={keyword}`
