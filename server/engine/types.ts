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
