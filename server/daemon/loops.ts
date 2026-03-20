/**
 * Cooldown loop: paced listing staleness checks.
 *
 * Replaces explore-heavy cooldown with pure staleness checking,
 * paced to use the 50K individual lookup pool evenly across ~24h.
 *
 * CSFloat rate limits (per-endpoint):
 *   - Listing search: 200/~1h (probed during cooldown)
 *   - Sale history: 500/~24h
 *   - Individual listing: 50,000/~24h (staleness checks)
 */

import pg from "pg";
import {
  checkListingStaleness,
  checkDMarketStaleness,
  isDMarketConfigured,
} from "../sync.js";
import {
  randomKnifeExplore,
  randomExplore,
  reviveStaleGunTradeUps,
  getKnifeFinishesWithPrices,
  reviveStaleTradeUps,
  CASE_KNIFE_MAP,
  GLOVE_GEN_SKINS,
  type FinishData,
} from "../engine.js";
import { timestamp, setDaemonStatus, updateExplorationStats } from "./utils.js";
import type { FreshnessTracker, BudgetTracker } from "./state.js";

export interface CooldownResult {
  passes: number;
  newFound: number;
  improved: number;
  listingsChecked: number;
  listingsSold: number;
  listingsRemoved: number;
}

/**
 * Staleness checking during cooldown.
 *
 * Target: cover all listings within a few cooldowns. With 50K/24h pool and
 * ~20K listings (after old-unchecked purge), 25% of pool per cooldown = ~12.5K
 * checks, completing a full pass in ~2 cooldowns.
 *
 * When pool is high (>30K), minimizes pacing to check fast.
 */
