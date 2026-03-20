/**
 * Shared utility functions for the trade-up engine.
 * Extracted from duplicated inline implementations across discovery, db-ops, and evaluation.
 */

/** Pick a random element from an array. */
export function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Fisher-Yates shuffle, returns a new array. */
export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Listing-combo signature from an array of IDs. */
export function listingSig(ids: string[]): string {
  return [...ids].sort().join(",");
}

/** Parse a CSV listing ID string into a canonical signature. */
export function parseSig(csvIds: string): string {
  return csvIds.split(",").sort().join(",");
}

/**
 * Probability that at least one outcome is profitable.
 * Sum of probability for each outcome where price > cost.
 */
export function computeChanceToProfit(
  outcomes: { estimated_price_cents: number; probability: number }[],
  totalCostCents: number
): number {
  return outcomes.reduce(
    (sum, o) => sum + (o.estimated_price_cents > totalCostCents ? o.probability : 0),
    0
  );
}

/** Best and worst outcome profit relative to cost. */
export function computeBestWorstCase(
  outcomes: { estimated_price_cents: number }[],
  totalCostCents: number
): { bestCase: number; worstCase: number } {
  if (outcomes.length === 0) return { bestCase: 0, worstCase: 0 };
  const bestCase = Math.max(...outcomes.map(o => o.estimated_price_cents)) - totalCostCents;
  const worstCase = Math.min(...outcomes.map(o => o.estimated_price_cents)) - totalCostCents;
  return { bestCase, worstCase };
}

/**
 * Retry a function that may fail with connection errors.
 * PG handles concurrency natively; this only retries transient connection issues.
 */
export async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3, label = "DB operation"): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const msg = (err as Error).message ?? "";
      const code = (err as { code?: string }).code ?? "";
      const isTransient = code === "ECONNREFUSED" || code === "ECONNRESET" || code === "57P01" || msg.includes("Connection terminated");
      if (isTransient && attempt < maxRetries) {
        const waitMs = 1000 * Math.pow(2, attempt);
        console.log(`  ${label}: connection error (${code}), retrying in ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
        continue;
      }
      throw err;
    }
  }
  throw new Error("unreachable");
}
