export const PREFERRED_EXAMPLE_TRADE_UP_ID = 776986117;
export const EXAMPLE_FALLBACK_TYPE = "classified_covert";
export const EXAMPLE_REQUIRED_INPUTS = 10;

export interface CalculatorExampleResolved {
  name: string;
  weapon: string;
  rarity: string;
  min_float: number;
  max_float: number;
  collection_name: string;
  floor_price_cents: number | null;
}

export interface CalculatorExampleSlot {
  skinName: string;
  floatValue: string;
  priceCents: string;
  resolved: CalculatorExampleResolved | null;
}

export interface CalculatorExampleListing {
  skin_name: string;
  float_value: number;
  price_cents: number;
  weapon: string;
  rarity: string;
  min_float: number;
  max_float: number;
  collection_name: string;
}

export interface CalculatorExamplePayload {
  label: "example";
  trade_up_id: number;
  used_fallback: boolean;
  inputs: CalculatorExampleSlot[];
}

export function emptyCalculatorSlots(): CalculatorExampleSlot[] {
  return [{ skinName: "", floatValue: "", priceCents: "", resolved: null }];
}

export function listingNumberToField(value: number): string {
  return String(value);
}

export function slotsFromCurrentListings(
  listings: CalculatorExampleListing[],
): CalculatorExampleSlot[] {
  return listings.map((listing) => ({
    skinName: listing.skin_name,
    floatValue: listingNumberToField(listing.float_value),
    priceCents: listingNumberToField(listing.price_cents),
    resolved: {
      name: listing.skin_name,
      weapon: listing.weapon,
      rarity: listing.rarity,
      min_float: listing.min_float,
      max_float: listing.max_float,
      collection_name: listing.collection_name,
      floor_price_cents: listing.price_cents,
    },
  }));
}

export function isNamedClassifiedRow(row: {
  type?: string;
  input_summary?: { skins: { name: string }[] };
}): boolean {
  if (row.type !== EXAMPLE_FALLBACK_TYPE) return false;
  return (row.input_summary?.skins ?? []).some(
    (skin) => typeof skin.name === "string" && skin.name.trim().length > 0,
  );
}

export function pickCheapestNamedClassified<
  T extends {
    total_cost_cents: number;
    type?: string;
    input_summary?: { skins: { name: string }[] };
  },
>(rows: T[]): T | null {
  const named = rows.filter(isNamedClassifiedRow);
  if (named.length === 0) return null;
  return named.reduce((best, row) => (
    row.total_cost_cents < best.total_cost_cents ? row : best
  ));
}

export function exampleHasUsableListings(
  listings: { skin_name: string }[],
  required = EXAMPLE_REQUIRED_INPUTS,
): boolean {
  return listings.filter((listing) => listing.skin_name.trim().length > 0).length >= required;
}

export function buildExamplePayload(args: {
  tradeUpId: number;
  usedFallback: boolean;
  listings: CalculatorExampleListing[];
}): CalculatorExamplePayload {
  return {
    label: "example",
    trade_up_id: args.tradeUpId,
    used_fallback: args.usedFallback,
    inputs: slotsFromCurrentListings(args.listings),
  };
}
