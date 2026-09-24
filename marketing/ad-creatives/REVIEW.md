# Ad creative review pack — revision 1

Silent MP4s and PNGs. Prices are integer cents on the site; the dollars below are the on-screen amounts from the 24 Sept 2026 capture or a same-day re-read. Nothing here is a promised result.

Ads are aimed at people 18 and older. A trade-up spends marketplace value and receives an item the contract does not choose. Meta and Google can still reject the pack under gambling rules. This note does not reword the ads to get around that review.

## Verify gating (what a signed-in free user can do)

`POST /api/verify-trade-up/:id` in `server/routes/trade-ups.ts` returns **403 `Verify requires Pro plan`** when there is no signed-in user **or** `user.tier === "free"`. The list payload sets `verify_limit` to null when `effectiveTier === "free"`. There is no `hasProAccess` helper. `/pricing` lists listing verification on Pro.

A signed-in free user can open the board (contracts delayed 3 hours, `INTERVAL '10800 seconds'`) and can see the sign-in bar. They cannot run Verify. Every ad in this pack says **Verify is part of Pro**, not that signing in is enough.

## Per asset

| Asset | Ratio | Hook | Numbers and source | Safe zone | Policy note |
|---|---|---|---|---|---|
| meta-a-float-vertical | 9:16 | F1, prices re-read | FN $99.59, MW $64.10 from `GET /api/skin-data/AK-47 \| Nightwish` cheapest listing, 24 Sept 2026. Output float 0.5428, cost $53.14, expected value $56.35 from board contract 780598151 capture. | Honesty, captions, callouts, and footnotes sit in y 270–1250. | Expected value is labelled as both outcomes. The 0.5428 example is Battle-Scarred, where float barely moves price. |
| meta-a-float-square | 1:1 | same | same | Feed square; honesty is on screen from frame 1. | Same as the vertical. |
| meta-a-float-portrait | 4:5 | same | same | Honesty is on screen from frame 1. | Same as the vertical. |
| meta-b-screen-vertical | 9:16 | U2 skip, then the hero | Skip: calculator capture cost $27.42, expected value $27.41, −$0.01. Hero: contract 780199345 re-read 24 Sept 2026, cost $63.86, expected value $66.23, expected P/L +$2.37. Nightwish $55.86 and Starlight Protector $57.23 are under that cost. | y 270–1250. | One contract per frame. No rarity-tile arrow and no outcome reveal. The −$0.01 beat is 1.5s and is not the hero. |
| meta-c-verify-vertical | 9:16 | V3 | $53.14 across 10 listings from the board capture. Cursor click is the captured Verify click. | Crop is the cost line and the Verify button (source window about 400×170 CSS px). The detail-page H1 and the worst-case row are not in frame. Sign-in beat is the banner screenshot only. | Says Verify is part of Pro. |
| static-float-boundary-1080 | 1:1 | F1 | FN $99.59, MW $64.10, marker at 0.07. Range ticks 0.00, 0.07, 0.15, 0.38, 0.45, 1.00. | Rows are 64px. | No drawn competitor chart. |
| static-float-boundary-1350 | 4:5 | F1 | same | Rows are 80px. | Same. |
| static-float-boundary-1920 | 9:16 | F1 | same | Rows are 80px. Type sits in the central band. | Same. |
| static-float-number-1080 | 1:1 | F2 | Float 0.5428, cost $53.14, expected value $56.35, both from the board capture. | No thumbnail chart. | Sub says the expected value is across both outcomes. |
| static-float-number-1350 | 4:5 | F2 | same | same | same |
| static-verify-1080 | 1:1 | V2 | First 6 of the 10 captured listings, markets spelled CSFloat and DMarket, total $53.14. | Table is typeset, not a screenshot. | Free view delayed 3 hours. Verify is part of Pro. |
| static-verify-1350 | 4:5 | V2 | same | same | same |
| static-fees-1080 | 1:1 | E1 | Buyer column from the captured FAQ. $3.00 is 10 × the CSFloat $0.30 flat buyer fee. | Buyer column kept. Seller column removed. | Does not say the calculator adds buyer fees. CTA is /trade-ups. |
| static-fees-1350 | 4:5 | E1 | same | same | same |

Killed and not rendered: `static-float-split-1080`, `static-float-split-1350`, `meta-a-float-landscape`.

## Shots to re-capture after the calculator copy PR

Do not use the current calculator page in a frame. It still shows the old wording and the buyer-fee claim. The −$0.01 beat is typeset from the captured result numbers only.

Re-capture after that PR ships:

- Any calculator UI (inputs and result chrome), if a later cut should show the page instead of typeset numbers.
- The trade-up detail H1, once it says Expected P/L. This cut keeps that H1 out of frame because it says Profit and a 6.0% ROI.
- Contract 780199345 as page footage, if the screen demo should show the live card instead of typeset rows. This cut typesets the API prices so the card’s outcome shares and the skin whose name fails the copy check stay off screen.

## End card (every video)

Free view delayed 3 h. Not affiliated with or endorsed by Valve. Board and contract figures are labelled “Example from tradeupbot.app, 24 Sept 2026. Listings and prices change.”

## Google RSA

`google-search-rsa.md` is ad group A for `/calculator`. Position 1 is the three calculator-name headlines. Position 2 is the two honesty lines. Description position 1 is D1. The trade-up sitelink is “Trade-up board” with line 2 “Free view delayed 3 hours”. UTMs are a campaign-level Final URL suffix. Do not spend until the landing copy PR is live.
