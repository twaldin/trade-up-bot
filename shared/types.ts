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
  sell_marketplace?: string;
}

export interface TradeUpInput {
  listing_id: string;
  skin_id: string;
  skin_name: string;
  collection_name: string;
  price_cents: number;
  float_value: number;
  condition: Condition;
  source: string;
}

export interface TheoryTracking {
  status: 'profitable' | 'near_miss' | 'invalidated' | 'no_listings' | 'pending';
  real_profit_cents: number | null;
  gap_cents: number;
  attempts: number;
  last_checked_at: string;
  cooldown_until: string | null;
  notes: string | null;
}

export interface TradeUp {
  id: number;
  type?: string; // "classified_covert" | "covert_knife" | "staircase" | "classified_covert_fn"
  inputs: TradeUpInput[];
  outcomes: TradeUpOutcome[];
  total_cost_cents: number;
  expected_value_cents: number;
  profit_cents: number;
  roi_percentage: number;
  created_at: string;
  is_theoretical?: boolean; // true = computed from ref prices only, no real listings
  tracking?: TheoryTracking; // validation status from materialization attempts
  listing_status?: 'active' | 'partial' | 'stale'; // input listing availability
  missing_inputs?: number; // count of inputs whose listings are gone
  chance_to_profit?: number; // probability of profit (pre-computed)
  best_case_cents?: number; // best outcome minus cost (pre-computed)
  worst_case_cents?: number; // worst outcome minus cost (pre-computed)
  outcome_count?: number; // number of possible outcomes (pre-computed, avoids loading full outcomes)
  profit_streak?: number; // consecutive cycles this trade-up has been profitable
  peak_profit_cents?: number; // highest profit ever seen for this trade-up
  preserved_at?: string | null; // when this trade-up was first marked stale
  previous_inputs?: {
    old_profit_cents: number;
    old_cost_cents: number;
    replaced: {
      old: { skin_name: string; price_cents: number; float_value: number; condition: string; listing_id: string };
      new: { skin_name: string; price_cents: number; float_value: number; condition: string; listing_id: string } | null;
    }[];
  } | null;
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
  cycle?: number;
  startedAt?: string;  // ISO timestamp of daemon start
}

export interface TheoryTrackingSummary {
  total: number;
  profitable: number;
  near_miss: number;
  invalidated: number;
  no_listings: number;
  on_cooldown: number;
  avg_gap_cents: number;
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

export interface RefCoverage {
  total: number;
  covered: number;
  pct: number;
  mode: "bootstrap" | "steady_state";
  missing: { knife_glove: number; classified: number; covert_gun: number };
  oldest_age_days: number;
  avg_age_days: number;
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
  knife_active: number;
  knife_partial: number;
  knife_stale: number;
  covert_trade_ups: number;
  covert_profitable: number;
  theory_trade_ups: number;
  theory_profitable: number;
  trade_ups_count: number;
  profitable_count: number;
  theoretical_count: number;
  last_calculation: string | null;
  daemon_status: DaemonStatus | null;
  top_collections: TopCollection[];
  exploration_stats: ExplorationStats | null;
  ref_coverage: RefCoverage | null;
  theory_tracking: TheoryTrackingSummary | null;
  total_skins: number;
  total_listings: number;
  knife_glove_skins: number;
  knife_glove_with_listings: number;
  knife_glove_listings: number;
  collection_count: number;
  collections_with_knives: number;
}
