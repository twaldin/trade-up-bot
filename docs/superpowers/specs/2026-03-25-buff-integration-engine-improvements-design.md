# Buff Integration + Discovery Engine Improvements

**Date**: 2026-03-25
**Scope**: Integrate Buff.market listings into discovery pipeline + fix weighted pool bug + remove freshness gate + overhaul exploration strategies

---

## 1. Buff Listing Integration

### 1.1 Data Flow

The buff-fetcher currently writes to `buff_listings` (isolated table). Change it to write directly to the main `listings` table with `source = 'buff'`, mirroring DMarket's existing pattern:

- Upsert with `ON CONFLICT (id) DO UPDATE` — update `price_cents`, `staleness_checked_at = NOW()`, and `price_updated_at` (only when price changes)
- After upserting all active listings for a skin+condition, delete any stored `source = 'buff'` listings for that skin_id + goods_id that weren't in the API response
- Call `cascadeTradeUpStatuses` on deleted listing IDs (same as DMarket)
- Buff listing IDs are already unique strings (e.g., `1074459393-BC38-137104913`) — no collision risk

### 1.2 Column Mapping

| `listings` column | Buff source | Notes |
|---|---|---|
| `id` | Buff listing ID | Unique text, no conflicts |
| `skin_id` | `buff_listings.skin_id` | Already FK to skins(id) |
| `price_cents` | Direct | |
| `float_value` | Direct | 100% coverage in Buff data |
| `paint_seed` | Direct | 100% coverage |
| `stattrak` | Direct | |
| `source` | `'buff'` | |
| `listing_type` | `'buy_now'` | All Buff listings are buy-now |
| `phase` | Not extracted yet | Investigate extracting from `paint_index` during implementation; null for now |
| `staleness_checked_at` | Set to `NOW()` on each re-fetch | |
| `claimed_by` / `claimed_at` | NULL | Claims work identically — our DB flag, not marketplace-dependent |
| `price_updated_at` | Set when price changes | |

### 1.3 New Column: `marketplace_id`

Add `marketplace_id TEXT` to `listings` table. Stores the marketplace-specific ID needed for link generation:
- Buff: `buff_goods_id` (integer as text, e.g., `'33348'`) — needed for `https://buff.market/market/goods/{id}` links
- CSFloat / DMarket: NULL (their listing `id` is sufficient for link generation)

### 1.4 Housekeeping

Add Buff to the daemon's housekeeping phase: purge `source = 'buff'` listings older than 24h (same threshold as DMarket). The buff-fetcher cycles every ~30 min per skin, so 24h is generous.

### 1.5 All Touchpoints

| System | Change needed |
|---|---|
| **Discovery engine** (`data-load.ts`) | None — `getListingsForRarity()` already reads all sources |
| **Fee calculation** (`fees.ts`) | None — `MARKETPLACE_FEES.buff` already defined (3.5% + $0.15 buyer, 2.5% seller) |
| **Trade-up inputs** (`db-save.ts`) | None — `source` stored per input, `input_sources` array computed automatically |
| **Claims** (`routes/claims.ts`) | None — sets `claimed_by` on `listings` rows, source-agnostic |
| **Verify** (`verify-listings.ts`) | Add buff branch: skip per-listing verification, rely on fetcher's re-fetch cycle (same pattern as DMarket staleness via separate fetcher) |
| **Staleness** (`sync/listings.ts`) | None — buff relies on fetcher re-fetch, not checker process |
| **Housekeeping** (`phases/housekeeping.ts`) | Add `source = 'buff'` to 24h purge alongside DMarket |
| **API market filter** (`routes/data.ts`) | Add `'buff'` as valid filter value for `input_sources` |
| **Price recalc** (Phase 4b) | None — `price_updated_at` triggers recalc automatically |
| **Revival** (`db-revive.ts`) | None — source-agnostic, will find buff alternatives |
| **Cascade** (`db-status.ts`) | None — source-agnostic |

### 1.6 Frontend

**Marketplace badges:** Add badges for each source on trade-up input listings:
- `CSF` badge for CSFloat
- `DM` badge for DMarket
- `BUFF` badge for Buff

