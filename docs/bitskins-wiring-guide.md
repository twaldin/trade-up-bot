# BitSkins Integration Wiring Guide

When BitSkins data quality is verified and float enrichment rate is acceptable, follow these steps to wire data into the live trade-up system.

## Decision Criteria

Before wiring in, confirm:
- [ ] Float enrichment rate is >80% (most listings get float data via WebSocket)
- [ ] bitskins_listings data matches expected prices (spot-check vs CSFloat/DMarket)
- [ ] bitskins_observations have reasonable price distributions
- [ ] Volume is meaningful (>5000 listings with float, >1000 observations)
- [ ] API key has been stable (no unexpected revocations)

## IMPORTANT: Float-Gating Rule

**Only listings with `float_value IS NOT NULL` should ever be migrated to the main `listings` table or included in trade-up calculations.** BitSkins search results don't include float values — floats are backfilled via WebSocket `extra_info`. Listings without float data are incomplete and must be excluded from trade-up inputs.

When wiring in, the migration query MUST include: `WHERE float_value IS NOT NULL`

## Step 1: Migrate Listings (float-gated)

```sql
INSERT INTO listings (id, skin_id, price_cents, float_value, paint_seed, stattrak, created_at, source, listing_type, staleness_checked_at, price_updated_at)
SELECT bl.id, bl.skin_id, bl.price_cents, bl.float_value, bl.paint_seed, bl.stattrak,
       bl.created_at, 'bitskins', 'buy_now', bl.fetched_at, bl.fetched_at
FROM bitskins_listings bl
WHERE bl.float_value IS NOT NULL  -- CRITICAL: only listings with enriched float data
ON CONFLICT (id) DO NOTHING;
```

Then update `bitskins-fetcher.ts` to write directly to `listings` table (only when float_value is known).

## Step 2: Migrate Sale Observations

```sql
INSERT INTO price_observations (skin_name, float_value, price_cents, source, observed_at)
SELECT skin_name, float_value, price_cents, 'bitskins_sale', observed_at
FROM bitskins_observations
ON CONFLICT (skin_name, float_value, price_cents) DO NOTHING;
```

## Step 3: Migrate Sale History

```sql
INSERT INTO sale_history (id, skin_name, condition, price_cents, float_value, sold_at, source, created_at)
SELECT id, skin_name, condition, price_cents, float_value, sold_at, 'bitskins', created_at
FROM bitskins_sale_history
ON CONFLICT (id) DO NOTHING;
```

Note: `sale_history` may need `source` column added if it doesn't exist yet.

## Step 4: Wire into KNN Pricing

In `server/engine/knn-pricing.ts`, add `'bitskins_sale'` to the observation source filter:

```typescript
source IN ('sale', 'skinport_sale', 'buff_sale', 'bitskins_sale')
```

Suggested weight: `bitskins_sale: 2.0` (real transactions with float data, similar confidence to CSFloat sales).

## Step 5: Wire into Data Loading

In `server/engine/data-load.ts`, listing queries load all sources. BitSkins listings with `source = 'bitskins'` will be automatically included once in the `listings` table. Verify the `listing_type = 'buy_now'` filter covers them.

## Step 6: Wire into Output Pricing

In `server/engine/pricing.ts`:
- BitSkins listing floors can contribute to float-monotonicity ceiling
- BitSkins sale prices can gap-fill condition-level pricing

## Step 7: Fee Calculations

Already done: `server/engine/fees.ts` has `bitskins: { buyerFeePct: 0, buyerFeeFlat: 0, sellerFee: 0.0475 }`.

`effectiveBuyCostRaw()` returns exact listing price (0% buyer fee).

## Step 8: Update Fetcher

Change `bitskins-fetcher.ts` to:
1. Write float-enriched listings to `listings` table (not `bitskins_listings`)
   - Only write when `float_value IS NOT NULL` (from WebSocket enrichment)
   - Keep `bitskins_listings` as staging table for un-enriched listings
2. Write to `price_observations` (not `bitskins_observations`)
3. Write to `sale_history` (not `bitskins_sale_history`)
4. Add `cascadeTradeUpStatuses()` on listing deletion (like DMarket fetcher)

## Step 9: Update Frontend

- Add 'bitskins' to listing source display (colored badges in TradeUpTable)
- Add BitSkins listing link format: `https://bitskins.com/item/730/{listing_id}`

## Step 10: Cleanup

After confirming stable for a few days:

```sql
DROP TABLE bitskins_listings;
DROP TABLE bitskins_sale_history;
DROP TABLE bitskins_observations;
```

## Consider: Duplicate Observation Weighting

Same consideration as buff: unique constraint on `(skin_name, float_value, price_cents)` collapses duplicate sales at the same point. Multiple sales at the same float+price strengthen KNN signal. Consider removing the unique constraint or adding a count column when wiring in.
