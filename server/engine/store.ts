/**
 * Diversity-controlled result store for trade-up discovery.
 * Keeps top N per collection-combo signature to ensure diverse results.
 *
 * Scoring considers both profit and chance-to-profit:
 * - Trade-ups with >25% chance to profit are kept even if EV-negative
 * - Sorting uses a composite score: profit + (chanceToProfit * 10000 bonus)
 */

import type { TradeUp } from "../../shared/types.js";
import { computeChanceToProfit as computeCTP, listingSig } from "./utils.js";

/** Compute chance-to-profit for a TradeUp object. */
function chanceToProfit(tu: TradeUp): number {
  if (!tu.outcomes || tu.outcomes.length === 0) return 0;
  return computeCTP(tu.outcomes, tu.total_cost_cents);
}

/** Composite score: profitable trade-ups first, then by chance-to-profit for similar profit. */
function tradeUpScore(tu: TradeUp): number {
  const ctp = tu.chance_to_profit ?? chanceToProfit(tu);
  // Profit is primary, but high-chance low-profit trade-ups get a bonus
  return tu.profit_cents + (ctp > 0.25 ? ctp * 5000 : 0);
}

export class TradeUpStore {
  private bySignature = new Map<string, TradeUp[]>();
  private seen = new Set<string>();
  private maxPerSignature: number;
  total = 0;

  constructor(maxPerSignature: number = 20, existingSignatures?: Set<string>) {
    this.maxPerSignature = maxPerSignature;
    if (existingSignatures) this.seen = existingSignatures;
  }

  private getSignature(tu: TradeUp): string {
    const cols = [...new Set(tu.inputs.map((i) => i.collection_name))].sort();
    return cols.join("|");
  }

  add(tu: TradeUp | null): boolean {
    if (!tu) return false;
    if (tu.expected_value_cents === 0) return false;

    // Compute and attach chance_to_profit for downstream use
    if (tu.chance_to_profit === undefined) {
      tu.chance_to_profit = chanceToProfit(tu);
    }

    // Keep trade-ups that are profitable OR have >25% chance to profit
    if (tu.profit_cents <= 0 && (tu.chance_to_profit ?? 0) < 0.25) return false;

    const key = listingSig(tu.inputs.map(i => i.listing_id));
    if (this.seen.has(key)) return false;
    this.seen.add(key);

    const sig = this.getSignature(tu);
    const bucket = this.bySignature.get(sig) ?? [];
    const score = tradeUpScore(tu);

    if (bucket.length >= this.maxPerSignature) {
      const worst = bucket[bucket.length - 1];
      if (score > tradeUpScore(worst)) {
        bucket[bucket.length - 1] = tu;
        bucket.sort((a, b) => tradeUpScore(b) - tradeUpScore(a));
        return true;
      }
      return false;
    }

    bucket.push(tu);
    bucket.sort((a, b) => tradeUpScore(b) - tradeUpScore(a));
    this.bySignature.set(sig, bucket);
    this.total++;
    return true;
  }

  getAll(limit: number): TradeUp[] {
    const all: TradeUp[] = [];
    for (const bucket of this.bySignature.values()) {
      all.push(...bucket);
    }
    all.sort((a, b) => tradeUpScore(b) - tradeUpScore(a));
    return all.slice(0, limit);
  }

  getSignatureCount(): number {
    return this.bySignature.size;
  }

  /** Check if a listing-ID combo is already known (for pre-evaluation sig-skipping). */
  hasSig(sig: string): boolean {
    return this.seen.has(sig);
  }
}
