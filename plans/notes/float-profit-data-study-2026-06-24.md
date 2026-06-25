# Reproducibility artifact — "How much does output float change trade-up profit?" (post A2)

Backs the published numbers in `src/data/blog-posts.ts` slug `cs2-output-float-profit-impact`.
Per plan 025 MUST-FIX #7: the data study cites live prices, which drift — this records the
source, method, and exact captured values so the post stays verifiable.

## Source
- Endpoint: `GET https://tradeupbot.app/api/skin-data?limit=60&page={1,2,3}` (public, no auth).
- Field used per condition: `prices[<condition>].csfloat_sales`, falling back to `csfloat_ref`,
  then `skinport`. Prices are integer cents.
- Captured: **2026-06-24**. Prices move with the market — treat as a dated snapshot. To refresh,
  re-run the query and recompute the FN÷MW ratio.

## Method
1. For each skin, take the per-condition price (above source).
2. The condition boundaries are CS2 fixed: FN 0.00–0.07, MW 0.07–0.15, FT 0.15–0.38, WW 0.38–0.45, BS 0.45–1.00.
3. The FN÷MW ratio is the value multiplier for a single 0.07-boundary crossing (an output float of
   0.069 vs 0.071 — visually identical, one condition apart).
4. Output float itself is deterministic: `output = avg_adjusted_input_float * (out_max − out_min) + out_min`.

## Captured values (cents → dollars), 2026-06-24
| Skin | Listings | FN | MW | FT | FN÷MW |
|---|---|---|---|---|---|
| USP-S \| Black Lotus | 2116 | $40.50 | $2.81 | $1.72 | 14.4× |
| Glock-18 \| Green Line | 2000 | $21.18 | $1.58 | $0.44 | 13.4× |
| M4A1-S \| Nightmare | 1993 | $237.23 | $22.46 | $10.33 | 10.6× |
| MAC-10 \| Candy Apple | 1648 | $5.23 | $0.31 | $0.25 | 16.9× |
| SSG 08 \| Calligrafaux | 1877 | $2.33 | $0.20 | $0.06 | 11.7× |

## Claim discipline (what the post may and may not say)
- TRUE: a 0.07-boundary crossing changes these outputs' value by ~10–17× (data above).
- TRUE: output float is deterministic; the predicted condition is computable before buying.
- TRUE: a model that prices the output at a blended/condition-average value, rather than the exact
  predicted float, misprices outputs that land near a boundary.
- DO NOT claim TradeUpBot's pricing is float-exact for *every* contract — it uses float-exact KNN
  on the primary path but can fall back to condition-level reference pricing when KNN data is thin
  (see server/engine/pricing.ts). The post describes the *method/mechanism*, not a per-contract guarantee.
- Fees (engine/fees.ts): CSFloat 2.8%+$0.30 buyer / 2% seller, DMarket 2.5% / 2%, Skinport 0% / 8%,
  Buff 3.5%+$0.15 / 2.5%. Any fee figure must match these.
