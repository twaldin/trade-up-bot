# Ad creative review — 29 Sep 2026

Example ads only. No account, no spend. Every figure below was read off https://tradeupbot.app on 24 Sep 2026 (UTC). Profit and expected-value numbers are estimates after marketplace fees.

These ads are aimed at people 18 and older. Google and Meta can still reject them under their gambling policies, because a CS2 trade-up can be read as staking something of value on an uncertain result. Nothing here was reworded to slip past a reviewer.

Rendered files are not in git. They are produced by `npm run render` into `out/`.

Shared end card, all five videos: **Price the exact float.** / **Fees in. Then verify.** / **Verify, then decide.** Then `tradeupbot.app`, `Free tier, then Pro $6.99/mo. Cancel anytime.`, and `Estimates after fees. You can lose money.`

Pro is `$6.99/mo` from the live pricing page. That page also says: “Yes. You can cancel your subscription at any time from your account menu.”

Footnote on every video: `Captured on tradeupbot.app, 24 Sept 2026.`

## Videos

### meta-a-float-vertical.mp4

- 1080×1920, 19.0s, vertical. Angle: exact float vs a condition average.
- Also cut as `meta-a-float-square.mp4` (1080×1080, 19.0s) and `meta-a-float-landscape.mp4` (1920×1080, 19.0s). Same scenes, same words.
- On-screen copy, in order:
  1. “A condition average is one price for every float.”
  2. “Battle-Scarred AK-47 | Nightwish, cheapest listing: a condition price.” Callout: `Battle-Scarred · cheapest` / `$56.79` / `Price by condition, live page`.
  3. “This contract produces float 0.5428.” Callout: `Predicted output float` / `0.5428` / `AK-47 | Nightwish`.
  4. “The listing price is for that float, after fees.” Callout: `Expected value · estimate` / `$56.35` / `Cost $53.14 · P/L +$3.21 after fees`.
  5. End card, headline “Price the exact float.”, button “Open the calculator”.
- Footage: desktop recording of `/skins/ak-47-nightwish` (price-by-condition panel, including the still `d-skins--price-by-condition.png`) and of the expanded card on `/trade-ups` (trade-up 780598151). Outcome shares on that card are cropped out of frame.

### meta-b-ugc-vertical.mp4

- 1080×1920, 19.4s, vertical. Angle: screen recording. Open the calculator, show the fee line, then Verify.
- On-screen copy, in order:
  1. “Open the calculator.”
  2. “Ten live listings. Each one has its own float.”
  3. “After fees, the worked example loses a cent.” Callout: `Estimate after fees` / `-$0.01` / `Cost $27.42 · expected value $27.41`.
  4. “The fee depends on the marketplace.” The FAQ answer is in frame, including CSFloat 2.8% + $0.30 buyer and 2% seller, DMarket 2.5% buyer and 2% seller, Skinport no buyer fee and 8% seller, Buff 3.5% + $0.15 buyer and 2.5% seller.
  5. “Then verify the listings are still for sale.”
  6. End card, headline “Fees in. Then verify.”, button “Try the calculator”.
- Footage: desktop `/calculator` (Load example, then Evaluate) and desktop `/faq` (the fees question opened). The verify beat is the desktop `/trade-ups` recording, on the Verify / Claim control.

### meta-c-verify-vertical.mp4

- 1080×1920, 19.0s, vertical. Angle: verify before you buy.
- On-screen copy, in order:
  1. “A green estimate is not a promise.”
  2. “Every input is a listing you can open.” Callout: `10 listings · cost` / `$53.14` / `CSFloat and DMarket`.
  3. “Verify re-checks each one before you buy.”
  4. “Verifying asks you to sign in. Listings can already be gone.”
  5. End card, headline “Verify, then decide.”, button “See live trade-ups”.
- Footage: desktop `/trade-ups` expanded card (listings column and the Verify / Claim link), then the page that link opens, `https://tradeupbot.app/trade-ups/780598151`, which shows “Sign in to verify, claim, and purchase listings”.

## Static images

All of them carry `Estimates after fees. You can lose money.` and a source line dated 24 Sept 2026. The two sizes of each design are the same layout.

### static-float-split-1080.png and static-float-split-1350.png

