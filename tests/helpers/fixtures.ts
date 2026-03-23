/**
 * Shared test fixture factories.
 * All test files import from here — never re-declare makeListing/makeOutcome locally.
 */

import type { ListingWithCollection, DbSkinOutcome, AdjustedListing } from "../../server/engine/types.js";
import type { TradeUp, TradeUpInput, TradeUpOutcome } from "../../shared/types.js";
import type { UserTradeUp, SnapshotInput, SnapshotOutcome } from "../../shared/my-trade-ups-types.js";

export function makeListing(overrides: Partial<ListingWithCollection> = {}): ListingWithCollection {
  return {
    id: "listing-1",
    skin_id: "skin-1",
    skin_name: "AK-47 | Redline",
    weapon: "AK-47",
    price_cents: 500,
    float_value: 0.15,
    paint_seed: null,
    stattrak: false,
    min_float: 0.0,
    max_float: 1.0,
    rarity: "Classified",
    source: "csfloat",
    collection_id: "col-1",
    collection_name: "Collection A",
    ...overrides,
  };
}

export function makeAdjustedListing(overrides: Partial<AdjustedListing> = {}): AdjustedListing {
  const base = makeListing(overrides);
  const range = base.max_float - base.min_float;
  return {
    ...base,
    adjustedFloat: range > 0 ? (base.float_value - base.min_float) / range : 0,
    ...overrides,
  };
}

export function makeOutcome(overrides: Partial<DbSkinOutcome> = {}): DbSkinOutcome {
  return {
    id: "skin-out-1",
    name: "AK-47 | Fire Serpent",
    weapon: "AK-47",
    min_float: 0.06,
    max_float: 0.76,
    rarity: "Covert",
    collection_id: "col-1",
    collection_name: "Collection A",
    ...overrides,
  };
}

export function makeTradeUp(overrides: Partial<TradeUp> & {
  listingIds?: string[];
  collectionName?: string;
} = {}): TradeUp {
  const { listingIds, collectionName, ...rest } = overrides;
  const ids = listingIds ?? ["l1", "l2", "l3", "l4", "l5"];
  const col = collectionName ?? "Test Collection";

  const inputs: TradeUpInput[] = ids.map((id) => ({
    listing_id: id,
    skin_id: "skin-1",
    skin_name: "AK-47 | Redline",
    collection_name: col,
    price_cents: 500,
    float_value: 0.15,
    condition: "Field-Tested" as const,
    source: "csfloat",
  }));

  const outcomes: TradeUpOutcome[] = [
    {
      skin_id: "out-1",
      skin_name: "AK-47 | Fire Serpent",
      collection_name: col,
      probability: 1.0,
      predicted_float: 0.15,
      predicted_condition: "Field-Tested" as const,
      estimated_price_cents: 10000,
    },
  ];

  return {
    id: 0,
    inputs,
    outcomes,
    total_cost_cents: ids.length * 500,
    expected_value_cents: 10000,
    profit_cents: 10000 - ids.length * 500,
    roi_percentage: ((10000 - ids.length * 500) / (ids.length * 500)) * 100,
    created_at: new Date().toISOString(),
    ...rest,
  };
}

/** Generate N listings with unique IDs */
export function makeListings(
  n: number,
  overrides: Partial<ListingWithCollection> = {}
): ListingWithCollection[] {
  return Array.from({ length: n }, (_, i) =>
    makeListing({ id: `listing-${i}`, ...overrides })
  );
}

/** Generate N adjusted listings with unique IDs */
export function makeAdjustedListings(
  n: number,
  overrides: Partial<AdjustedListing> = {}
): AdjustedListing[] {
  return Array.from({ length: n }, (_, i) =>
    makeAdjustedListing({ id: `listing-${i}`, ...overrides })
  );
}

/** Make a price observation for KNN tests */
export function makeObservation(overrides: {
  skinName?: string;
  float?: number;
  price?: number;
  source?: string;
  ageDays?: number;
} = {}) {
  return {
    skinName: overrides.skinName ?? "AK-47 | Fire Serpent",
    float: overrides.float ?? 0.15,
    price: overrides.price ?? 5000,
    source: overrides.source ?? "sale",
    ageDays: overrides.ageDays ?? 1,
  };
}

export function makeUserTradeUp(overrides: Partial<UserTradeUp> = {}): UserTradeUp {
  const inputs: SnapshotInput[] = [
    { skin_name: "AK-47 | Redline", collection_name: "Test Collection", price_cents: 500, float_value: 0.15, condition: "Field-Tested", source: "csfloat", stattrak: false },
  ];
  const outcomes: SnapshotOutcome[] = [
    { skin_name: "AK-47 | Fire Serpent", skin_id: "out-1", probability: 1.0, price_cents: 10000, condition: "Field-Tested", predicted_float: 0.15 },
  ];

  return {
    id: 1,
    user_id: "user_pro",
    trade_up_id: 1,
    status: "purchased",
    snapshot_inputs: inputs,
    snapshot_outcomes: outcomes,
    total_cost_cents: 2500,
    expected_value_cents: 10000,
    roi_percentage: 300,
    chance_to_profit: 1.0,
    best_case_cents: 7500,
    worst_case_cents: 7500,
    type: "classified_covert",
    purchased_at: new Date().toISOString(),
    executed_at: null,
    sold_at: null,
    outcome_skin_id: null,
    outcome_skin_name: null,
    outcome_condition: null,
    outcome_float: null,
    sold_price_cents: null,
    sold_marketplace: null,
    actual_profit_cents: null,
    ...overrides,
  };
}
