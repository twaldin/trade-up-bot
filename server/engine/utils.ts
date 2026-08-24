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

/**
 * Weighted random strategy selection.
 * If customWeights is provided, uses those directly.
 * Otherwise, strategies in floatBiasedCases get 2x probability.
 */
export function pickWeightedStrategy(maxStrategy: number, floatBiasedCases: number[], customWeights?: number[]): number {
  const weights = customWeights
    ?? Array.from({ length: maxStrategy }, (_, i) => floatBiasedCases.includes(i) ? 2 : 1);
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return maxStrategy - 1;
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

const TRANSIENT_PG_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "57P01", // admin_shutdown
  "57P02", // crash shutdown
  "57P03", // cannot_connect_now
  "53300", // too_many_connections
]);

/**
 * Transient Postgres / pool errors that should be retried, not treated as fatal.
 * Includes the live daemon-crash message from node-pg Pool:
 *   "timeout exceeded when trying to connect"
 */
function errorCode(err: unknown): string {
  if (typeof err !== "object" || err === null || !("code" in err)) return "";
  return typeof err.code === "string" ? err.code : "";
}

export function isTransientDbError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  const code = errorCode(err);
  if (TRANSIENT_PG_CODES.has(code)) return true;
  const lower = msg.toLowerCase();
  return (
    lower.includes("connection terminated") ||
    lower.includes("timeout exceeded when trying to connect") ||
    lower.includes("remaining connection slots are reserved") ||
    lower.includes("too many clients already")
  );
}

/**
 * Retry a function that may fail with connection errors.
 * PG handles concurrency natively; this only retries transient connection issues.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  label = "DB operation",
  backoffMs = 1000,
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      if (isTransientDbError(err) && attempt < maxRetries) {
        const waitMs = backoffMs * Math.pow(2, attempt);
        const code = errorCode(err);
        const detail = code || (err instanceof Error ? err.message : "unknown");
        console.log(`  ${label}: connection error (${detail}), retrying in ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})`);
        if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
        continue;
      }
      throw err;
    }
  }
  throw new Error("unreachable");
}
