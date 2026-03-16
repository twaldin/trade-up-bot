/**
 * Daemon phase implementations — barrel re-export from phases/ submodules.
 *
 * Phase 1: Housekeeping (purge stale, prune observations)
 * Phase 3: API Probe (rate limit detection)
 * Phase 4: Data Fetch (sale history, listings)
 * Phase 4.5: Verify profitable inputs (individual lookup pool)
 * Phase 5: Knife Calc (only if data changed)
 * Phase 5b: Classified Calc
 * Phase 5c: Staircase
 * Phase 5e/5f: Generic rarity tiers
 * Phase 6: Cooldown (staleness checks)
 */

export { phase1Housekeeping } from "./phases/housekeeping.js";
export { phase3ApiProbe, phase4DataFetch, phase4p5VerifyInputs } from "./phases/data-fetch.js";
export { phase5KnifeCalc, type KnifeCalcResult } from "./phases/knife-calc.js";
export {
  phase5ClassifiedCalc,
  phase5GenericCalc,
  phase5cStaircase,
} from "./phases/classified-calc.js";