**Link generation:** When a trade-up input has `source = 'buff'`:
- Link destination: `https://buff.market/market/goods/{marketplace_id}`
- Since Buff has no deep-link to a specific listing, show a tooltip/popover on click before redirect: "Look for float **{float_value}** at **${price}**" — gives the user the exact float and price to find on the Buff goods page

### 1.7 Migration

After confirming data flows correctly through `listings`:
- Drop `buff_listings` table
- Keep `buff_sale_history` and `buff_observations` unchanged (they serve KNN pricing)
- Remove `buff_goods_id` FK and indexes from old table

---

## 2. Fix Weighted Pool Bug

### Problem

`buildWeightedPool()` in `data-load.ts` queries `collection_name` from `trade_up_inputs` to build profit weights, but gun discovery passes `collection_id` values as `eligibleCollections`. The lookup never matches. All gun-tier exploration treats all collections with equal weight — no profit-guided learning. Knife discovery works correctly (uses `collection_name` as group key).

### Fix

In `buildWeightedPool`, build a `collection_id → collection_name` mapping from the listings data already loaded (every listing in `byCollection` has `collection_name`). Look up profit weights by name for each eligible collection ID.

```
for each eligibleCollection (collection_id):
  name = byCollection.get(id)[0].collection_name
  weight = profitWeights.get(name) ?? 0
  apply sqrt-scaled weighting as before
```

No behavior change for knife discovery — it already passes `collection_name`.

### Testing

- Unit test: pass collection IDs, verify weighted pool has non-uniform distribution matching profit history
- Property test: collections with more profitable history appear more frequently in the pool

---

## 3. Remove Freshness Gate

### Problem

`FreshnessTracker.markListingsChanged()` is only called when CSFloat listings are inserted in Phase 4b. If CSFloat inserts 0 listings (rate limited), Phase 5 is skipped — even if DMarket/Buff updated thousands of listings.

### Fix

Remove the freshness gate entirely. Phase 5 always runs. Rationale:
- Discovery is time-bounded — no runaway cost
- Signature skipping makes "no new data" cycles cheap (structured discovery finishes instantly when all sigs exist)
- Exploration benefits from more iterations even on unchanged data (random strategies find combos previous cycles missed)
- With Buff + DMarket providing 95%+ of listings, gating on CSFloat inserts is architecturally wrong

### Implementation

Remove the `if (!freshness.needsRecalc()) skip` check before Phase 5 in `server/daemon/index.ts`. Keep `FreshnessTracker` for any other uses (e.g., logging whether data changed), but don't gate engine execution on it.

---

## 4. Exploration Overhaul

### 4.1 Deeper Offsets

Raise offset caps in all explore strategies:
- Price-sorted pair/single: 20-30 → **200-300**
- Global cheapest pool: 100 → **300**
- Condition-pure strategies: 10 → **100**

This is purely constant changes — how deep into sorted arrays the random offset can reach.

### 4.2 Value-Ratio Explore Strategies

`byColValue` (sorted by KNN value ratio, lowest = most underpriced) is already computed in `loadDiscoveryData` but barely used. Add new explore strategies:

- **Value-ratio single collection** — pick collection from weighted pool, take top 10-20 most underpriced from `byColValue`, try windows of 10
- **Value-ratio pair** — pick two collections, take top N most underpriced from each, combine with random split
- **Value-ratio + float-targeted hybrid** — from `byColValue`, select listings that are both underpriced AND near a condition boundary

These get ~30-40% of explore iterations via the weighted strategy selector. Existing price-sorted strategies keep ~60-70%.

### 4.3 Output Curve Classification

Precompute per-output-skin whether the price curve is "staircase" (condition jumps dominate, flat within condition) or "smooth" (continuous float-price relationship).

**Computation:** From `price_observations`, for each skin measure:
- Intra-condition coefficient of variation (CV): how much price varies within FN, within FT, etc.
- Inter-condition ratio: how much price jumps between conditions (FN/FT ratio, etc.)