- 1080×1080 and 1080×1350. Angle: exact float vs a condition average.
- Headline: “Same skin. The float changes the price.”
- Sub: “Battle-Scarred AK-47 | Nightwish shows one cheapest listing per condition. A contract prices the float it actually produces.”
- Left panel is a drawn flat line labelled “One price per condition” / “A flat line. No float, no listing.” It is not data. Right panel is the live price-by-condition screenshot: Factory New $115.57, Minimal Wear $63.99, Field-Tested $58.18, Well-Worn $56.80, Battle-Scarred $56.79.
- Button: “Open the calculator”. URL: `tradeupbot.app/calculator`.
- Footage: `d-skins--price-by-condition.png` from `/skins/ak-47-nightwish`.

### static-float-number-1080.png and static-float-number-1350.png

- 1080×1080 and 1080×1350. Variation on the float angle.
- Headline: “Float 0.5428, not a condition midpoint.”
- Sub: “This contract’s AK-47 | Nightwish output is float 0.5428 (Battle-Scarred). Expected value $56.35 on a $53.14 cost.”
- Big figure `0.5428`, label “Predicted output float”, detail “AK-47 | Nightwish · Battle-Scarred. Expected value $56.35, estimate after fees.”
- The picture is the live “Float against price” chart for AK-47 | Nightwish.
- Button: “Open the calculator”. URL: `tradeupbot.app/calculator`.
- Footage: `d-skins--chart.png`. The float and the expected value are from the expanded card on `/trade-ups`, not from the chart.

### static-verify-1080.png and static-verify-1350.png

- 1080×1080 and 1080×1350. Angle: verify before you buy.
- Headline: “Verify the listings before you buy.”
- Sub: “Each input links to a live listing. Verify re-checks that it is still for sale, and at what price. Signing in is required.”
- Table, first six inputs of trade-up 780598151:
  - 01 Dual Berettas Melondrama, CF, 0.8672, $5.01
  - 02 FAMAS Rapid Eye Movement, CF, 0.3142, $5.44
  - 03 FAMAS Rapid Eye Movement, CF, 0.4152, $5.66
  - 04 FAMAS Rapid Eye Movement, CF, 0.3829, $5.67
  - 05 MP7 Abyssal Apparition, CF, 0.2392, $4.41
  - 06 MP7 Abyssal Apparition, DM, 0.6621, $5.38
- Button: “See live trade-ups”. URL: `tradeupbot.app/trade-ups`.
- Footage: those rows were read from the expanded card on desktop `/trade-ups`. The table is set in the ad, not a screenshot, so the outcome-share figures elsewhere on that card are not in the image.

### static-fees-1080.png and static-fees-1350.png

- 1080×1080 and 1080×1350. Variation: fees in the math.
- Headline: “The fee depends on where you buy.”
- Sub: “Copied from the live FAQ. Applied per listing, on the way in and on the way out.”
- Table, from the live answer to “What marketplace fees does TradeUpBot account for?”:
  - CSFloat, buyer 2.8% + $0.30, seller 2%
  - DMarket, buyer 2.5%, seller 2%
  - Skinport, buyer none, seller 8%
  - Buff, buyer 3.5% + $0.15, seller 2.5%
- Button: “Open the calculator”. URL: `tradeupbot.app/calculator`.
- Footage: desktop `/faq`. The words are the page’s answer, set into a table.

## Google Search

`google-search-rsa.md`. Calculator ad group, final URL `https://tradeupbot.app/calculator`. 15 headlines (30 characters or fewer), 4 descriptions (90 or fewer). Headline 15, “You Can Lose Money”, is pinned to position 1. Sitelinks: Calculator, Live trade-ups, Pricing, FAQ on fees. Callouts: After-fee estimates, Verify listings, Can lose money, Free tier available.

## Capture notes

- Playwright recorded `/`, `/calculator`, `/trade-ups`, `/skins`, `/skins/ak-47-nightwish`, `/faq`, and `/pricing`, at 1440×900 and at a 390×844 mobile viewport. The finished ads use the desktop recordings because the type stays readable. The mobile files are in the capture output and are gitignored with the rest.
- The public “Verify / Claim trade-up” control is a link. Signed out, the page it opens says you have to sign in before anything is re-checked. The verify video shows that, and does not pretend a verify ran.
- The calculator’s Load example, evaluated live, came back cost $27.42, expected value $27.41, profit −$0.01. That loss is what the ad says.
- No capture in the final set hit a 429.
- A CSS blur drawn over outcome shares did not show up in the screen recording. Those figures are cropped out of the videos instead, and they are not the hook.
- No background music. The videos are silent.