export async function cooldownLoop(
  pool: pg.Pool,
  durationMs: number,
  options: {
    freshness: FreshnessTracker;
    apiKey: string;
    cycleCount: number;
    budget: BudgetTracker;
    individualRemaining?: number; // Deprecated — use budget instead
  }
): Promise<CooldownResult> {
  const endTime = Date.now() + durationMs;
  let totalListingsChecked = 0;
  let totalListingsSold = 0;
  let totalListingsRemoved = 0;
  let totalSalesRecorded = 0;
  let rateLimited = false;

  const cooldownMinutes = Math.round(durationMs / 60000);
  console.log(`\n[${timestamp()}] Phase 6: Cooldown (${cooldownMinutes} min)`);

  // Use paced budget from BudgetTracker (respects safety buffer + time-to-reset)
  const budgetThisCooldown = options.budget.cycleIndividualBudget();
  const BATCH_SIZE = 75;
  const totalBatches = Math.max(1, Math.ceil(budgetThisCooldown / BATCH_SIZE));
  const batchIntervalMs = Math.max(5000, Math.floor(durationMs / totalBatches));

  console.log(`  Staleness pacing: ${budgetThisCooldown} checks this cooldown (${BATCH_SIZE}/batch, ${Math.round(batchIntervalMs / 1000)}s interval, ${options.budget.individualRemaining} pool remaining, ${options.budget.individualSafetyBuffer} safety buffer)`);

  let batchCount = 0;
  let lastLogTime = Date.now();
  const dmarketEnabled = isDMarketConfigured();
  let dmarketChecked = 0;
  let dmarketRemoved = 0;
  let cooldownExploreFound = 0;
  let cooldownExploreImproved = 0;
  let cooldownRevived = 0;

  while (Date.now() < endTime && !rateLimited && batchCount < totalBatches) {
    batchCount++;
    const timeLeft = Math.round((endTime - Date.now()) / 60000);
    await setDaemonStatus(pool, "fetching", `Staleness ${totalListingsChecked} checked, ${totalListingsSold} sold (${timeLeft} min left)`);

    // Every 5th batch, do DMarket staleness check instead (uses DMarket API, not CSFloat)
    if (dmarketEnabled && batchCount % 5 === 0) {
      try {
        const dmResult = await checkDMarketStaleness(pool, {
          maxChecks: 5, // 5 skin groups per check (2 RPS limit)
          onProgress: (msg) => setDaemonStatus(pool, "fetching", `DMarket: ${msg}`),
        });
        dmarketChecked += dmResult.checked;
        dmarketRemoved += dmResult.removed;
        if (dmResult.removed > 0) options.freshness.markListingsChanged();
      } catch {
        // DMarket errors don't stop CSFloat staleness
      }
      continue; // Skip CSFloat batch for this iteration
    }

    try {
      const checkResult = await checkListingStaleness(pool, {
        apiKey: options.apiKey,
        maxChecks: BATCH_SIZE,
        onProgress: (msg) => setDaemonStatus(pool, "fetching", msg),
      });

      totalListingsChecked += checkResult.checked;
      totalListingsSold += checkResult.sold;
      totalListingsRemoved += checkResult.delisted;
      totalSalesRecorded += checkResult.salesRecorded;

      if (checkResult.checked < BATCH_SIZE) {
        // Likely rate limited — pool exhausted
        rateLimited = true;
        console.log(`  [${timestamp()}] Staleness: rate limited after ${totalListingsChecked} total checks`);
        break;
      }

      if (checkResult.sold > 0 || checkResult.delisted > 0) {
        options.freshness.markListingsChanged();
      }

      // Log progress every 2 minutes
      if (Date.now() - lastLogTime > 120000) {
        console.log(`  [${timestamp()}] Staleness: ${totalListingsChecked} checked, ${totalListingsSold} sold (${totalSalesRecorded} observations), ${totalListingsRemoved} removed${dmarketChecked > 0 ? `, DMarket: ${dmarketChecked} checked/${dmarketRemoved} removed` : ""} (${timeLeft} min left)`);
        lastLogTime = Date.now();
      }
    } catch (err: any) {
      // Rate limited or network error
      if (err?.message?.includes("429")) {
        rateLimited = true;
        console.log(`  [${timestamp()}] Individual lookup pool exhausted after ${totalListingsChecked} checks`);
      }
      break;
    }

    // Use wait time between staleness batches for CPU-only work:
    // random exploration + revival (no API calls, just computation on existing data)
    const nextBatchAt = Date.now() + batchIntervalMs;
    if (nextBatchAt - Date.now() > 3000) {
      // Random explore: fill available CPU time with exploration (3x iterations).
      // Discovery with sig-skipping finishes faster — invest freed time in exploration.
      // VPS runs 24/7 — exploration finds combos structured discovery misses.
      const knifeExp = await randomKnifeExplore(pool, { iterations: 6000 });
      const classifiedExp = await randomExplore(pool, { iterations: 6000 });
      cooldownExploreFound += knifeExp.found + classifiedExp.found;
      cooldownExploreImproved += knifeExp.improved + classifiedExp.improved;

      // Explore lower rarities — rotate through all tiers each batch
      const tierRotation = batchCount % 4;
      if (tierRotation === 0) {
        const exp = await randomExplore(pool, { iterations: 1500, inputRarity: "Restricted" });
        cooldownExploreFound += exp.found;
        cooldownExploreImproved += exp.improved;
      } else if (tierRotation === 1) {
        const exp = await randomExplore(pool, { iterations: 1500, inputRarity: "Mil-Spec" });
        cooldownExploreFound += exp.found;
        cooldownExploreImproved += exp.improved;
      } else if (tierRotation === 2) {
        const exp = await randomExplore(pool, { iterations: 1500, inputRarity: "Industrial Grade" });
        cooldownExploreFound += exp.found;
        cooldownExploreImproved += exp.improved;
      } else {
        const exp = await randomExplore(pool, { iterations: 1500, inputRarity: "Consumer Grade" });
        cooldownExploreFound += exp.found;
        cooldownExploreImproved += exp.improved;
      }

      // Revival: check stale/partial trade-ups EVERY batch (not just every 3rd).
      // Stale trade-ups accumulate fast as listings sell — revival is cheap (CPU-only)
      // and keeping trade-ups alive is more valuable than discovering new low-value ones.
      const gunRevival = await reviveStaleGunTradeUps(pool, 200);
      cooldownRevived += gunRevival.revived;
      if (batchCount % 2 === 0) {
        // Knife revival: pass empty finish cache (revive uses it for re-evaluation)
        const knifeRevival = await reviveStaleTradeUps(pool, new Map(), 200);
        cooldownRevived += knifeRevival.revived;
      }
    }

    while (Date.now() < nextBatchAt && Date.now() < endTime) {
      await new Promise(r => setTimeout(r, Math.min(1000, nextBatchAt - Date.now())));
    }
  }

  // Final summary
  const elapsed = Math.round((durationMs - (endTime - Date.now())) / 60000);
  console.log(`  Staleness total: ${totalListingsChecked} checked, ${totalListingsSold} sold (${totalSalesRecorded} sale observations), ${totalListingsRemoved} removed`);
  if (dmarketChecked > 0) {
    console.log(`  DMarket staleness: ${dmarketChecked} skins checked, ${dmarketRemoved} listings removed`);
  }
  if (cooldownExploreFound > 0 || cooldownExploreImproved > 0 || cooldownRevived > 0) {
    console.log(`  Cooldown work: +${cooldownExploreFound} explored, ${cooldownExploreImproved} improved, ${cooldownRevived} revived`);
  }

  await setDaemonStatus(pool, "waiting", "Starting next cycle");
  console.log(`\n[${timestamp()}] Cooldown done (${elapsed} min, ${totalListingsChecked} staleness checks)`);

  return {
    passes: batchCount,
    newFound: cooldownExploreFound,
    improved: cooldownExploreImproved,
    listingsChecked: totalListingsChecked,
    listingsSold: totalListingsSold,
    listingsRemoved: totalListingsRemoved,
  };
}
