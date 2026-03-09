// Rarity tiers (low to high)
export const RARITIES = [
  "Consumer Grade",
  "Industrial Grade",
  "Mil-Spec",
  "Restricted",
  "Classified",
  "Covert",
  "Extraordinary",
] as const;
export type Rarity = (typeof RARITIES)[number];

export const RARITY_ORDER: Record<string, number> = {
  "Consumer Grade": 0,
  "Industrial Grade": 1,
  "Mil-Spec": 2,
  Restricted: 3,
  Classified: 4,
  Covert: 5,
  Extraordinary: 6,
};

// Float value -> condition mapping
export const CONDITIONS = [
  { name: "Factory New", abbr: "FN", min: 0.0, max: 0.07 },
  { name: "Minimal Wear", abbr: "MW", min: 0.07, max: 0.15 },
  { name: "Field-Tested", abbr: "FT", min: 0.15, max: 0.38 },
  { name: "Well-Worn", abbr: "WW", min: 0.38, max: 0.45 },
  { name: "Battle-Scarred", abbr: "BS", min: 0.45, max: 1.0 },
] as const;
export type Condition = (typeof CONDITIONS)[number]["name"];

export function floatToCondition(float: number): Condition {
  for (const c of CONDITIONS) {
    if (float < c.max || (c.name === "Battle-Scarred" && float <= c.max)) {
      return c.name;
    }
  }
  return "Battle-Scarred";
}

// Database row types
export interface Collection {
  id: string;
  name: string;
  image_url: string | null;
}

export interface Skin {
  id: string;
  name: string;
  weapon: string;
  min_float: number;
  max_float: number;
  rarity: string;
  stattrak: boolean;
  souvenir: boolean;
  image_url: string | null;
}

export interface SkinWithCollections extends Skin {
  collections: Collection[];
}

export interface Listing {
  id: string;
  skin_id: string;
  price_cents: number;
  float_value: number;
  paint_seed: number | null;
  stattrak: boolean;
  created_at: string;
  source: string;
  // Joined fields
  skin_name?: string;
  weapon?: string;
  rarity?: string;
  min_float?: number;
  max_float?: number;
}

export interface PriceData {
  skin_name: string;
  condition: Condition;
  avg_price_cents: number;
  median_price_cents: number;
  min_price_cents: number;
  volume: number;
  source: string;
  updated_at: string;
}

// Trade-up types
export interface TradeUpOutcome {
  skin_id: string;
  skin_name: string;
  collection_name: string;
  probability: number;
  predicted_float: number;
  predicted_condition: Condition;
  estimated_price_cents: number;
}

export interface TradeUpInput {
  listing_id: string;
  skin_id: string;
  skin_name: string;
  collection_name: string;
  price_cents: number;
  float_value: number;
  condition: Condition;
}

export interface TradeUp {
  id: number;
  inputs: TradeUpInput[];
  outcomes: TradeUpOutcome[];
  total_cost_cents: number;
  expected_value_cents: number;
  profit_cents: number;
  roi_percentage: number;
  created_at: string;
}

// API response types
export interface TradeUpListResponse {
  trade_ups: TradeUp[];
  total: number;
  page: number;
  per_page: number;
}

export interface DaemonStatus {
  phase: "fetching" | "calculating" | "waiting" | "idle" | "error";
  detail: string;
  timestamp: string;
}

export interface TopCollection {
  collection_name: string;
  priority_score: number;
  profitable_count: number;
  avg_profit_cents: number;
}

export interface ExplorationStats {
  cycle: number;
  passes_this_cycle: number;
  total_passes: number;
  last_strategy: string;
  new_tradeups_found: number;
  tradeups_improved: number;
  started_at: string;
}

export interface SyncStatus {
  classified_listings: number;
  classified_skins: number;
  classified_total: number;
  covert_listings: number;
  covert_skins: number;
  covert_total: number;
  covert_sale_prices: number;
  covert_ref_prices: number;
  total_sales: number;
  knife_trade_ups: number;
  knife_profitable: number;
  covert_trade_ups: number;
  covert_profitable: number;
  trade_ups_count: number;
  profitable_count: number;
  last_calculation: string | null;
  daemon_status: DaemonStatus | null;
  top_collections: TopCollection[];
  exploration_stats: ExplorationStats | null;
}
