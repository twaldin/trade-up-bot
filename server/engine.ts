// All external consumers import from ./engine.js — never from submodules directly.

// === Types ===
export type { DbListing, DbSkinOutcome, ListingWithCollection, AdjustedListing, PriceAnchor } from "./engine/types.js";
export type { CaseMapping, FinishData } from "./engine/knife-data.js";
export type { DiscoveryProgressCallback } from "./engine/discovery.js";
export type { ProgressCallback } from "./engine/types.js";
export type { OutputPriceResult } from "./engine/pricing.js";
export type { DiscoveryData } from "./engine/data-load.js";
export type { RarityTierConfig } from "./engine/rarity-tiers.js";
export type { StaircaseTradeUp, StaircaseResult } from "./engine/staircase.js";

// === Constants ===
export { CASE_KNIFE_MAP, KNIFE_WEAPONS, DOPPLER_PHASES, GLOVE_GEN_SKINS } from "./engine/knife-data.js";
export { EXCLUDED_COLLECTIONS, CONDITION_BOUNDS } from "./engine/types.js";
export { RARITY_TIERS, getTierById, getGunTiers, getNewTiers } from "./engine/rarity-tiers.js";

// === Fees ===
export { MARKETPLACE_FEES, effectiveBuyCost, effectiveBuyCostRaw, effectiveSellProceeds } from "./engine/fees.js";

// === Utilities ===
export { pick, shuffle, listingSig, parseSig, computeChanceToProfit, computeBestWorstCase, withRetry, pickWeightedStrategy } from "./engine/utils.js";

// === Core Math ===
export { calculateOutputFloat, calculateOutcomeProbabilities } from "./engine/core.js";

// === Pricing ===
export { buildPriceCache, priceCache, priceSources, lookupOutputPrice, dmarketFloorCache, skinportFloorCache } from "./engine/pricing.js";
export { clearKnnCache, knnOutputPriceAtFloat, batchInputValueRatios, clearLearnedCache } from "./engine/knn-pricing.js";

// === Curve Classification ===
export { classifySkinCurve, curveCache, buildCurveCache, comboCurveScore, shouldUseValueRatio } from "./engine/curve-classification.js";
export type { CurveData, CurveScore, ComboOutcome } from "./engine/curve-classification.js";

// === Observation Management ===
export {
  seedKnifeSaleObservations, seedPriceObservations,
  snapshotListingsToObservations, pruneObservations,
} from "./engine/observations.js";

// === Data Loading ===
export { getListingsForRarity, getOutcomesForCollections, getNextRarity, loadDiscoveryData, buildWeightedPool, clearDiscoveryCache } from "./engine/data-load.js";

// === Selection ===
export { addAdjustedFloat, selectForFloatTarget, selectLowestFloat } from "./engine/selection.js";

// === Evaluation ===
export { evaluateTradeUp } from "./engine/evaluation.js";
export { getKnifeFinishesWithPrices, evaluateKnifeTradeUp, buildKnifeFinishCache } from "./engine/knife-evaluation.js";

// === Discovery ===
export { findProfitableTradeUps, randomExplore, exploreWithBudget } from "./engine/discovery.js";
export { findProfitableKnifeTradeUps, randomKnifeExplore, exploreKnifeWithBudget } from "./engine/knife-discovery.js";
export { findStaircaseTradeUps } from "./engine/staircase.js";

// === DB Operations ===
export { saveTradeUps, mergeTradeUps, updateCollectionScores, recalcTradeUpCosts, trimGlobalExcess } from "./engine/db-ops.js";
export {
  refreshListingStatuses, purgeExpiredPreserved, reviveStaleTradeUps, reviveStaleGunTradeUps,
  cascadeTradeUpStatuses, deleteListings,
} from "./engine/db-ops.js";
