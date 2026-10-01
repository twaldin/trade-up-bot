# Google Search — ad group A, calculator

Landing page: `https://tradeupbot.app/calculator`

Do not launch this ad group until the calculator copy PR is live. The live page still uses the old calculator wording and a buyer-fee claim the calculator does not do.

Campaign context is in the ads plan. This file is the responsive search ad for the calculator ad group only. Phrases in `src/copy/banned.json` are rejected by `npm run check:copy`.

Character counts include spaces and punctuation. Limits: headline 30, description 90, sitelink text 25, sitelink description line 35, callout 25.

## Headlines

| # | Pin | Chars | Text |
|---|-----|------:|------|
| 1 | 1 | 23 | CS2 Trade-Up Calculator |
| 2 | | 25 | Priced at the Exact Float |
| 3 | | 22 | Not Condition Averages |
| 4 | | 20 | Model Your 10 Inputs |
| 5 | | 26 | CSFloat, DMarket, Skinport |
| 6 | | 19 | Free CS2 Calculator |
| 7 | | 25 | Expected Value After Fees |
| 8 | | 24 | See Float Before You Buy |
| 9 | | 23 | Free, Then Pro $6.99/mo |
| 10 | | 22 | Price the Output Float |
| 11 | | 25 | Uses the Floats You Enter |
| 12 | 1 | 22 | CS2 Tradeup Calculator |
| 13 | 1 | 23 | Trade Up Calculator CS2 |
| 14 | 2 | 29 | Estimates. You Can Lose Money |
| 15 | 2 | 18 | You Can Lose Money |

Position 1 is pinned to the three calculator-name variants (1, 12, 13), so the keyword leads. Position 2 is pinned to the two honesty lines (14, 15), so every impression still carries one. Honesty is not pinned to position 1.

Pro at $6.99 a month was read from the live pricing page on 24 Sep 2026 (`$6.99/mo`). The same page says a subscription can be cancelled at any time.

## Descriptions

| # | Pin | Chars | Text |
|---|-----|------:|------|
| 1 | 1 | 85 | Estimates only, after fees. A trade-up can lose money. Check listings before you buy. |
| 2 | | 85 | Enter 10 inputs with exact floats. See output float, expected value and expected P/L. |
| 3 | | 84 | Prices the exact output float from nearby real sales, not a condition-average price. |
| 4 | | 82 | Free calculator. Pro $6.99/mo adds real-time trade-ups and verify. Cancel anytime. |

Description position 1 is pinned to description 1.

## Sitelinks

| Text | Chars | URL |
|------|------:|-----|
| Calculator | 10 | https://tradeupbot.app/calculator |
| Trade-up board | 14 | https://tradeupbot.app/trade-ups |
| Pricing | 7 | https://tradeupbot.app/pricing |
| FAQ on fees | 11 | https://tradeupbot.app/faq |

Description line 1 (35 max) and line 2 for each sitelink:

| Sitelink | Line 1 | Line 2 |
|----------|--------|--------|
| Calculator | Cost, float, and fees | Estimates, not a promise |
| Trade-up board | Contracts from listings | Free view delayed 3 hours |
| Pricing | Free, then Pro $6.99/mo | Cancel anytime |
| FAQ on fees | What each market charges | You can lose money |

## Callouts

| Chars | Text |
|------:|------|
| 19 | After-fee estimates |
| 18 | Exact output float |
| 14 | Can lose money |
| 19 | Free tier available |

## Final URL

Final URL: `https://tradeupbot.app/calculator`

Campaign-level Final URL suffix (sitelinks inherit it):

`utm_source=google&utm_medium=cpc&utm_campaign=tu_w1_search_calc&utm_content={adgroupid}&utm_term={keyword}&utm_matchtype={matchtype}`

Keep auto-tagging (gclid) on. Before spend, confirm the page does not strip the query string and that `calculator_complete` still carries the UTMs.
