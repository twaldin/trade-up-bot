/**
 * Phase 5: Knife Calc — discovery + materialization of knife/glove trade-ups.
 * Phase 7: Re-materialization — re-check theories with updated data.
 */

import { initDb, emitEvent } from "../../db.js";
import {
  findProfitableKnifeTradeUps,
  saveClassifiedTradeUps,
  updateCollectionScores,
  buildPriceCache,
  getListingsForRarity,
  addAdjustedFloat,
  selectForFloatTarget,
  selectForFloatTargetFloatGreedy,
  selectLowestFloat,
  evaluateKnifeTradeUp,
  getKnifeFinishesWithPrices,
  CASE_KNIFE_MAP,
  KNIFE_WEAPONS,
  GLOVE_GEN_SKINS,
  theoryComboKey,
  saveTheoryValidations,
  saveNearMissesToDb,
  reviveStaleTradeUps,
  type NearMissInfo,
  type PessimisticTheory,
  type TheoryValidationResult,
} from "../../engine.js";
import type { AdjustedListing, FinishData } from "../../engine.js";
import type { TradeUp } from "../../../shared/types.js";

import { FreshnessTracker } from "../state.js";
import { timestamp, setDaemonStatus } from "../utils.js";
import { clearDiscoveryProfitableCooldowns } from "./housekeeping.js";
import type { TheoryResult } from "./theory.js";

export interface KnifeCalcResult {
  total: number;
  profitable: number;
  topProfit: number;
  avgProfit: number;
  nearMisses: NearMissInfo[];  // Near-miss combos to boost next cycle's wanted list
}

interface MaterializeResult {
  attempted: number;
  found: number;
  profitable: number;
  tradeUps: TradeUp[];
  comparison: { combo: string; theoryProfit: number; realProfit: number; theoryCost: number; realCost: number }[];
  nearMisses: { combo: string; theoryProfit: number; realProfit: number; gap: number }[];
}

interface DeepScanResult {
  scanned: number;
  found: number;
  profitable: number;
  tradeUps: TradeUp[];
}

