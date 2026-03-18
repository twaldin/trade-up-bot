// All external consumers import from ./engine.js — never from submodules directly.

// Types
export type { DbListing, DbSkinOutcome, ListingWithCollection, AdjustedListing, PriceAnchor } from "./engine/types.js";

export type { CaseMapping, FinishData } from "./engine/knife-data.js";
export type { ProgressCallback } from "./engine/discovery.js";

// Constants
export { CASE_KNIFE_MAP, KNIFE_WEAPONS, DOPPLER_PHASES, GLOVE_GEN_SKINS } from "./engine/knife-data.js";
export { EXCLUDED_COLLECTIONS, CONDITION_BOUNDS } from "./engine/types.js";

// Fees
export { MARKETPLACE_FEES, effectiveBuyCost, effectiveBuyCostRaw, effectiveSellProceeds } from "./engine/fees.js";

// Core math
export { calculateOutputFloat, calculateOutcomeProbabilities } from "./engine/core.js";

// Pricing
export { buildPriceCache, priceCache, priceSources, lookupOutputPrice, dmarketFloorCache, skinportFloorCache } from "./engine/pricing.js";
export type { OutputPriceResult } from "./engine/pricing.js";

// DB operations
export { saveTradeUps, mergeTradeUps, updateCollectionScores, recalcTradeUpCosts } from "./engine/db-ops.js";

// Listing status & preservation
export {
  refreshListingStatuses, purgeExpiredPreserved, reviveStaleTradeUps, reviveStaleGunTradeUps,
} from "./engine/db-ops.js";

// Selection
export { addAdjustedFloat, selectForFloatTarget, selectLowestFloat } from "./engine/selection.js";

// Data loading
export { getListingsForRarity, getOutcomesForCollections, getNextRarity } from "./engine/data-load.js";

// Knife evaluation
export { getKnifeFinishesWithPrices, evaluateKnifeTradeUp } from "./engine/knife-evaluation.js";

// Discovery (classified→covert)
export { findProfitableTradeUps, randomExplore } from "./engine/discovery.js";

// Classified→Covert evaluation
export { evaluateTradeUp } from "./engine/evaluation.js";

// Knife/Glove discovery
export { findProfitableKnifeTradeUps, randomKnifeExplore } from "./engine/knife-discovery.js";

// KNN pricing + observation management (float-precise output pricing for knife/glove skins)
export {
  pruneObservations,
  snapshotListingsToObservations, clearKnnCache,
  knnOutputPriceAtFloat,
} from "./engine/knn-pricing.js";

// Rarity tier config system
export {
  RARITY_TIERS,
  getTierById, getGunTiers, getNewTiers,
  type RarityTierConfig,
} from "./engine/rarity-tiers.js";

// Staircase evaluation (real trade-ups)
export {
  findStaircaseTradeUps,
  type StaircaseTradeUp,
  type StaircaseResult,
} from "./engine/staircase.js";
