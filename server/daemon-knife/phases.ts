/**
 * Daemon phase implementations — barrel re-export from phases/ submodules.
 *
 * Phase 1: Housekeeping (purge stale, prune observations)
 * Phase 2: Theory (price cache + bootstrap + theory gen — pure computation, no API)
 * Phase 3: API Probe (rate limit detection)
 * Phase 4: Data Fetch (sale history, listings, theory-guided wanted list)
 * Phase 4.5: Verify profitable inputs (individual lookup pool)
 * Phase 5: Knife Calc (only if data changed)
 * Phase 5b: Classified Calc
 * Phase 5c: Staircase
 * Phase 5e/5f: Generic rarity tiers
 * Phase 6: Cooldown (staleness checks)
 * Phase 7: Re-materialization (re-check theories with updated data)
 */

export { clearDiscoveryProfitableCooldowns, phase1Housekeeping } from "./phases/housekeeping.js";
export {
  phase2Theory,
  phase2ClassifiedTheory,
  phase2cStaircaseTheory,
  printTheoryAccuracy,
  type TheoryResult,
  type ClassifiedTheoryResult,
  type ClassifiedCalcResult,
  type StaircaseTheoryPhaseResult,
} from "./phases/theory.js";
export { phase3ApiProbe, phase4DataFetch, phase4p5VerifyInputs } from "./phases/data-fetch.js";
export { phase5KnifeCalc, phase7Rematerialization, type KnifeCalcResult } from "./phases/knife-calc.js";
export {
  phase5ClassifiedCalc,
  phase5GenericCalc,
  phase5cStaircase,
} from "./phases/classified-calc.js";
