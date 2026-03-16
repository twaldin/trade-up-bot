// All external consumers import from ./engine.js — never from submodules directly.

// Types
export type { DbListing, DbSkinOutcome, ListingWithCollection, AdjustedListing, PriceAnchor, TheoryCandidate } from "./engine/types.js";
export type { ClassifiedTheory } from "./engine/types.js";
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
export { saveTradeUps, saveClassifiedTradeUps, updateCollectionScores } from "./engine/db-ops.js";

// Listing status & preservation
export {
  refreshListingStatuses, purgeExpiredPreserved, reviveStaleTradeUps, reviveStaleClassifiedTradeUps,
  recordProfitableCombo, getProfitableCombosForWantedList,
} from "./engine/db-ops.js";

// Theory tracking
export {
  saveTheoryValidations, loadTheoryCooldowns,
  loadTheoryTracking, getTheoryTrackingSummary,
  saveNearMissesToDb, loadNearMissesFromDb, cleanupTheoryTracking,
  type TheoryTrackingEntry, type TheoryValidationResult,
} from "./engine/db-ops.js";

// Selection
export { addAdjustedFloat, selectForFloatTarget, selectForFloatTargetFloatGreedy, selectLowestFloat } from "./engine/selection.js";

// Data loading
export { getListingsForRarity, getOutcomesForCollections, getNextRarity } from "./engine/data-load.js";

// Knife evaluation
export { getKnifeFinishesWithPrices, evaluateKnifeTradeUp } from "./engine/knife-evaluation.js";

// Discovery (classified→covert)
export { findProfitableTradeUps, randomClassifiedExplore } from "./engine/discovery.js";

// Classified→Covert evaluation
export { evaluateTradeUp } from "./engine/evaluation.js";

// Knife/Glove discovery
export { findProfitableKnifeTradeUps, randomKnifeExplore } from "./engine/knife-discovery.js";

// Theory engine (float-aware)
export {
  generatePessimisticKnifeTheories, saveTheoryTradeUps,
  buildWantedList, theoryComboKey,
  type PessimisticTheory, type DataGap, type TheoryOutcome, type WantedListing, type TheoryGenOptions,
  type NearMissInfo,
} from "./engine/theory-pessimistic.js";

// Theory validation (float pricing infrastructure)
export {
  bootstrapLearnedPrices, seedPriceObservations, seedKnifeSaleObservations, pruneObservations,
  snapshotListingsToObservations, clearLearnedCache, clearKnnCache,
  knnOutputPriceAtFloat,
} from "./engine/theory-validation.js";

// Generic rarity-tier theory engine
export {
  generateTheoriesForTier, buildWantedListForTier,
  genericComboKey, saveTheoryTradeUpsForTier,
  type ClassifiedTheoryResult,
} from "./engine/theory-classified.js";

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

// Staircase theory engine
export {
  generateStaircaseTheories, saveStaircaseTheoryTradeUps,
  type StaircaseTheory, type StaircaseTheoryResult,
} from "./engine/theory-staircase.js";


