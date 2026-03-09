/**
 * Diversity-controlled result store for trade-up discovery.
 * Keeps top N per collection-combo signature to ensure diverse results.
 */

import type { TradeUp } from "../../shared/types.js";

export class TradeUpStore {
  private bySignature = new Map<string, TradeUp[]>();
  private seen = new Set<string>();
  private maxPerSignature: number;
  total = 0;

  constructor(maxPerSignature: number = 20) {
    this.maxPerSignature = maxPerSignature;
  }

  private getSignature(tu: TradeUp): string {
    const cols = [...new Set(tu.inputs.map((i) => i.collection_name))].sort();
    return cols.join("|");
  }

  add(tu: TradeUp | null): boolean {
    if (!tu) return false;
    if (tu.expected_value_cents === 0) return false;

    const key = tu.inputs.map((i) => i.listing_id).sort().join(",");
    if (this.seen.has(key)) return false;
    this.seen.add(key);

    const sig = this.getSignature(tu);
    const bucket = this.bySignature.get(sig) ?? [];

    if (bucket.length >= this.maxPerSignature) {
      const worst = bucket[bucket.length - 1];
      if (tu.profit_cents > worst.profit_cents) {
        bucket[bucket.length - 1] = tu;
        bucket.sort((a, b) => b.profit_cents - a.profit_cents);
        return true;
      }
      return false;
    }

    bucket.push(tu);
    bucket.sort((a, b) => b.profit_cents - a.profit_cents);
    this.bySignature.set(sig, bucket);
    this.total++;
    return true;
  }

  getAll(limit: number): TradeUp[] {
    const all: TradeUp[] = [];
    for (const bucket of this.bySignature.values()) {
      all.push(...bucket);
    }
    all.sort((a, b) => b.profit_cents - a.profit_cents);
    return all.slice(0, limit);
  }

  getSignatureCount(): number {
    return this.bySignature.size;
  }
}
