/**
 * Daemon state: API budget tracking and data freshness.
 *
 * CSFloat has THREE separate rate limits:
 *   - Listings: 200 per ~30min rolling window (separate pool)
 *   - Sale history: 500 per ~12h window (separate pool)
 *   - Individual: 50,000 per ~12h window (separate pool)
 * They're independent — one can be rate limited while the other has budget.
 *
 * CRITICAL: If any pool hits 0 remaining, ALL pools get locked behind a
 * shared ~12h reset (verified 2026-03-12). We MUST keep a safety buffer
 * to stay in rolling replenishment mode and avoid the 12h lockout.
 *
 * Budget pacing: instead of burning the entire listing pool in one cycle,
 * we drip-feed calls across cycles to maximize discovery frequency.
 * Each cycle gets a fraction of the usable pool (remaining minus safety buffer)
 * proportional to (cycleDuration / timeUntilReset).
 */

const DEFAULT_SALE_BUDGET = 190; // 500 pool / 12h window. Probe detects actual remaining.
const DEFAULT_LISTING_BUDGET = 180; // Conservative buffer from ~200 listing limit

/** Safety buffers — never let remaining drop below these to avoid 12h lockout */
const LISTING_SAFETY_BUFFER = 15;
const SALE_SAFETY_BUFFER = 30;
const INDIVIDUAL_SAFETY_BUFFER = 500; // 50K pool, keep 500 as margin

/** Target total cycle duration — cooldown fills the gap between work phases and this target.
 *  Listing pool (200/~30min) means ~1.5 cycles per reset at 20-min targets → ~130 calls/cycle.
 *  When rate-limited, idle cooldown stretches to conserve individual pool. */
export const TARGET_CYCLE_MS = 12 * 60 * 1000;    // 12 min — batched workers take ~11 min, leaves cooldown for exploration
export const MIN_COOLDOWN_MS = 30 * 1000;          // 30s minimum
export const MAX_COOLDOWN_MS = 20 * 60 * 1000;     // 20 min cap
export const IDLE_COOLDOWN_MS = 15 * 60 * 1000;    // 15 min when no API budget at all

/** Estimated cycle for budget pacing. 15 min = ~100 listing calls, ~14 sale calls, ~1400 individual. */
export const ESTIMATED_CYCLE_MS = 15 * 60 * 1000;

export class BudgetTracker {
  /** Sale history calls (500-limit endpoint, ~12h window) */
  private saleUsed = 0;
  private saleBudget: number;
  /** Listing calls (200-limit endpoint, ~30min window) */
  private listingUsed = 0;
  private listingBudget: number;
  /** Individual lookup calls (50K-limit endpoint, ~12h window) */
  private individualUsed = 0;
  private individualBudget = 40000;
  private _saleRateLimited = false;
  private _listingRateLimited = false;

  /** Reset timestamps (unix seconds) from API probe */
  private _listingResetAt: number | null = null;
  private _saleResetAt: number | null = null;
  private _individualResetAt: number | null = null;
  private _listingPoolTotal: number | null = null;

  constructor(saleBudget: number = DEFAULT_SALE_BUDGET, listingBudget: number = DEFAULT_LISTING_BUDGET) {
    this.saleBudget = saleBudget;
    this.listingBudget = listingBudget;
  }

  useSale(count: number = 1) { this.saleUsed += count; }
  useListing(count: number = 1) { this.listingUsed += count; }
  /** For backward compat — counts as sale history usage */
  use(count: number = 1) { this.saleUsed += count; }

  get saleRemaining() { return this.saleBudget - this.saleUsed; }
  get listingRemaining() { return this.listingBudget - this.listingUsed; }
  get usedCount() { return this.saleUsed + this.listingUsed; }
  get saleCount() { return this.saleUsed; }
  get listingCount() { return this.listingUsed; }
  get remaining() { return this.saleRemaining; }
  hasBudget(needed: number = 1) { return this.saleRemaining >= needed + SALE_SAFETY_BUFFER; }
  hasSaleBudget(needed: number = 1) { return this.saleRemaining >= needed + SALE_SAFETY_BUFFER; }
  hasListingBudget(needed: number = 1) { return this.listingRemaining >= needed + LISTING_SAFETY_BUFFER; }

  markSaleRateLimited() { this._saleRateLimited = true; }
  markListingRateLimited() { this._listingRateLimited = true; }
  markRateLimited() { this._saleRateLimited = true; this._listingRateLimited = true; }
  clearRateLimit() { this._saleRateLimited = false; this._listingRateLimited = false; }
  isSaleRateLimited() { return this._saleRateLimited; }
  isListingRateLimited() { return this._listingRateLimited; }
  isRateLimited() { return this._saleRateLimited && this._listingRateLimited; }

  /** Update from API probe — stores pool sizes and reset timestamps */
  setListingPool(remaining: number | null, resetAt: number | null, limit: number | null) {
    if (remaining !== null) this.listingBudget = remaining;
    this._listingResetAt = resetAt;
    this._listingPoolTotal = limit;
    this.listingUsed = 0; // Reset usage counter — probe gives us actual remaining
  }

