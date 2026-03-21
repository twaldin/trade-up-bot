# Buff.market Integration Wiring Guide

When buff data quality is verified and cookie longevity is acceptable, follow these steps to wire buff data into the live trade-up system.

## Decision Criteria

Before wiring in, confirm:
- [ ] Cookie lasts >24h consistently (check heartbeat.log / monitoring)
- [ ] buff_listings data matches expected prices (spot-check vs CSFloat/DMarket)
- [ ] buff_observations have reasonable price distributions (no outliers from currency/fee issues)
- [ ] Volume is meaningful (>1000 listings, >500 observations)

## Step 1: Migrate Listings

Move `buff_listings` rows into the main `listings` table with `source = 'buff'`.

```sql
INSERT INTO listings (id, skin_id, price_cents, float_value, paint_seed, stattrak, created_at, source, listing_type, staleness_checked_at, price_updated_at)
SELECT bl.id, bl.skin_id, bl.price_cents, bl.float_value, bl.paint_seed, bl.stattrak,
       bl.created_at, 'buff', 'buy_now', bl.fetched_at, bl.fetched_at
FROM buff_listings bl
ON CONFLICT (id) DO NOTHING;
```

Then update `buff-fetcher.ts` to write directly to `listings` table instead of `buff_listings`.

## Step 2: Migrate Sale Observations

Move `buff_observations` into `price_observations` with `source = 'buff_sale'`.

```sql
INSERT INTO price_observations (skin_name, float_value, price_cents, source, observed_at)
SELECT skin_name, float_value, price_cents, 'buff_sale', observed_at
FROM buff_observations
ON CONFLICT (skin_name, float_value, price_cents) DO NOTHING;
```

## Step 3: Migrate Sale History

Move `buff_sale_history` into `sale_history` with `source = 'buff'`.

```sql
INSERT INTO sale_history (id, skin_name, condition, price_cents, float_value, sold_at, source, created_at)
SELECT id, skin_name, condition, price_cents, float_value, sold_at, 'buff', created_at
FROM buff_sale_history
ON CONFLICT (id) DO NOTHING;
```

Note: `sale_history` may need `source` column added if it doesn't exist yet.

## Step 4: Wire into KNN Pricing

In `server/engine/knn-pricing.ts`, add `'buff_sale'` to the observation source filter:

```typescript
// In loadObservationCache(), update the WHERE clause:
source IN ('sale', 'skinport_sale', 'buff_sale')
```

Add weight in `KNN_SOURCE_WEIGHTS` (if such a constant exists):
```typescript
buff_sale: 2.0  // High confidence — real transactions with float data
```

## Step 5: Wire into Data Loading

In `server/engine/data-load.ts`, the listing queries already load all sources (no source filter). Buff listings with `source = 'buff'` will be automatically included once they're in the `listings` table.

Verify: `AND (l.listing_type = 'buy_now' OR l.listing_type IS NULL)` covers buff listings.

## Step 6: Wire into Output Pricing

In `server/engine/pricing.ts`, add buff to the listing floor cache if desired:
- Buff listings can contribute to the float-monotonicity ceiling
- Buff sale prices can gap-fill condition-level pricing

## Step 7: Add Buff to Fee Calculations

Already done: `server/engine/fees.ts` has `buff: { buyerFeePct: 0.035, buyerFeeFlat: 15, sellerFee: 0.025 }`.

The `effectiveBuyCostRaw()` function will automatically apply buff buyer fees when `source = 'buff'`.

## Step 8: Update Frontend

- Add 'buff' to listing source display (colored badges in TradeUpTable)
- Add buff.market link format for listing deep links
- Consider: buff listings are on a different marketplace — users need a buff.market account to buy

## Step 9: Update Fetcher

Change `buff-fetcher.ts` to:
1. Write to `listings` table (not `buff_listings`)
2. Write to `price_observations` (not `buff_observations`)
3. Write to `sale_history` (not `buff_sale_history`)
4. Add `cascadeTradeUpStatuses()` calls on listing deletion (like DMarket fetcher)

## Step 10: Cleanup

After confirming everything works with live data for a few days:

```sql
-- Only after verifying the main tables have the data
DROP TABLE buff_listings;
DROP TABLE buff_sale_history;
DROP TABLE buff_observations;
```

## Buff.market Listing Link Format

For linking users to buff.market listings:
```
https://buff.market/market/goods/{buffmarket_goods_id}?game=csgo
```

Individual listing: users browse the goods page and find the listing by price/float.