export function phase5KnifeCalc(
  db: ReturnType<typeof initDb>,
  freshness: FreshnessTracker,
  force: boolean = false,
  theoryFloatTargets: number[] = [],
  theories: PessimisticTheory[] = [],
  discoveryResults?: TradeUp[],
): KnifeCalcResult {
  if (!discoveryResults && !force && !freshness.needsRecalc()) {
    console.log(`\n[${timestamp()}] Phase 5: Knife Calc (skipped — no new data)`);
    return { total: 0, profitable: 0, topProfit: 0, avgProfit: 0, nearMisses: [] };
  }

  console.log(`\n[${timestamp()}] Phase 5: Knife Calc${discoveryResults ? ' (worker)' : ''}`);
  setDaemonStatus(db, "calculating", "Phase 5: Finding profitable knife trade-ups");
  emitEvent(db, "phase", "Phase 5: Knife Calc");

  // Rebuild price cache (needed for materialization even when discovery came from worker)
  if (freshness.needsRecalc() || discoveryResults) {
    buildPriceCache(db, true);
  }

  try {
    const tradeUps = discoveryResults ?? findProfitableKnifeTradeUps(db, {
      onProgress: (msg) => {
        process.stdout.write(`\r  ${msg}                    `);
        setDaemonStatus(db, "calculating", msg);
      },
      extraTransitionPoints: theoryFloatTargets,
    });
    if (!discoveryResults) console.log("");

    const profitable = tradeUps.filter(t => t.profit_cents > 0);
    console.log(`  Found ${tradeUps.length} knife trade-ups (${profitable.length} profitable)`);

    let cycleNearMisses: NearMissInfo[] = [];

    // Materialization: try to build real trade-ups from every theory
    if (theories.length > 0) {
      setDaemonStatus(db, "calculating", "Phase 5: Materializing theories");
      const matResult = materializeTheories(db, theories);

      if (matResult.found > 0) {
        // Add materialized trade-ups to discovery results (merge-save deduplicates by signature)
        const existingSigs = new Set(tradeUps.map(t => t.inputs.map(i => i.listing_id).sort().join(",")));
        let added = 0;
        for (const tu of matResult.tradeUps) {
          const sig = tu.inputs.map(i => i.listing_id).sort().join(",");
          if (!existingSigs.has(sig)) {
            tradeUps.push(tu);
            existingSigs.add(sig);
            added++;
          }
        }

        console.log(`  Materialized: ${matResult.attempted} theories tried, ${matResult.found} built, ${matResult.profitable} profitable (${added} new beyond discovery)`);
        if (matResult.comparison.length > 0) {
          const profitableComps = matResult.comparison.filter(c => c.realProfit > 0);
          if (profitableComps.length > 0) {
            const avgTheory = Math.round(profitableComps.reduce((s, c) => s + c.theoryProfit, 0) / profitableComps.length);
            const avgReal = Math.round(profitableComps.reduce((s, c) => s + c.realProfit, 0) / profitableComps.length);
            console.log(`    Pricing accuracy (${profitableComps.length} profitable): theory avg $${(avgTheory / 100).toFixed(2)} vs real avg $${(avgReal / 100).toFixed(2)}`);
          }
        }
        // Near-miss combos — theory says profitable but real is close
        if (matResult.nearMisses.length > 0) {
          console.log(`    Near-misses (${matResult.nearMisses.length} combos within $100 of profit):`);
          for (const nm of matResult.nearMisses.slice(0, 5)) {
            const colShort = nm.combo.replace(/The /g, "").replace(/ Collection/g, "").replace(/,/g, " + ");
            console.log(`      ${colShort}: theory +$${(nm.theoryProfit / 100).toFixed(2)}, real -$${(nm.gap / 100).toFixed(2)} (need $${(nm.gap / 100).toFixed(2)} cheaper)`);
          }
          // Save near-misses for next cycle's wanted list boost
          cycleNearMisses = matResult.nearMisses.map(nm => ({
            combo: nm.combo,
            gap: nm.gap,
            theoryProfit: nm.theoryProfit,
          }));
        }
      } else {
        console.log(`  Materialized: ${matResult.attempted} theories tried, none could be built from real listings`);
      }

      // Record theory validation results
      // Validation measures ACCURACY: how close theory prediction matched reality.
      // A theory predicting +$2800 that reality shows +$10 is NOT "validated" —
      // it's wildly inaccurate even though both are technically profitable.
      {
        setDaemonStatus(db, "calculating", "Phase 5: Recording theory validations");
        const validationResults: TheoryValidationResult[] = [];

        // Track which theories were materialized (had listings)
        const materializedCombos = new Set(matResult.comparison.map(c => c.combo));

        for (const theory of theories) {
          const ck = theoryComboKey(theory.collections, theory.split);
          const comboStr = theory.collections.join(",");

          // Check if this theory was materialized
          const comp = matResult.comparison.find(c => c.combo === comboStr);
          const nm = matResult.nearMisses.find(n => n.combo === comboStr);

          if (comp) {
            // Accuracy-based status: how close was the theory to reality?
            const profitError = Math.abs(comp.theoryProfit - comp.realProfit);
            const costError = Math.abs(comp.theoryCost - comp.realCost);
            const roiTheory = comp.theoryCost > 0 ? comp.theoryProfit / comp.theoryCost : 0;
            const roiReal = comp.realCost > 0 ? comp.realProfit / comp.realCost : 0;
            const roiError = Math.abs(roiTheory - roiReal);

            let status: 'profitable' | 'near_miss' | 'invalidated';
            if (comp.realProfit > 0 && profitError < Math.max(500, Math.abs(comp.realProfit) * 0.5)) {
              // Theory was right direction AND within 50% or $5 of real profit
              status = 'profitable';
            } else if (comp.realProfit > -10000 && (nm || profitError < 20000)) {
              // Real result within $100 of breaking even, or theory was <$200 off
              status = 'near_miss';
            } else {
              status = 'invalidated';
            }

            const accuracyNote = `accuracy: profit_err=$${(profitError / 100).toFixed(2)}, cost_err=$${(costError / 100).toFixed(2)}, roi_err=${(roiError * 100).toFixed(0)}%`;

            validationResults.push({
              combo_key: ck,
              status,
              theory_profit_cents: comp.theoryProfit,
              real_profit_cents: comp.realProfit,
              cost_gap_cents: comp.theoryCost - comp.realCost,
              ev_gap_cents: (comp.theoryProfit + comp.theoryCost) - (comp.realProfit + comp.realCost),
              notes: `theory_cost=$${(comp.theoryCost / 100).toFixed(2)},real_cost=$${(comp.realCost / 100).toFixed(2)},${accuracyNote}`,
            });
          } else if (!materializedCombos.has(comboStr) && theory.profitCents > 0) {
            // Theory was profitable but couldn't be materialized (no listings)
            validationResults.push({
              combo_key: ck,
              status: 'no_listings',
              theory_profit_cents: theory.profitCents,
              real_profit_cents: null,
              cost_gap_cents: 0,
              ev_gap_cents: 0,
              notes: `needs_listings_for:${theory.inputSkins.map(i => i.skinName).join(",")}`,
            });
          }
        }

        if (validationResults.length > 0) {
          saveTheoryValidations(db, validationResults);
          const statusCounts = validationResults.reduce((acc, r) => {
            acc[r.status] = (acc[r.status] ?? 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          console.log(`  Validation: ${validationResults.length} results recorded (${Object.entries(statusCounts).map(([k, v]) => `${v} ${k}`).join(", ")})`);

          // Log accuracy summary
          const withReal = validationResults.filter(r => r.real_profit_cents !== null);
          if (withReal.length > 0) {
            const avgProfitErr = Math.round(withReal.reduce((s, r) => s + Math.abs(r.theory_profit_cents - (r.real_profit_cents ?? 0)), 0) / withReal.length);
            const avgCostErr = Math.round(withReal.reduce((s, r) => s + Math.abs(r.cost_gap_cents), 0) / withReal.length);
            console.log(`  Theory accuracy: avg profit error $${(avgProfitErr / 100).toFixed(2)}, avg cost error $${(avgCostErr / 100).toFixed(2)} (${withReal.length} validated)`);
          }
        }

        // Persist near-misses to DB (survives daemon restarts)
        if (cycleNearMisses.length > 0) {
          saveNearMissesToDb(db, cycleNearMisses);
          console.log(`  Persisted ${cycleNearMisses.length} near-misses to DB`);
        }
      }

      // Theory-targeted deep scan
      // For theory-profitable combos, do a dense 50-point float scan
      // Discovery uses 9 points for ALL pairs; this does 50 for the best combos
      setDaemonStatus(db, "calculating", "Phase 5: Theory-targeted deep scan");
      const deepScanResult = theoryTargetedDeepScan(db, theories, tradeUps, matResult);
      if (deepScanResult.found > 0) {
        for (const tu of deepScanResult.tradeUps) {
          tradeUps.push(tu);
        }
        console.log(`  Deep scan: ${deepScanResult.scanned} theory combos, ${deepScanResult.found} new trade-ups (${deepScanResult.profitable} profitable)`);
      }
    }

    // Re-sort after adding materialized results
    tradeUps.sort((a, b) => b.profit_cents - a.profit_cents);

    if (tradeUps.length > 0) {
      saveClassifiedTradeUps(db, tradeUps, "covert_knife");
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

      const revival = reviveStaleTradeUps(db, revivalCache, 200);
      if (revival.revived > 0) {
        console.log(`  Revival: checked ${revival.checked}, revived ${revival.revived} (${revival.improved} improved)`);
      }
    }

    updateCollectionScores(db);

    // Discovery override: clear cooldowns for combos that discovery proves profitable
    // Materialization may fail at theory's float target (e.g., FN) while discovery
    // finds the same combo profitable at a different float (e.g., FT). Don't let
    // materialization's failure suppress a known-good combo.
    {
      const cleared = clearDiscoveryProfitableCooldowns(db);
      if (cleared > 0) {
        console.log(`  Discovery override: cleared cooldowns for ${cleared} profitable combos`);
      }
    }

    freshness.markCalcDone();

    const allProfitable = tradeUps.filter(t => t.profit_cents > 0);
    setDaemonStatus(db, "calculating", `Phase 5 done: ${allProfitable.length} profitable knife trade-ups`);

    const topProfit = allProfitable.length > 0 ? allProfitable[0].profit_cents : 0;
    const avgProfit = allProfitable.length > 0
      ? Math.round(allProfitable.reduce((s, t) => s + t.profit_cents, 0) / allProfitable.length)
      : 0;

    return { total: tradeUps.length, profitable: allProfitable.length, topProfit, avgProfit, nearMisses: cycleNearMisses };
  } catch (err) {
    console.error(`  Knife calc error: ${(err as Error).message}`);
    setDaemonStatus(db, "error", (err as Error).message);
    return { total: 0, profitable: 0, topProfit: 0, avgProfit: 0, nearMisses: [] };
  }
}

export function phase7Rematerialization(
  db: ReturnType<typeof initDb>,
  theoryResult: TheoryResult,
  previousNearMisses: NearMissInfo[]
): NearMissInfo[] {
  console.log(`\n[${timestamp()}] Phase 7: Re-materialization`);
  setDaemonStatus(db, "calculating", "Phase 7: Re-checking theories with updated data");

  // Rebuild price cache with any new sale observations
  buildPriceCache(db, true);

  // Re-run materialization with the same theories
  const rematResult = materializeTheories(db, theoryResult.theories);
  if (rematResult.found > 0 || rematResult.nearMisses.length > 0) {
    console.log(`  Re-materialized: ${rematResult.found} built, ${rematResult.profitable} profitable, ${rematResult.nearMisses.length} near-misses`);

    // Record updated validations
    const revalidationResults: TheoryValidationResult[] = [];
    for (const comp of rematResult.comparison) {
      // Find the theory for this combo
      const theory = theoryResult.theories.find(t => t.collections.join(",") === comp.combo);
      if (!theory) continue;
      const ck = theoryComboKey(theory.collections, theory.split);
      const nm = rematResult.nearMisses.find(n => n.combo === comp.combo);
      const status = comp.realProfit > 0 ? 'profitable' as const
        : nm ? 'near_miss' as const
        : 'invalidated' as const;
      revalidationResults.push({
        combo_key: ck,
        status,
        theory_profit_cents: comp.theoryProfit,
        real_profit_cents: comp.realProfit,
        cost_gap_cents: comp.theoryCost - comp.realCost,
        ev_gap_cents: (comp.theoryProfit + comp.theoryCost) - (comp.realProfit + comp.realCost),
        notes: `remat_after_staleness`,
      });
    }
    if (revalidationResults.length > 0) {
      saveTheoryValidations(db, revalidationResults);
    }

    // Update near-misses if we found better ones
    if (rematResult.nearMisses.length > 0) {
      const updatedNearMisses = rematResult.nearMisses.map(nm => ({
        combo: nm.combo,
        gap: nm.gap,
        theoryProfit: nm.theoryProfit,
      }));
      saveNearMissesToDb(db, updatedNearMisses);
      // Use the freshest near-misses for next cycle
      previousNearMisses = updatedNearMisses;
    }

    // If profitable trade-ups were found, merge them in
    if (rematResult.profitable > 0) {
      console.log(`  New profitable trade-ups found during re-materialization!`);
      // Re-save to merge any new profitable results
      const existingTradeUps = findProfitableKnifeTradeUps(db, {
        onProgress: () => {},
        extraTransitionPoints: theoryResult.bestFloatTargets,
      });
      for (const tu of rematResult.tradeUps) {
        const sig = tu.inputs.map(i => i.listing_id).sort().join(",");
        const exists = existingTradeUps.some(e => e.inputs.map(i => i.listing_id).sort().join(",") === sig);
        if (!exists) existingTradeUps.push(tu);
      }
      existingTradeUps.sort((a, b) => b.profit_cents - a.profit_cents);
      saveClassifiedTradeUps(db, existingTradeUps, "covert_knife");
    }
  } else {
    console.log(`  Re-materialization: no changes`);
  }

  // Re-run discovery override after Phase 7 — re-materialization's
  // saveTheoryValidations may have re-set cooldowns that Phase 5 cleared
  const cleared7 = clearDiscoveryProfitableCooldowns(db);
  if (cleared7 > 0) {
    console.log(`  Phase 7 discovery override: cleared cooldowns for ${cleared7} profitable combos`);
  }

  return previousNearMisses;
}

/**
 * Try to build real trade-ups from every saved theory.
 * For each theory: extract collection quotas + target float, find matching real listings,
 * evaluate. Zero API cost — pure computation on existing listing data.
 */
function materializeTheories(
  db: ReturnType<typeof initDb>,
  theories: PessimisticTheory[]
): MaterializeResult {
  // Load all Covert gun listings
  const allListings = getListingsForRarity(db, "Covert")
    .filter(l => !(KNIFE_WEAPONS as readonly string[]).includes(l.weapon));

  if (allListings.length === 0) {
    return { attempted: 0, found: 0, profitable: 0, tradeUps: [], comparison: [], nearMisses: [] };
  }

  // Group by collection with adjusted floats
  const allAdjusted = addAdjustedFloat(allListings);
  const byColAdj = new Map<string, AdjustedListing[]>();
  for (const l of allAdjusted) {
    const list = byColAdj.get(l.collection_name) ?? [];
    list.push(l);
    byColAdj.set(l.collection_name, list);
  }
  for (const [, list] of byColAdj) list.sort((a, b) => a.price_cents - b.price_cents);

  // Build knife finish cache
  const knifeFinishCache = new Map<string, FinishData[]>();
  const allItemTypes = new Set<string>();
  for (const caseInfo of Object.values(CASE_KNIFE_MAP)) {
    for (const kt of caseInfo.knifeTypes) allItemTypes.add(kt);
    if (caseInfo.gloveGen) {
      for (const gt of Object.keys(GLOVE_GEN_SKINS[caseInfo.gloveGen])) allItemTypes.add(gt);
    }
  }
  for (const itemType of allItemTypes) {
    const finishes = getKnifeFinishesWithPrices(db, itemType);
    if (finishes.length > 0) knifeFinishCache.set(itemType, finishes);
  }

  const seen = new Set<string>();
  const results: TradeUp[] = [];
  const comparison: MaterializeResult["comparison"] = [];
  const nearMisses: MaterializeResult["nearMisses"] = [];
  let attempted = 0;

  for (const theory of theories) {
    attempted++;

    // Build quotas from theory spec
    const quotas = new Map<string, number>();
    for (let i = 0; i < theory.collections.length; i++) {
      quotas.set(theory.collections[i], theory.split[i]);
    }

    // Check we have listings for all collections
    let hasAll = true;
    for (const [col, count] of quotas) {
      const pool = byColAdj.get(col);
      if (!pool || pool.length < count) { hasAll = false; break; }
    }
    if (!hasAll) continue;

    // Try theory's exact float target + nearby variants + condition boundaries
    const baseFloat = theory.adjustedFloat;
    const targets = new Set([
      baseFloat,
      baseFloat - 0.005, baseFloat + 0.005,
      baseFloat - 0.01, baseFloat + 0.01,
      baseFloat - 0.02, baseFloat + 0.02,
      baseFloat - 0.04, baseFloat + 0.04,
    ]);

    // Add condition boundary targets for this combo's knife output pool
    // These are the exact float values where output jumps between conditions (e.g., FN→MW)
    const condBounds = [0.07, 0.15, 0.38, 0.45];
    for (const colName of theory.collections) {
      const caseInfo = CASE_KNIFE_MAP[colName];
      if (!caseInfo) continue;
      const weaponTypes = [...caseInfo.knifeTypes];
      if (caseInfo.gloveGen) {
        for (const gt of Object.keys(GLOVE_GEN_SKINS[caseInfo.gloveGen])) weaponTypes.push(gt);
      }
      for (const wt of weaponTypes) {
        for (const f of knifeFinishCache.get(wt) ?? []) {
          const range = f.skinMaxFloat - f.skinMinFloat;
          if (range <= 0) continue;
          for (const boundary of condBounds) {
            const avgNorm = (boundary - f.skinMinFloat) / range;
            if (avgNorm > 0.01 && avgNorm < 0.99) {
              targets.add(Math.round((avgNorm - 0.003) * 10000) / 10000); // just below = better condition
              targets.add(Math.round((avgNorm + 0.003) * 10000) / 10000);
            }
          }
        }
      }
    }
    const filteredTargets = [...targets].filter(t => t > 0 && t < 1);

    let bestResult: TradeUp | null = null;

    for (const target of filteredTargets) {
      // Price-greedy selection (cheapest listings within float budget)
      const selected = selectForFloatTarget(byColAdj, quotas, target, 5);
      if (selected) {
        const key = selected.map(s => s.id).sort().join(",");
        if (!seen.has(key)) {
          const result = evaluateKnifeTradeUp(db, selected, knifeFinishCache);
          if (result && result.expected_value_cents > 0) {
            if (!bestResult || result.profit_cents > bestResult.profit_cents) {
              bestResult = result;
            }
          }
        }
      }

      // Float-greedy selection (lowest float within budget, may cost more)
      const floatGreedy = selectForFloatTargetFloatGreedy(byColAdj, quotas, target, 5);
      if (floatGreedy) {
        const key = floatGreedy.map(s => s.id).sort().join(",");
        if (!seen.has(key)) {
          const result = evaluateKnifeTradeUp(db, floatGreedy, knifeFinishCache);
          if (result && result.expected_value_cents > 0) {
            if (!bestResult || result.profit_cents > bestResult.profit_cents) {
              bestResult = result;
            }
          }
        }
      }
    }

    // Also try lowest-float selection (sometimes the cheapest path to FN outputs)
    const lowestFloat = selectLowestFloat(byColAdj, quotas, 5);
    if (lowestFloat) {
      const key = lowestFloat.map(s => s.id).sort().join(",");
      if (!seen.has(key)) {
        const result = evaluateKnifeTradeUp(db, lowestFloat, knifeFinishCache);
        if (result && result.expected_value_cents > 0) {
          if (!bestResult || result.profit_cents > bestResult.profit_cents) {
            bestResult = result;
          }
        }
      }
    }

    if (bestResult) {
      const key = bestResult.inputs.map(i => i.listing_id).sort().join(",");
      if (!seen.has(key)) {
        seen.add(key);
        results.push(bestResult);

        comparison.push({
          combo: theory.collections.join(","),
          theoryProfit: theory.profitCents,
          realProfit: bestResult.profit_cents,
          theoryCost: theory.totalCostCents,
          realCost: bestResult.total_cost_cents,
        });

        // Track near-misses: theory says profitable but real is close (within -$100)
        if (theory.profitCents > 0 && bestResult.profit_cents <= 0 && bestResult.profit_cents > -10000) {
          nearMisses.push({
            combo: theory.collections.join(","),
            theoryProfit: theory.profitCents,
            realProfit: bestResult.profit_cents,
            gap: -bestResult.profit_cents, // how much cheaper inputs need to be
          });
        }
      }
    }
  }

  results.sort((a, b) => b.profit_cents - a.profit_cents);
  nearMisses.sort((a, b) => a.gap - b.gap); // closest to profitable first
  const profitable = results.filter(r => r.profit_cents > 0).length;

  return { attempted, found: results.length, profitable, tradeUps: results, comparison, nearMisses };
}

/**
 * Dense float scan for theory-profitable collection combos that discovery missed.
 * Discovery does 9 float points for all 861 pairs. This does 50 points for the
 * ~50 most promising combos identified by theory.
 */
function theoryTargetedDeepScan(
  db: ReturnType<typeof initDb>,
  theories: PessimisticTheory[],
  existingTradeUps: TradeUp[],
  matResult: MaterializeResult
): DeepScanResult {
  // Find theory-profitable combos that aren't already profitable in discovery
  const existingSigs = new Set(existingTradeUps.filter(t => t.profit_cents > 0).map(t => {
    const cols = [...new Set(t.inputs.map(i => i.collection_name))].sort().join(",");
    return cols;
  }));

  // Get unique profitable theory combos not already profitable in discovery
  const combosToScan = new Map<string, { collections: string[]; split: number[]; theoryProfit: number }>();
  for (const theory of theories) {
    if (theory.profitCents <= 0) continue;
    const comboKey = theory.collections.sort().join(",");
    if (existingSigs.has(comboKey)) continue; // Already profitable in discovery
    const existing = combosToScan.get(comboKey);
    if (!existing || theory.profitCents > existing.theoryProfit) {
      combosToScan.set(comboKey, {
        collections: theory.collections,
        split: theory.split,
        theoryProfit: theory.profitCents,
      });
    }
  }

  if (combosToScan.size === 0) return { scanned: 0, found: 0, profitable: 0, tradeUps: [] };

  // Load listings (reuse the same data as materialization)
  const allListings = getListingsForRarity(db, "Covert")
    .filter(l => !(KNIFE_WEAPONS as readonly string[]).includes(l.weapon));
  if (allListings.length === 0) return { scanned: 0, found: 0, profitable: 0, tradeUps: [] };

  const allAdjusted = addAdjustedFloat(allListings);
  const byColAdj = new Map<string, AdjustedListing[]>();
  for (const l of allAdjusted) {
    const list = byColAdj.get(l.collection_name) ?? [];
    list.push(l);
    byColAdj.set(l.collection_name, list);
  }
  for (const [, list] of byColAdj) list.sort((a, b) => a.price_cents - b.price_cents);

  // Build knife finish cache
  const knifeFinishCache = new Map<string, FinishData[]>();
  const allItemTypes = new Set<string>();
  for (const caseInfo of Object.values(CASE_KNIFE_MAP)) {
    for (const kt of caseInfo.knifeTypes) allItemTypes.add(kt);
    if (caseInfo.gloveGen) {
      for (const gt of Object.keys(GLOVE_GEN_SKINS[caseInfo.gloveGen])) allItemTypes.add(gt);
    }
  }
  for (const itemType of allItemTypes) {
    const finishes = getKnifeFinishesWithPrices(db, itemType);
    if (finishes.length > 0) knifeFinishCache.set(itemType, finishes);
  }

  // Boundary-aware float targets: condition transition points + basic coverage
  const denseTargetSet = new Set<number>();
  // Basic coverage: 10 points spanning 0.01-0.50
  for (let t = 0.01; t <= 0.50; t = Math.round((t + 0.05) * 100) / 100) {
    denseTargetSet.add(t);
  }
  // Add condition boundary targets for each combo's knife output pool
  const condBounds = [0.07, 0.15, 0.38, 0.45];
  for (const [, combo] of combosToScan) {
    for (const colName of combo.collections) {
      const caseInfo = CASE_KNIFE_MAP[colName];
      if (!caseInfo) continue;
      const weaponTypes = [...caseInfo.knifeTypes];
      if (caseInfo.gloveGen) {
        for (const gt of Object.keys(GLOVE_GEN_SKINS[caseInfo.gloveGen])) weaponTypes.push(gt);
      }
      for (const wt of weaponTypes) {
        for (const f of knifeFinishCache.get(wt) ?? []) {
          const range = f.skinMaxFloat - f.skinMinFloat;
          if (range <= 0) continue;
          for (const boundary of condBounds) {
            const avgNorm = (boundary - f.skinMinFloat) / range;
            if (avgNorm > 0.01 && avgNorm < 0.99) {
              // Dense scan around each boundary: ±0.01, step 0.002
              for (let off = -0.01; off <= 0.01; off += 0.002) {
                const point = Math.round((avgNorm + off) * 10000) / 10000;
                if (point > 0 && point < 1) denseTargetSet.add(point);
              }
            }
          }
        }
      }
    }
  }
  const denseTargets = [...denseTargetSet].sort((a, b) => a - b);

  const existingListingSigs = new Set(existingTradeUps.map(t => t.inputs.map(i => i.listing_id).sort().join(",")));
  const results: TradeUp[] = [];
  let scanned = 0;

  // Sort by theory profit descending, cap at top 80 combos
  const sortedCombos = [...combosToScan.entries()]
    .sort((a, b) => b[1].theoryProfit - a[1].theoryProfit)
    .slice(0, 80);

  for (const [, combo] of sortedCombos) {
    scanned++;
    const quotas = new Map<string, number>();
    for (let i = 0; i < combo.collections.length; i++) {
      quotas.set(combo.collections[i], combo.split[i]);
    }

    // Check we have listings
    let hasAll = true;
    for (const [col, count] of quotas) {
      const pool = byColAdj.get(col);
      if (!pool || pool.length < count) { hasAll = false; break; }
    }
    if (!hasAll) continue;

    let bestResult: TradeUp | null = null;

    // Also try all valid splits for this set of collections
    const splits = combo.collections.length === 1
      ? [[5]]
      : combo.collections.length === 2
        ? [[1, 4], [2, 3], [3, 2], [4, 1]]
        : [combo.split]; // For 3+ collections, use theory's split

    for (const split of splits) {
      const splitQuotas = new Map<string, number>();
      for (let i = 0; i < combo.collections.length; i++) {
        splitQuotas.set(combo.collections[i], split[i]);
      }

      for (const target of denseTargets) {
        // Price-greedy
        const selected = selectForFloatTarget(byColAdj, splitQuotas, target, 5);
        if (selected) {
          const key = selected.map(s => s.id).sort().join(",");
          if (!existingListingSigs.has(key)) {
            const result = evaluateKnifeTradeUp(db, selected, knifeFinishCache);
            if (result && result.expected_value_cents > 0) {
              if (!bestResult || result.profit_cents > bestResult.profit_cents) {
                bestResult = result;
              }
            }
          }
        }

        // Float-greedy
        const floatGreedy = selectForFloatTargetFloatGreedy(byColAdj, splitQuotas, target, 5);
        if (floatGreedy) {
          const key = floatGreedy.map(s => s.id).sort().join(",");
          if (!existingListingSigs.has(key)) {
            const result = evaluateKnifeTradeUp(db, floatGreedy, knifeFinishCache);
            if (result && result.expected_value_cents > 0) {
              if (!bestResult || result.profit_cents > bestResult.profit_cents) {
                bestResult = result;
              }
            }
          }
        }
      }

      // Also try lowest-float
      const lowestFloat = selectLowestFloat(byColAdj, splitQuotas, 5);
      if (lowestFloat) {
        const key = lowestFloat.map(s => s.id).sort().join(",");
        if (!existingListingSigs.has(key)) {
          const result = evaluateKnifeTradeUp(db, lowestFloat, knifeFinishCache);
          if (result && result.expected_value_cents > 0) {
            if (!bestResult || result.profit_cents > bestResult.profit_cents) {
              bestResult = result;
            }
          }
        }
      }
    }

    if (bestResult) {
      const key = bestResult.inputs.map(i => i.listing_id).sort().join(",");
      if (!existingListingSigs.has(key)) {
        existingListingSigs.add(key);
        results.push(bestResult);
      }
    }
  }

  results.sort((a, b) => b.profit_cents - a.profit_cents);
  const profitable = results.filter(r => r.profit_cents > 0).length;

  return { scanned, found: results.length, profitable, tradeUps: results };
}
