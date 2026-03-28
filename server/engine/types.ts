/**
 * Internal types for trade-up computation.
 * Shared across all engine modules.
 */

export interface DbListing {
  id: string;
  skin_id: string;
  skin_name: string;
  weapon: string;
  price_cents: number;
  float_value: number;
  paint_seed: number | null;
  stattrak: boolean;
  min_float: number;
  max_float: number;
  rarity: string;
  source: string;
}

export interface DbSkinOutcome {
  id: string;
  name: string;
  weapon: string;
  min_float: number;
  max_float: number;
  rarity: string;
  collection_id: string;
  collection_name: string;
}

export interface ListingWithCollection extends DbListing {
  collection_id: string;
  collection_name: string;
  valueRatio?: number; // KNN-predicted fair value ratio: <1.0 = underpriced, >1.0 = overpriced
}

export interface AdjustedListing extends ListingWithCollection {
  adjustedFloat: number; // normalized: (float - min) / (max - min), 0-1
}

export interface PriceAnchor {
  float: number;
  price: number;
}

export type ProgressCallback = (message: string) => void;

/**
 * Collections excluded from trade-up contracts.
 * Armory reward items (Limited Edition) and The Blacksite cannot be used in trade-ups.
 */
export const EXCLUDED_COLLECTIONS = new Set([
  "collection-set-xpshop-wpn-01", // Limited Edition Item (Armory rewards: Aphrodite, Solitude, Heat Treated)
  // Dead Hand Collection (collection-set-community-37) — trade lock lifted March 2026, now included
]);

/** Condition float boundaries — single source of truth for all engine modules. */
export const CONDITION_BOUNDS = [
  { name: "Factory New", min: 0.0, max: 0.07 },
  { name: "Minimal Wear", min: 0.07, max: 0.15 },
  { name: "Field-Tested", min: 0.15, max: 0.38 },
  { name: "Well-Worn", min: 0.38, max: 0.45 },
  { name: "Battle-Scarred", min: 0.45, max: 1.0 },
] as const;

/** A single observation in the KNN cache (pre-weighted by source and age). */
export interface KnnObservation {
  float: number;
  price: number;
  weight: number;   // source_weight × age_decay, already applied
  condition: string;
}

/** Result returned by computeKnnEstimate. All fields always populated. */
export interface KnnEstimate {
  priceCents: number;
  confidence: number;
  observationCount: number;    // neighbors actually used (≤ k for Tier 1, ≤ 2 for Tier 2)
  avgDistance: number;         // mean float distance of neighbors
  conditionObsCount: number;   // total same-condition obs regardless of float distance
  floatCoverage: number;       // fraction of condition's float range covered by obs
}

/** Tunable parameters for KNN — defaults live in knn-pricing.ts. */
export interface KnnConfig {
  k: number;
  minObs: number;
  minInterp: number;
  maxFloatDist: number;
  maxNearestDist: number;
}

/** All inputs to the pure pricing resolver. Pre-computed before calling resolvePriceWithFallbacks. */
export interface FallbackParams {
  knn: KnnEstimate | null;
  refPrice: number;                      // priceCache lookup (CSFloat ref/sales)
  listingFloor: number | null;           // from getListingFloor
  spMedian: number | null;               // from skinportMedianCache
  floatCeiling: number | null;           // from getFloatCeiling
  crossConditionEstimate: number | null; // from cross-condition extrapolation
  skinName: string;
  predictedFloat: number;
  isStarSkin: boolean;
}

/** Result from resolvePriceWithFallbacks. */
export interface FallbackResult {
  grossPrice: number;
  source: string;              // diagnostic label (e.g. "knn", "knn-blend", "ref")
  conditionConfidence: number; // 0–1; 1.0 for non-★ or data-rich ★
}

