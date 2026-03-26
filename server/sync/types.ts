
// Skip listings older than this many days (CSFloat created_at = when seller listed)
export const MAX_LISTING_AGE_DAYS = 90;

export const CSFLOAT_BASE = "https://csfloat.com/api/v1";

export const COLLECTIONS_URL = "https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/collections.json";
export const SKINS_URL = "https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/skins_not_grouped.json";

import { CONDITION_BOUNDS } from "../engine/types.js";

/** @deprecated Use CONDITION_BOUNDS directly from engine/types.js */
export const CONDITION_FROM_FLOAT = CONDITION_BOUNDS;

// High-value single-Covert collections — their Classified inputs are always worth fetching
export const HIGH_VALUE_COLLECTIONS = [
  "The Cobblestone Collection",     // → AWP Dragon Lore
  "The St. Marc Collection",       // → AK-47 Wild Lotus
  "The Norse Collection",          // → AWP Gungnir
  "The Rising Sun Collection",     // → AUG Akihabara Accept
  "The Gods and Monsters Collection", // → AWP Medusa
  "The Havoc Collection",          // → AK-47 X-Ray
  "The Anubis Collection",         // → M4A4 Eye of Horus
];

// ByMykel API types
export interface RawCollection {
  id: string;
  name: string;
  image: string;
  contains: { id: string; name: string; rarity: { name: string } }[];
}

export interface RawSkin {
  id: string;
  skin_id: string; // Base skin ID without wear suffix
  name: string; // Includes condition, e.g., "AK-47 | Redline (Field-Tested)"
  weapon?: { name: string };
  min_float: number | null;
  max_float: number | null;
  rarity: { name: string };
  stattrak: boolean;
  souvenir: boolean;
  image: string | null;
  market_hash_name?: string;
  wear?: { name: string };
}

// CSFloat types
export interface CSFloatListing {
  id: string;
  type: string; // "buy_now" or "auction"
  price: number; // cents
  item: {
    market_hash_name: string;
    float_value: number;
    paint_seed: number;
    stickers?: unknown[];
  };
  reference?: {
    base_price: number; // CSFloat's estimated market price in cents
    predicted_price: number;
    float_factor: number;
    quantity: number;
    last_updated: string;
  };
  created_at: string;
}

export interface CSFloatResponse {
  data: CSFloatListing[];
}

export interface CSFloatSaleEntry {
  id: string;
  created_at: string;
  type: string;
  price: number;
  state: string;
  reference?: {
    base_price: number;
    predicted_price: number;
    float_factor: number;
    quantity: number;
    last_updated: string;
  };
  item: {
    asset_id: string;
    market_hash_name: string;
    float_value: number;
    paint_seed?: number;
    is_stattrak: boolean;
    rarity: number;
  };
}

export interface SkinCoverageInfo {
  id: string;
  name: string;
  rarity: string;
  min_float: number;
  max_float: number;
  listing_count: number;
  condition_count: number;
}

export interface SmartFetchSkin {
  id: string;
  name: string;
  min_float: number;
  max_float: number;
  listing_count: number;
  fn_count: number;
  newest_age_days: number;
  is_high_value: boolean;
  priority: number;
}

export interface ListingCheckResult {
  checked: number;
  stillListed: number;
  sold: number;
  delisted: number;
  errors: number;
  salesRecorded: number;
}
