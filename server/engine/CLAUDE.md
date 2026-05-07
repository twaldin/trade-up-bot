# Engine Module Reference

Barrel: `server/engine.ts` re-exports all submodules. External code imports from `./engine.js` only.

## Submodules
- `types.ts` — interfaces, `EXCLUDED_COLLECTIONS`, `CONDITION_BOUNDS`
- `utils.ts` — shared helpers: `pick`, `shuffle`, `listingSig`, `parseSig`, `computeChanceToProfit`, `computeBestWorstCase`, `withRetry`, `pickWeightedStrategy`
- `core.ts` — `calculateOutputFloat`, `calculateOutcomeProbabilities`
- `data-load.ts` — `getListingsForRarity`, `getOutcomesForCollections`, `loadDiscoveryData`, `buildWeightedPool`, NDJSON serialization helpers
- `selection.ts` — float-targeted listing selection (dense condition-boundary targets)
- `store.ts` — `TradeUpStore` (diversity-controlled dedup, profit + chance scoring, `hasSig`)
- `evaluation.ts` — `evaluateTradeUp` (EV, profit, ROI, chance-to-profit for guns)
- `knife-evaluation.ts` — `evaluateKnifeTradeUp`, `getKnifeFinishesWithPrices`, `buildKnifeFinishCache`
- `knife-data.ts` — `CASE_KNIFE_MAP`, finish sets, glove generations, `DOPPLER_PHASES`
- `pricing.ts` — multi-source price cache (5-min TTL), `lookupOutputPrice`
- `knn-pricing.ts` — KNN float-precise output pricing for ★ knife/glove (exponential 30-day half-life, 180d max age)
- `condition-multipliers.ts` — Skinport-derived cross-condition price ratios for ★ skins
- `curve-classification.ts` — staircase / smooth / flat output curves; drives exploration strategy
- `observations.ts` — seed / snapshot / prune of `price_observations` (KNN feedstock)
- `fees.ts` — per-marketplace buyer/seller fees (`MARKETPLACE_FEES`, `effectiveBuyCost`, `effectiveSellProceeds`)
- `discovery.ts` — `findProfitableTradeUps`, `randomExplore`, `exploreWithBudget`
- `knife-discovery.ts` — knife/glove variants of the above
- `staircase.ts` — 2-stage staircase (50 Classified → 5 Covert → 1 Knife)
- `rarity-tiers.ts` — `RARITY_TIERS`, `getTierById`, `getGunTiers`, `getNewTiers`
- `db-ops.ts` — barrel re-exporting `db-save`, `db-status`, `db-revive`, `db-stats`

## Pricing Hierarchy
Output pricing (CSFloat-primary, conservative):
1. CSFloat sale-based (highest priority)
2. DMarket listing floor (gap-fill, non-knife commodity, min 2 listings)
3. Skinport listing floor (gap-fill, min 2 volume)
4. CSFloat ref prices (fallback)
5. Cross-condition extrapolation via `condition-multipliers` (last resort, ★ items only)
6. KNN float-precise (★ knife/glove only)

DMarket is **excluded** from ★ output pricing (thin liquidity, collector outliers).

Input pricing: actual listing price + marketplace buyer fee.
- CSFloat: 2.8% + $0.30 deposit
- DMarket: 2.5% buyer fee
- Skinport: 0% buyer fee

Seller fees deducted from output: CSFloat 2%, DMarket 2%, Skinport 8%.

## Trade-Up Types
| Type | Inputs | Output | Count |
|------|--------|--------|-------|
| covert_knife | Covert guns | Knife / Glove | 5 |
| classified_covert | Classified | Covert gun | 10 |
| restricted_classified | Restricted | Classified | 10 |
| milspec_restricted | Mil-Spec | Restricted | 10 |
| industrial_milspec | Industrial | Mil-Spec | 10 |
| consumer_industrial | Consumer | Industrial | 10 |
| staircase | Classified | 5 Covert → 1 Knife | 50 |

## Key Patterns
- Chance-to-profit is a first-class metric: trade-ups with >25% chance kept even with negative EV.
- Discovery-only — every saved trade-up came from exhaustive search over real listings.
- Merge-save: `mergeTradeUps()` upserts by signature, tracks profit streaks.
- 30K cap per type for lower-rarity tiers.
- Discovery skips claimed listings (`AND claimed_by IS NULL`).
- DMarket name verification: `cleanTitle !== skinName` rejects fuzzy matches before insert.
