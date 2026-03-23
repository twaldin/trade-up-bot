/** Shared types for the DataViewer sub-components */

export interface SkinSummary {
  id: string;
  name: string;
  rarity: string;
  weapon: string;
  min_float: number;
  max_float: number;
  collection_name: string | null;
  listing_count: number;
  sale_count: number;
  new_listings: number;
  new_sales: number;
  min_price: number | null;
  avg_price: number | null;
  max_price: number | null;
  min_float_seen: number | null;
  max_float_seen: number | null;
  prices: Record<string, Record<string, number>>;
}

export interface SkinDetail {
  skin: { id: string; name: string; rarity: string; weapon: string; min_float: number; max_float: number; collection_name: string | null };
  listings: ListingRow[];
  floatBuckets: FloatBucket[];
  priceSources: PriceSourceRow[];
  phasePrices?: Record<string, PriceSourceRow[]>;
  phaseSales?: Record<string, SaleRow[]>;
  saleHistory: SaleRow[];
  stats: { totalListings: number; checkedListings: number; minPrice: number | null; maxPrice: number | null; saleCount: number };
}

export interface ListingRow {
  id: string;
  price_cents: number;
  float_value: number;
  created_at: string;
  staleness_checked_at: string | null;
  phase: string | null;
  source: string;
}

export interface FloatBucket {
  float_min: number;
  float_max: number;
  avg_price_cents: number;
  listing_count: number;
}

export interface PriceSourceRow {
  source: string;
  condition: string;
  avg_price_cents: number;
  volume: number;
}

export interface SaleRow {
  price_cents: number;
  float_value: number;
  sold_at: string;
  source?: string;
}

export type SortDir = "asc" | "desc";

export type SeriesKey = "csfloat" | "dmarket" | "skinport" | "csfloat_sales" | "skinport_sales" | "buff_sales" | "buckets";

export const SOURCE_LABELS: Record<string, string> = {
  csfloat_sales: "CSFloat Sales",
  csfloat_ref: "CSFloat Ref",
  listing: "Listing Floor",
  skinport: "Skinport",
};

export const CONDITION_ORDER = ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"];

/** Consistent chart colors per source */
export const SERIES_COLORS = {
  csfloat: "#3b82f6",        // blue
  dmarket: "#a855f7",        // purple
  skinport: "#f59e0b",       // orange
  csfloat_sales: "#22c55e",  // green (was "sales")
  skinport_sales: "#f87171", // coral/red
  buff_sales: "#eab308",     // gold/yellow
  buckets: "#6b7280",        // gray
} as const;
