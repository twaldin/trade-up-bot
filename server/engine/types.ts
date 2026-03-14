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
  stattrak: number;
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
]);

/** Condition float boundaries — single source of truth for all engine modules. */
export const CONDITION_BOUNDS = [
  { name: "Factory New", min: 0.0, max: 0.07 },
  { name: "Minimal Wear", min: 0.07, max: 0.15 },
  { name: "Field-Tested", min: 0.15, max: 0.38 },
  { name: "Well-Worn", min: 0.38, max: 0.45 },
  { name: "Battle-Scarred", min: 0.45, max: 1.0 },
] as const;

/**
 * Lightweight theory candidate — optimistic pre-filter before full TradeUp evaluation.
 * Much cheaper than TradeUp (no full outcome/input arrays), designed for 50k+ candidate scans.
 */
export interface TheoryCandidate {
  comboKey: string;           // sorted "colId:quota|colId:quota"
  collectionIds: string[];
  quotas: Map<string, number>;
  normalizedFloat: number;    // target avg_adjusted value
  inputSkinNames: string[];   // one per collection (cheapest at float)
  estimatedCostCents: number; // optimistic cost (cheapest possible)
  estimatedEVCents: number;   // expected value of outputs
  estimatedProfitCents: number;
  roiPct: number;
  outputCondition: string;    // predicted output condition (FN/MW/FT/WW/BS)
  confidence: 'high' | 'medium' | 'low';
  dataGaps: string[];         // "skinName:bucketMin" entries needing validation
  chanceToProfit: number;     // fraction of outcomes above cost
  outcomeCount: number;       // number of distinct outcomes
}

/**
 * Classified→Covert theory candidate (mirrors PessimisticTheory for knife).
 */
export interface ClassifiedTheory {
  collections: string[];
  split: number[];
  inputSkins: { skinName: string; collection: string; priceCents: number; floatValue: number; condition: string }[];
  adjustedFloat: number;
  totalCostCents: number;
  evCents: number;
  profitCents: number;
  roiPct: number;
  outputCondition: string;
  confidence: 'high' | 'medium' | 'low';
  comboKey: string;
  outcomes: { skinName: string; collection: string; probability: number; predictedFloat: number; predictedCondition: string; estimatedPriceCents: number }[];
}
