/**
 * Marketplace fee constants and cost functions.
 * Single source of truth for buyer fees, seller fees, and effective cost calculations.
 */

import type { ListingWithCollection } from "./types.js";

export const MARKETPLACE_FEES = {
  csfloat:  { buyerFeePct: 0.028, buyerFeeFlat: 30, sellerFee: 0.02 },  // 2.8% + $0.30 wallet deposit
  dmarket:  { buyerFeePct: 0.025, buyerFeeFlat: 0,  sellerFee: 0.02 },
  skinport: { buyerFeePct: 0,     buyerFeeFlat: 0,  sellerFee: 0.08 },  // 8% seller fee (reduced from 12%, July 2025)
  buff:     { buyerFeePct: 0.035, buyerFeeFlat: 15, sellerFee: 0.025 }, // 3.5% + $0.15 deposit, 2.5% seller fee
} as const;

/** Effective cost of a listing, including marketplace buyer fees (deposit/wallet fees) */
export function effectiveBuyCost(listing: ListingWithCollection): number {
  return effectiveBuyCostRaw(listing.price_cents, listing.source ?? "csfloat");
}

/** Effective cost from raw price + source string */
export function effectiveBuyCostRaw(priceCents: number, source: string): number {
  const fees = MARKETPLACE_FEES[source as keyof typeof MARKETPLACE_FEES];
  if (!fees) return priceCents;
  if (fees.buyerFeePct === 0 && fees.buyerFeeFlat === 0) return priceCents;
  return Math.round(priceCents * (1 + fees.buyerFeePct) + fees.buyerFeeFlat);
}

/** Net sell proceeds after marketplace seller fee */
export function effectiveSellProceeds(priceCents: number, source: string): number {
  const fees = MARKETPLACE_FEES[source as keyof typeof MARKETPLACE_FEES];
  const sellerFee = fees?.sellerFee ?? 0.02; // default to 2%
  return Math.round(priceCents * (1 - sellerFee));
}
