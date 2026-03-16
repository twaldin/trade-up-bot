# Trade-Up Bot Improvements

Prioritized by goal: (1) Market model accuracy, (2) Trade-up pricing accuracy, (3) Feature parity across types, (4) New features/cleanup.

---

## Priority 1: Market Model Coverage

### 0. Doppler/Gamma Doppler phase-separated data (HIGH PRIORITY)
- **Problem**: Sales, listings, and price_observations store Dopplers under base name (`★ Bayonet | Doppler`) without phase qualification. The trade-up engine correctly expands into per-phase outcomes, but the scanner/arbitrage/sniper can't distinguish Phase 1 ($500) from Ruby ($5,000).
- **Fix**: When storing sale observations from staleness checks, use phase-qualified name if `listings.phase` is set. Similarly for DMarket fetcher. Scanner should compare per-phase.
- **Impact**: Fixes ALL Doppler false positives in scanner. Also improves trade-up output pricing for Dopplers.
- **Scope**: Touches staleness checker, DMarket fetcher staleness, scanner.ts, price_observations queries.

### 1. CSFloat sale history for Restricted/Mil-Spec (DEPLOYED, building)
- Restricted: 60/305 skins with sale observations (was 123, recounted accurately). Mil-Spec: 0/438.
- Now fetching at 15%/10% of sale budget per cycle. Will take ~50-100 cycles to build meaningful coverage.
- **Track**: Watch `price_observations` counts for these rarities grow over time.

### 2. Covert skin listing coverage gap
- 160/683 Covert skins have no CSFloat listings. These are newer/less popular skins.
- DMarket covers some. CSFloat budget at 25% for Covert inputs helps.
- **Consider**: dedicated coverage-gap fetch targeting uncovered Covert skins.

### 3. Steam price_data now in pricing cache (DEPLOYED)
- Added 6,438 Steam entries as fallback after CSFloat ref + Skinport. Fixes skins like Glock Trace Lock WW where CSFloat ref was missing but Steam had accurate data at volume=44.

### 4. Skinport WebSocket sold events → price_observations (DEPLOYED)
- 101 sale observations so far. Will grow as more skins sell on Skinport.
- Zero API cost — passive data collection.

---

## Priority 2: Pricing Accuracy

### 5. Output pricing: conservative lowest-source approach (DEPLOYED)
- Non-knife outputs use LOWEST of CSFloat/DMarket/Skinport.
- Knife outputs excluded from DMarket floor (collector outliers).
- Min 2 listings required for DMarket/Skinport floor cache.

### 6. R8 Fade StatTrak contamination (FIXED)
- Deleted 3 rows of inflated Skinport price_data for ST R8 Fade.
- Root cause was old DMarket name-match bug storing Amber Fade data as Fade.
- Name verification deployed to prevent recurrence.

### 7. Condition extrapolation only for ★ items
- Non-knife skins don't get condition extrapolation. Lower rarities use real price_data/listing floors.
- If CSFloat ref is only available for FN, Skinport/Steam data for other conditions fills the gap.

### 8. Zero-price outcomes in knife evaluation
- When a knife finish has no price data, it's skipped (probability doesn't sum to 1.0).
- Effect: EV inflated by ~5-15% for trade-ups with many unpriced outcomes.
- **Fix**: Normalize EV by total probability, or assign conservative floor price.
- Lower priority now that Extraordinary coverage is 72/94 (22 are trade-locked).

---

## Priority 3: Feature Parity (Staircase/StatTrak)

### 9. Staircase RC/MRC display (FIXED)
- Non-knife staircases now show real inputs + outcomes from `evaluateGunStaircase`.
- Was showing empty inputs and fake "Chain1#261" outcomes.

### 10. StatTrak trade-ups: single-listing outliers
- ST CZ75 Victoria FN at $1,420 from one DMarket listing.
- Min-2-listing fix deployed but needs daemon restart to take effect.
- **Track**: Verify top ST trade-ups look realistic after next cycle.