Classification:
- **STAIRCASE**: high inter-condition ratio (>3×), low intra-condition CV (<30%) — condition matters, float within condition doesn't
- **FLAT**: low inter-condition ratio (<1.5×), low CV — nothing matters much, just minimize cost
- **SMOOTH / STEEP+WIDE / MIXED**: significant intra-condition variation — float precision pays off within conditions

Live data shows: 46% staircase, 24% mixed, 23% steep+wide, 6% flat, 1% smooth.

**Confidence gating:**
- Require minimum 5 observations per condition to classify
- Skins with insufficient data → default to MIXED (balanced strategy)
- Narrow float range skins (FN-only like Dopplers) → skip classification, use condition-threshold by default

**Storage:** Computed alongside price cache in `buildPriceCache` step, refreshed every 5 minutes. Map of `skinName → curveScore` (float 0-1, where 0 = pure staircase, 1 = pure smooth).

### 4.4 Curve-Aware Strategy Selection

Precompute a weighted curve score per **(collectionA, collectionB, splitCountA, splitCountB)** tuple:

```
combo_curve_score = Σ (probability_i × price_i × curve_score_i) / Σ (probability_i × price_i)
```

Where `probability_i` depends on the split ratio and `price_i` is the best available price for that output skin. This weights curve scores by expected value contribution — expensive smooth gloves dominate over cheap staircase knives.

**Cache key**: `(colA_id, colB_id, countA, countB)` — the number of unique collection pairs × splits is in the low thousands, cacheable at worker start.

**Strategy gate per combo attempt:**
1. Look up precomputed curve score for this collection combo + split
2. Score leans staircase/flat → draw listings from `byCollection` (price-sorted), target condition thresholds
3. Score leans smooth → draw listings from `byColValue` (value-ratio-sorted), optimize float precision

### 4.5 Applies to All Tiers

**Gun tiers** (Classified→Covert, etc.): Few outputs per collection (1-4), so the curve score is sharp — a staircase covert vs smooth covert gives a clear signal.

**Knife tier** (Covert→Knife/Glove): Many outputs per collection (15-25+), so the score averages across many skins. But glove-heavy collections (Glove Collection, Broken Fang, Hydra) score noticeably smoother than pure-knife collections. The split ratio matters: weighting 4 inputs toward a glove collection means 80% of EV comes from smooth-curve outputs → float-optimize.

The assumption that "all knife outputs are staircases" is wrong for gloves — they have smooth continuous curves where every 0.01 float matters within a condition.

---

## 5. What Does NOT Change

- **Output pricing pipeline**: KNN, price cache, fee calculations, `lookupOutputPrice`, `evaluateTradeUp` — all untouched
- **Structured discovery logic**: Same pair enumeration, same split ratios, same float targeting grid
- **Staleness checking**: CSFloat checker process unchanged, DMarket fetcher unchanged
- **Buff sale observations**: Already feeding KNN as `buff_sale` source — no change
- **Claim flow**: Source-agnostic, works identically for buff listings

---

## 6. Deployment

1. Deploy all changes
2. Fresh daemon restart (`scripts/daemon-fresh.sh`) — purges all trade-ups, starts clean
3. Monitor overnight — compare discovery yield, profitable counts, and hit rates against pre-change baseline (documented in `docs/daemon-discovery-analysis.md` and `daemon-monitoring.log`)
4. Key metrics to watch:
   - Total profitable trade-ups per hour (by type)
   - Exploration hit rate (found / iterations)
   - New buff-sourced trade-ups appearing
   - Weighted pool distribution (should now be non-uniform for gun tiers)
   - Curve-aware strategy selection frequency

---

## 7. Testing Strategy

- **Weighted pool fix**: Unit test — pass collection IDs, verify non-uniform distribution
- **Value-ratio strategies**: Unit test — verify `byColValue` listings are used when curve score indicates smooth
- **Curve classification**: Unit test with fixture observations — verify staircase/smooth/flat classification. Property test — skins with uniform intra-condition prices always classify as staircase
- **Buff in listings**: Integration test — insert buff listing, verify discovery finds it, verify claim works, verify cascade on delete
- **Freshness gate removal**: Integration test — verify Phase 5 runs even when no CSFloat listings inserted
- **Strategy selection**: Unit test — verify curve score gates price-sort vs value-ratio correctly per combo
