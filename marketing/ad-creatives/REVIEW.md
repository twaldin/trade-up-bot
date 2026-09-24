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
| meta-b-screen-vertical | 9:16 | U2 skip, then the hero | Skip: calculator capture cost $27.42, expected value $27.41, −$0.01. Hero: contract 780199345 re-read 24 Sept 2026. Cost $63.86 and expected value $66.23 sit side by side in neutral type. Nightwish $55.86 and Starlight Protector $57.23 are under that cost. No signed expected P/L. | y 270–1250. A bar fills in the first 0.5s, then the under-cost rows highlight. | One contract per frame. No rarity-tile arrow and no outcome reveal. The −$0.01 beat is 2s and is not the hero. |
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

## Shots re-captured after #171

#171 is live in prod (`db7c68a2`). Recaptured 24 Sept 2026 from https://tradeupbot.app: video C’s sign-in banner, the board shot of contract 780598151, and the calculator take. The `signinBanner` check still looks for a “Verify … Pro” sentence. The live banner is “Verify and Claim are Pro features. Signing in with Steam is free.” The on-screen sign-in footnote stays “Signing in is free. Verify is part of Pro.”

The board card now says Expected P/L and Above cost. Cost is still $53.14 and expected value is still $56.35, so the typeset numbers did not change. The opening crop is the total-cost line and the Verify button. The 6.0% ROI row and the outcome chart stay out of that frame.

The live calculator example moved to cost $28.07, expected value $27.79, expected P/L −$0.28. Video B stays the signed typeset example (cost $27.42, expected value $27.41, −$0.01) and is not re-rendered. There is no square cut that uses this footage. Detail H1 stays out of frame. Contract 780199345 stays typeset.

## End card (every video)

Free view delayed 3 h. Not affiliated with or endorsed by Valve. Board and contract figures are labelled “Example from tradeupbot.app, 24 Sept 2026. Listings and prices change.”

## GTM revision checklist

- Float-boundary tick labels alternate rows so 0.00, 0.07 and 0.15 do not collide, and neither do 0.38 and 0.45. All six stops stay on the bar.
- Float-boundary source line: “Cheapest listings, 24 Sept 2026 re-read 14:01 PT. Listings and prices change.” The 14:01 PT time is the file time of the live skin-data response.
- Float-boundary 1920 uses 270px top padding and 672px bottom padding.
- Re-rendered this pass: float-boundary 1080, 1350 and 1920; float-number 1080 and 1350; verify 1080 and 1350; the three A cuts (same range bar); screen demo B (caption now says two outcomes).
- Stale files removed from the render folder and the artifact folder: float-split 1080 and 1350, the old float-number and verify renders, `meta-b-ugc-vertical.mp4`, `meta-a-float-landscape.mp4`.
- Pricing sitelink line 1 is “Free, then Pro $6.99/mo” (23).
- Banned list now includes finish green, bankroll, bankrolls, plays, guarantee, guaranteed.
- Calculator callout is “Exact output float” (18). D1 ends “Check listings before you buy.” (85) and stays pinned to description position 1.
- H14 stays “Estimates. You Can Lose Money”, pinned to position 2.
- Screen demo caption: “Two outcomes are priced under the cost.” The panel lists Nightwish $55.86 and Starlight Protector $57.23.
- Meta primary text: “Cross 0.07 and the cheapest AK-47 | Nightwish listing drops from $99.59 (FN) to $64.10 (MW).”
- No board ROI percent is used in ad copy.

## r5

- Square and portrait FN/MW labels are at least 24px. The square cut is centred in the frame.
- The 1920 boundary still keeps 24px above the bottom safe line (padding below the 672px band).
- “Signed-in free accounts can't run Verify” replaces the 403 line.
- Video C’s opening board shot hides the cursor, which was sitting on Claim. Footage is not re-captured; that waits until #171 is live.
- Video B’s hero card is 8 seconds. The end card holds to 5 seconds so the cut stays 15 seconds.

## r6

- Recaptured the post-#171 sign-in banner, board shot, and calculator take. Re-rendered `meta-c-verify-vertical` only. r5 files for every other cut stay as they were.
- Frame check rejects guaranteed profit, case key, and gambling phrasing. “not guaranteed profit” is the only allowed disclaimer of that kind. It does not appear in this cut. The on-screen disclaimer stays “Estimates after fees. You can lose money.”

## Google RSA

`google-search-rsa.md` is ad group A for `/calculator`. Position 1 is the three calculator-name headlines. Position 2 is the two honesty lines. Description position 1 is D1. The trade-up sitelink is “Trade-up board” with line 2 “Free view delayed 3 hours”. UTMs are a campaign-level Final URL suffix. Do not spend until the landing copy PR is live.
