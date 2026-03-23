export interface SnapshotInput {
  skin_name: string;
  collection_name: string;
  price_cents: number;
  float_value: number;
  condition: string;
  source: string;
  stattrak: boolean;
}

export interface SnapshotOutcome {
  skin_name: string;
  skin_id: string;
  probability: number;
  price_cents: number;
  condition: string;
  predicted_float: number;
}

export type UserTradeUpStatus = "purchased" | "executed" | "sold";

export interface UserTradeUp {
  id: number;
  user_id: string;
  trade_up_id: number;
  status: UserTradeUpStatus;
  snapshot_inputs: SnapshotInput[];
  snapshot_outcomes: SnapshotOutcome[];
  total_cost_cents: number;
  expected_value_cents: number;
  roi_percentage: number;
  chance_to_profit: number;
  best_case_cents: number;
  worst_case_cents: number;
  type: string;
  purchased_at: string;
  executed_at: string | null;
  sold_at: string | null;
  outcome_skin_id: string | null;
  outcome_skin_name: string | null;
  outcome_condition: string | null;
  outcome_float: number | null;
  sold_price_cents: number | null;
  sold_marketplace: string | null;
  actual_profit_cents: number | null;
}

export interface UserTradeUpStats {
  all_time_profit_cents: number;
  total_executed: number;
  total_sold: number;
  win_count: number;
  win_rate: number;
  avg_roi: number;
}

export const VALID_MARKETPLACES = ["csfloat", "skinport", "buff", "steam_market", "other"] as const;
export type Marketplace = typeof VALID_MARKETPLACES[number];