### 11. Generic staircase full input chain storage
- staircase_rck stores 5 Covert inputs but represents 500 Restricted. staircase_rc stores 10 Classified but represents 100 Restricted. staircase_mrc stores 10 Classified but represents 1000 Mil-Spec.
- The original `staircase` type correctly stores all 50 Classified inputs by loading stage-1 trade-up inputs in phases.ts.
- **Fix**: After generic staircase evaluation, trace back through the chain and load base-level inputs from the constituent trade-ups. Store all inputs (or store stage references).
- **UI**: Currently shows chain label (e.g., "500R→50C→5Cv→K") as a workaround.

### 11b. Staircase staleness tracking
- Generic staircases (RC/RCK/MRC) excluded from listing status refresh (always "active").
- Real base inputs could become stale. Staircases rebuild from current data every 5 cycles.
- **Consider**: Track sub-trade-up freshness for staleness signal.

---

## Priority 4: Performance & Architecture

### 12. Outcomes JSON migration (DEPLOYED)
- `trade_up_outcomes` table (was 45M rows, 12GB) replaced by `outcomes_json` column on `trade_ups`.
- Reads: `JSON.parse(row.outcomes_json)` vs JOIN query.
- Writes: single column update vs N individual INSERTs.
- **Track**: DB size should stabilize at <1GB.

### 13. 15-minute cycle target (DEPLOYED)
- 2 cycles per 30-min listing window = ~100 listing calls/cycle.
- Coverage-first budget: 25% knife + 15% classified + 30% output + 30% wanted.
- Sale budget: 30% knife, 15% covert, 15% ST, 15% classified, 15% restricted, 10% milspec.
- Work time ~12 min, cooldown ~3 min, staleness checks ~800-1000/cycle.

### 14. Deep scan capped at 2000 candidates
- Was 5,500+ → 10+ min. Now ~5 min. Could reduce further if cycle time is tight.

### 15. Worker results capped at 30K
- Prevents OOM on NDJSON serialization. All 5 workers succeed consistently.

### 16. phases.ts split into 5 submodules (DEPLOYED)
- housekeeping.ts, theory.ts, data-fetch.ts, knife-calc.ts, classified-calc.ts
- Barrel re-export preserves existing imports.

---

## Priority 5: Future Features

### 17. Scanner uses condition-average not float-matched pricing (ACCURACY ISSUE)
- Bayonet Lore FN: scanner says sell $792 (condition avg $627 × fees) but DMarket listing is 0.067 float worth ~$450 (high-float FN). Low-float FN (0.00x) at $1,000-2,600 inflates the condition average.
- **Fix**: Use KNN float-matched pricing instead of condition average. Compare DMarket listing at float X vs average sale at similar float, not vs all FN sales.
- Same issue affects float sniper — low-float listings compared against condition average that includes high-float sales.

### 17b. Cross-marketplace arbitrage scanner
- Compare DMarket listing prices vs CSFloat sale prices for same skin+condition.
- Flag skins where buy-on-DMarket + sell-on-CSFloat is instantly profitable.
- Requires no trade-up — pure arbitrage.

### 18. Low-float premium sniper
- Detect underpriced low-float FN skins (0.00x) vs KNN expected price.
- Flag DMarket listings below expected price by >20%.

### 19. Historical profit stability tracking
- Track how long trade-ups stay profitable across cycles.
- "Stability score" = consecutive profitable cycles. Higher = more reliable.

### 20. Automated DMarket purchase execution
- `buyDMarketItem()` API already implemented.
- For confirmed profitable staircases, auto-buy inputs from DMarket.
- Requires manual verification step before execution.

### 21. Drop trade_up_outcomes table
- Table still exists but no longer receives rows. Can be dropped once JSON migration is verified stable.

### 22. Frontend component split
- TradeUpTable.tsx at 833 lines. Expanded row content could be sub-components.

---

*Last updated: 2026-03-15 19:00*
