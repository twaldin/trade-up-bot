/**
 * Phase 5: Knife Calc — discovery of knife/glove trade-ups.
 */

import { initDb, emitEvent } from "../../db.js";
import {
  findProfitableKnifeTradeUps,
  randomKnifeExplore,
  mergeTradeUps,
  updateCollectionScores,
  buildPriceCache,
  getKnifeFinishesWithPrices,
  CASE_KNIFE_MAP,
  GLOVE_GEN_SKINS,
  reviveStaleTradeUps,
} from "../../engine.js";
import type { FinishData } from "../../engine.js";
import type { TradeUp } from "../../../shared/types.js";

import { FreshnessTracker } from "../state.js";
import { timestamp, setDaemonStatus } from "../utils.js";

export interface KnifeCalcResult {
  total: number;
  profitable: number;
  topProfit: number;
  avgProfit: number;
}

export function phase5KnifeCalc(
  db: ReturnType<typeof initDb>,
  freshness: FreshnessTracker,
  force: boolean = false,
  discoveryResults?: TradeUp[],
): KnifeCalcResult {
  if (!discoveryResults && !force && !freshness.needsRecalc()) {
    console.log(`\n[${timestamp()}] Phase 5: Knife Calc (skipped — no new data)`);
    return { total: 0, profitable: 0, topProfit: 0, avgProfit: 0 };
  }

  console.log(`\n[${timestamp()}] Phase 5: Knife Calc${discoveryResults ? ' (worker)' : ''}`);
  setDaemonStatus(db, "calculating", "Phase 5: Finding profitable knife trade-ups");
  emitEvent(db, "phase", "Phase 5: Knife Calc");

  // Rebuild price cache (needed even when discovery came from worker)
  if (freshness.needsRecalc() || discoveryResults) {
    buildPriceCache(db, true);
  }

  try {
    const tradeUps = discoveryResults ?? findProfitableKnifeTradeUps(db, {
      onProgress: (msg) => {
        process.stdout.write(`\r  ${msg}                    `);
        setDaemonStatus(db, "calculating", msg);
      },
    });
    if (!discoveryResults) console.log("");

    const profitable = tradeUps.filter(t => t.profit_cents > 0);
    console.log(`  Found ${tradeUps.length} knife trade-ups (${profitable.length} profitable)`);

    // Random knife exploration — uses CPU time saved from theory removal
    setDaemonStatus(db, "calculating", "Phase 5: Random knife exploration");
    const exploreResult = randomKnifeExplore(db, { iterations: 1000 });
    if (exploreResult.found > 0 || exploreResult.improved > 0) {
      console.log(`  Knife explore: ${exploreResult.explored} iterations, +${exploreResult.found} new, ${exploreResult.improved} improved`);
    }

    // Re-sort
    tradeUps.sort((a, b) => b.profit_cents - a.profit_cents);

    if (tradeUps.length > 0) {
      mergeTradeUps(db, tradeUps, "covert_knife");
      console.log(`  Saved ${tradeUps.length} knife trade-ups`);

      const allProfitable = tradeUps.filter(t => t.profit_cents > 0);
      if (allProfitable.length > 0) {
        console.log("  Top knife trade-ups:");
        for (const tu of allProfitable.slice(0, 5)) {
          const inputNames = [...new Set(tu.inputs.map(i => i.skin_name))].join(", ");
          console.log(`    $${(tu.profit_cents / 100).toFixed(2)} profit (${tu.roi_percentage.toFixed(0)}% ROI) $${(tu.total_cost_cents / 100).toFixed(2)} cost | ${inputNames}`);
        }
        emitEvent(db, "calc_complete", `${allProfitable.length} profitable trade-ups, best +$${(allProfitable[0].profit_cents / 100).toFixed(2)}`);
      } else {
        emitEvent(db, "calc_complete", `${tradeUps.length} trade-ups evaluated, 0 profitable`);
      }
    }

    // Revival: try to find replacement listings for stale/partial trade-ups
    {
      setDaemonStatus(db, "calculating", "Phase 5: Reviving stale trade-ups");
      // Build knife finish cache for revival (cheap — DB queries only)
      const revivalCache = new Map<string, FinishData[]>();
      const itemTypes = new Set<string>();
      for (const caseInfo of Object.values(CASE_KNIFE_MAP)) {
        for (const kt of caseInfo.knifeTypes) itemTypes.add(kt);
        if (caseInfo.gloveGen) {
          for (const gt of Object.keys(GLOVE_GEN_SKINS[caseInfo.gloveGen])) itemTypes.add(gt);
        }
      }
      for (const it of itemTypes) {
        const finishes = getKnifeFinishesWithPrices(db, it);
        if (finishes.length > 0) revivalCache.set(it, finishes);
      }

      const revival = reviveStaleTradeUps(db, revivalCache, 500);
      if (revival.revived > 0) {
        console.log(`  Revival: checked ${revival.checked}, revived ${revival.revived} (${revival.improved} improved)`);
      }
    }

    updateCollectionScores(db);

    freshness.markCalcDone();

    const allProfitable = tradeUps.filter(t => t.profit_cents > 0);
    setDaemonStatus(db, "calculating", `Phase 5 done: ${allProfitable.length} profitable knife trade-ups`);

    const topProfit = allProfitable.length > 0 ? allProfitable[0].profit_cents : 0;
    const avgProfit = allProfitable.length > 0
      ? Math.round(allProfitable.reduce((s, t) => s + t.profit_cents, 0) / allProfitable.length)
      : 0;

    return { total: tradeUps.length, profitable: allProfitable.length, topProfit, avgProfit };
  } catch (err) {
    console.error(`  Knife calc error: ${(err as Error).message}`);
    setDaemonStatus(db, "error", (err as Error).message);
    return { total: 0, profitable: 0, topProfit: 0, avgProfit: 0 };
  }
}