  setSalePool(remaining: number | null, resetAt: number | null) {
    if (remaining !== null) this.saleBudget = remaining;
    this._saleResetAt = resetAt;
    this.saleUsed = 0;
  }

  setIndividualPool(remaining: number | null, resetAt: number | null) {
    if (remaining !== null) this.individualBudget = remaining;
    this._individualResetAt = resetAt;
    this.individualUsed = 0;
  }

  useIndividual(count: number = 1) { this.individualUsed += count; }
  get individualRemaining() { return this.individualBudget - this.individualUsed; }
  get individualUsable() { return Math.max(0, this.individualRemaining - INDIVIDUAL_SAFETY_BUFFER); }
  get individualResetAt() { return this._individualResetAt; }
  get individualSafetyBuffer() { return INDIVIDUAL_SAFETY_BUFFER; }

  get listingResetAt() { return this._listingResetAt; }
  get saleResetAt() { return this._saleResetAt; }
  get listingSafetyBuffer() { return LISTING_SAFETY_BUFFER; }
  get saleSafetyBuffer() { return SALE_SAFETY_BUFFER; }

  /**
   * Usable listing calls = remaining minus safety buffer.
   * The safety buffer keeps us above 0 to avoid triggering the 12h lockout.
   */
  get listingUsable() { return Math.max(0, this.listingRemaining - LISTING_SAFETY_BUFFER); }
  get saleUsable() { return Math.max(0, this.saleRemaining - SALE_SAFETY_BUFFER); }

  /**
   * Calculate listing calls to use THIS cycle (budget pacing).
   *
   * Spreads the USABLE pool (remaining minus safety buffer) across cycles
   * until the pool resets. Each cycle gets:
   *   usable / (timeToReset / estimatedCycleDuration)
   *
   * With a minimum of 5 calls (below that, not worth fetching).
   * Returns 0 if we'd eat into the safety buffer.
   */
  cycleListingBudget(cycleDurationMs: number = ESTIMATED_CYCLE_MS): number {
    const usable = this.listingUsable;
    if (usable <= 0) return 0;

    // If we don't know when the pool resets, be conservative
    if (!this._listingResetAt) return Math.min(usable, 30);

    const now = Date.now() / 1000;
    const timeToResetS = Math.max(0, this._listingResetAt - now);

    // If pool resets very soon (<2 min), use all usable — it'll refill
    if (timeToResetS < 120) return usable;

    // How many cycles fit before reset?
    const cycleDurationS = cycleDurationMs / 1000;
    const cyclesUntilReset = Math.max(1, Math.floor(timeToResetS / cycleDurationS));

    // Spread usable evenly across those cycles
    const perCycle = Math.ceil(usable / cyclesUntilReset);

    // Clamp: minimum 5 (worth a fetch), maximum = usable
    return Math.max(5, Math.min(perCycle, usable));
  }

  /**
   * Calculate sale history calls to use THIS cycle.
   * Sale pool is 500/12h so we're less aggressive with pacing.
   * Respects safety buffer to avoid 12h lockout.
   */
  cycleSaleBudget(cycleDurationMs: number = ESTIMATED_CYCLE_MS): number {
    const usable = this.saleUsable;
    if (usable <= 0) return 0;
    if (!this._saleResetAt) return Math.min(usable, 30);

    const now = Date.now() / 1000;
    const timeToResetS = Math.max(0, this._saleResetAt - now);
    if (timeToResetS < 120) return usable;

    const cycleDurationS = cycleDurationMs / 1000;
    const cyclesUntilReset = Math.max(1, Math.floor(timeToResetS / cycleDurationS));
    const perCycle = Math.ceil(usable / cyclesUntilReset);
    return Math.max(3, Math.min(perCycle, usable));
  }

  /**
   * Calculate individual lookup calls to use THIS cycle.
   * 50K/12h pool used for staleness checks + input verification.
   * Paced like listings/sales to avoid exhausting the pool early.
   */
  cycleIndividualBudget(cycleDurationMs: number = ESTIMATED_CYCLE_MS): number {
    const usable = this.individualUsable;
    if (usable <= 0) return 0;
    if (!this._individualResetAt) return Math.min(usable, 500);

    const now = Date.now() / 1000;
    const timeToResetS = Math.max(0, this._individualResetAt - now);
    if (timeToResetS < 120) return usable;

    const cycleDurationS = cycleDurationMs / 1000;
    const cyclesUntilReset = Math.max(1, Math.floor(timeToResetS / cycleDurationS));
    const perCycle = Math.ceil(usable / cyclesUntilReset);
    // Minimum 50 (one batch), max = usable
    return Math.max(50, Math.min(perCycle, usable));
  }
}

export class FreshnessTracker {
  private lastListingChange = 0;
  private lastCalcRun = 0;

  markListingsChanged() { this.lastListingChange = Date.now(); }
  markCalcDone() { this.lastCalcRun = Date.now(); }
  needsRecalc() { return this.lastListingChange > this.lastCalcRun; }
}
