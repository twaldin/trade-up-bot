/**
 * Phase 5b: Classified→Covert Calc — discovery + materialization.
 * Phase 5e/5f: Generic rarity tier calc (Restricted→Classified, Mil-Spec→Restricted).
 * Phase 5c: Staircase evaluation.
 */

import { initDb, emitEvent } from "../../db.js";
import {
  findProfitableTradeUps,
  randomClassifiedExplore,
  saveTradeUps,
  saveClassifiedTradeUps,
  updateCollectionScores,
  getListingsForRarity,
  addAdjustedFloat,
  selectForFloatTarget,
  selectLowestFloat,
  evaluateTradeUp,
  getOutcomesForCollections,
  genericComboKey,
  saveTheoryValidations,
  saveNearMissesToDb,
  reviveStaleClassifiedTradeUps,
  getTierById,
  findStaircaseTradeUps,
  type NearMissInfo,
  type TheoryValidationResult,
} from "../../engine.js";
import type { AdjustedListing, ClassifiedTheory } from "../../engine.js";
import { type Condition, floatToCondition } from "../../../shared/types.js";
import type { TradeUp } from "../../../shared/types.js";

import { FreshnessTracker } from "../state.js";
import { timestamp, setDaemonStatus } from "../utils.js";
import type { ClassifiedCalcResult } from "./theory.js";

interface MaterializeResult {
  attempted: number;
  found: number;
  profitable: number;
  tradeUps: TradeUp[];
  comparison: { combo: string; theoryProfit: number; realProfit: number; theoryCost: number; realCost: number }[];
  nearMisses: { combo: string; theoryProfit: number; realProfit: number; gap: number }[];
}

export function phase5ClassifiedCalc(
  db: ReturnType<typeof initDb>,
  freshness: FreshnessTracker,
  force: boolean = false,
  classifiedTheories: ClassifiedTheory[] = [],
  discoveryResults?: TradeUp[],
): ClassifiedCalcResult {
  console.log(`\n[${timestamp()}] Phase 5b: Classified→Covert Calc${discoveryResults ? ' (worker)' : ''}`);
  setDaemonStatus(db, "calculating", "Phase 5b: Classified→Covert discovery");
  emitEvent(db, "phase", "Phase 5b: Classified Calc");

  try {
    const tradeUps = discoveryResults ?? findProfitableTradeUps(db, {
      onProgress: (msg) => {
        process.stdout.write(`\r  ${msg}                    `);
        setDaemonStatus(db, "calculating", msg);
      },
    });
    if (!discoveryResults) console.log("");

    const profitable = tradeUps.filter(t => t.profit_cents > 0);
    console.log(`  Found ${tradeUps.length} classified→covert trade-ups (${profitable.length} profitable)`);

    let cycleNearMisses: NearMissInfo[] = [];

    // Classified materialization: try to build real trade-ups from classified theories
    if (classifiedTheories.length > 0) {
      setDaemonStatus(db, "calculating", "Phase 5b: Materializing classified theories");
      const matResult = materializeClassifiedTheories(db, classifiedTheories);

      if (matResult.found > 0) {
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
        console.log(`  Materialized: ${matResult.attempted} theories tried, ${matResult.found} built, ${matResult.profitable} profitable (${added} new)`);

        if (matResult.nearMisses.length > 0) {
          console.log(`    Near-misses: ${matResult.nearMisses.length} combos within $100 of profit`);
          cycleNearMisses = matResult.nearMisses.map(nm => ({
            combo: nm.combo,
            gap: nm.gap,
            theoryProfit: nm.theoryProfit,
          }));
        }
      }

      // Record classified theory validations
      {
        const validationResults: TheoryValidationResult[] = [];
        const materializedCombos = new Set(matResult.comparison.map(c => c.combo));

        for (const theory of classifiedTheories) {
          const ck = genericComboKey("classified:", theory.collections, theory.split);
          const comboStr = theory.collections.join(",");
          const comp = matResult.comparison.find(c => c.combo === comboStr);

          if (comp) {
            const profitError = Math.abs(comp.theoryProfit - comp.realProfit);
            let status: 'profitable' | 'near_miss' | 'invalidated';
            if (comp.realProfit > 0 && profitError < Math.max(500, Math.abs(comp.realProfit) * 0.5)) {
              status = 'profitable';
            } else if (comp.realProfit > -10000) {
              status = 'near_miss';
            } else {
              status = 'invalidated';
            }

            validationResults.push({
              combo_key: ck,
              status,
              theory_profit_cents: comp.theoryProfit,
              real_profit_cents: comp.realProfit,
              cost_gap_cents: comp.theoryCost - comp.realCost,
              ev_gap_cents: (comp.theoryProfit + comp.theoryCost) - (comp.realProfit + comp.realCost),
              notes: `classified_theory`,
            });
          } else if (!materializedCombos.has(comboStr) && theory.profitCents > 0) {
            validationResults.push({
              combo_key: ck,
              status: 'no_listings',
              theory_profit_cents: theory.profitCents,
              real_profit_cents: null,
              cost_gap_cents: 0,
              ev_gap_cents: 0,
              notes: `classified_needs_listings`,
            });
          }
        }

        if (validationResults.length > 0) {
          saveTheoryValidations(db, validationResults);
          const statusCounts = validationResults.reduce((acc, r) => {
            acc[r.status] = (acc[r.status] ?? 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          console.log(`  Classified validation: ${Object.entries(statusCounts).map(([k, v]) => `${v} ${k}`).join(", ")}`);
        }

        if (cycleNearMisses.length > 0) {
          saveNearMissesToDb(db, cycleNearMisses, "classified");
        }
      }
    }

    // Random classified explore
    setDaemonStatus(db, "calculating", "Phase 5b: Random classified exploration");
    const exploreResult = randomClassifiedExplore(db, {
      iterations: 200,
      onProgress: (msg) => setDaemonStatus(db, "calculating", msg),
    });
    if (exploreResult.found > 0) {
      console.log(`  Classified explore: ${exploreResult.explored} iterations, +${exploreResult.found} new, ${exploreResult.improved} improved`);
    }

    // Re-sort and save
    tradeUps.sort((a, b) => b.profit_cents - a.profit_cents);
    if (tradeUps.length > 0) {
      saveClassifiedTradeUps(db, tradeUps);
      console.log(`  Saved ${tradeUps.length} classified→covert trade-ups`);

      const allProfitable = tradeUps.filter(t => t.profit_cents > 0);
      if (allProfitable.length > 0) {
        console.log("  Top classified trade-ups:");
        for (const tu of allProfitable.slice(0, 3)) {
          const inputNames = [...new Set(tu.inputs.map(i => i.skin_name))].join(", ");
          console.log(`    $${(tu.profit_cents / 100).toFixed(2)} profit (${tu.roi_percentage.toFixed(0)}% ROI) | ${inputNames}`);
        }
        emitEvent(db, "classified_calc", `${allProfitable.length} profitable, best +$${(allProfitable[0].profit_cents / 100).toFixed(2)}`);
      }
    }

    // Revive stale/partial classified trade-ups with replacement listings
    const classifiedRevival = reviveStaleClassifiedTradeUps(db, 200);
    if (classifiedRevival.revived > 0) {
      console.log(`  Classified revival: checked ${classifiedRevival.checked}, revived ${classifiedRevival.revived} (${classifiedRevival.improved} improved)`);
    }

    updateCollectionScores(db);

    const allProfitable = tradeUps.filter(t => t.profit_cents > 0);
    const topProfit = allProfitable.length > 0 ? allProfitable[0].profit_cents : 0;
    const avgProfit = allProfitable.length > 0
      ? Math.round(allProfitable.reduce((s, t) => s + t.profit_cents, 0) / allProfitable.length)
      : 0;

    return { total: tradeUps.length, profitable: allProfitable.length, topProfit, avgProfit, nearMisses: cycleNearMisses };
  } catch (err) {
    console.error(`  Classified calc error: ${(err as Error).message}`);
    return { total: 0, profitable: 0, topProfit: 0, avgProfit: 0, nearMisses: [] };
  }
}

/**
 * Generic Phase 5 calc for any rarity tier (restricted→classified, milspec→restricted).
 * Simpler than phase5ClassifiedCalc — no theory materialization yet, just discovery + save.
 */
export function phase5GenericCalc(
  db: ReturnType<typeof initDb>,
  tierType: string,
  discoveryResults?: TradeUp[],
) {
  const tierConfig = getTierById(tierType);
  if (!tierConfig) {
    console.error(`  Unknown tier: ${tierType}`);
    return;
  }
  const label = `${tierConfig.inputRarity}→${tierConfig.outputRarity}`;
  console.log(`\n[${timestamp()}] Phase 5: ${label} Calc${discoveryResults ? ' (worker)' : ''}`);
  setDaemonStatus(db, "calculating", `Phase 5: ${label} discovery`);

  try {
    const tradeUps = discoveryResults ?? findProfitableTradeUps(db, {
      rarities: [tierConfig.inputRarity],
    });

    const profitable = tradeUps.filter(t => t.profit_cents > 0);
    console.log(`  Found ${tradeUps.length} ${label} trade-ups (${profitable.length} profitable)`);

    if (tradeUps.length > 0) {
      // Use clear-first save for lower-rarity tiers — they produce 100K+ trade-ups per cycle.
      // Merge-save (saveClassifiedTradeUps) would accumulate to millions and OOM.
      saveTradeUps(db, tradeUps, true, tierConfig.tradeUpType, false, "discovery");
      console.log(`  Saved ${tradeUps.length} ${label} trade-ups`);

      if (profitable.length > 0) {
        console.log(`  Top ${label} trade-ups:`);
        for (const tu of profitable.slice(0, 3)) {
          const inputNames = [...new Set(tu.inputs.map(i => i.skin_name))].join(", ");
          console.log(`    $${(tu.profit_cents / 100).toFixed(2)} profit (${tu.roi_percentage.toFixed(0)}% ROI) | ${inputNames}`);
        }
        emitEvent(db, `${tierType}_calc`, `${profitable.length} profitable, best +$${(profitable[0].profit_cents / 100).toFixed(2)}`);
      }
    }
  } catch (err) {
    console.error(`  ${label} calc error: ${(err as Error).message}`);
  }
}

export function phase5cStaircase(db: ReturnType<typeof initDb>) {
  console.log(`\n[${timestamp()}] Phase 5c: Staircase`);
  setDaemonStatus(db, "calculating", "Phase 5c: Staircase evaluation");

  try {
    const result = findStaircaseTradeUps(db);
    if (result.total > 0) {
      console.log(`  Staircase: ${result.total} evaluated, ${result.profitable} profitable`);
      for (const tu of result.tradeUps.slice(0, 3)) {
        console.log(`    $${(tu.tradeUp.profit_cents / 100).toFixed(2)} profit (${tu.tradeUp.roi_percentage.toFixed(0)}% ROI), ${tu.stage1Ids.length} stage-1 trade-ups`);
      }

      // Save staircase trade-ups with real classified inputs (not synthetic Coverts)
      // Load the actual 50 classified listing inputs from stage1 trade-up IDs
      const loadStage1Inputs = db.prepare(`
        SELECT listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition, source
        FROM trade_up_inputs WHERE trade_up_id = ?
      `);
      for (const st of result.tradeUps) {
        // Replace synthetic Covert inputs with real classified inputs from stage1
        const realInputs: typeof st.tradeUp.inputs = [];
        for (const s1Id of st.stage1Ids) {
          const rows = loadStage1Inputs.all(s1Id) as { listing_id: string; skin_id: string; skin_name: string; collection_name: string; price_cents: number; float_value: number; condition: Condition; source: string | null }[];
          for (const r of rows) {
            realInputs.push({
              listing_id: r.listing_id,
              skin_id: r.skin_id,
              skin_name: r.skin_name,
              collection_name: r.collection_name,
              price_cents: r.price_cents,
              float_value: r.float_value,
              condition: r.condition,
              source: r.source ?? "csfloat",
            });
          }
        }
        st.tradeUp.inputs = realInputs;
      }
      const tradeUps = result.tradeUps.map(s => s.tradeUp);
      saveTradeUps(db, tradeUps, true, "staircase", false, "staircase");
      console.log(`  Saved ${tradeUps.length} staircase trade-ups (${tradeUps[0]?.inputs.length ?? 0} inputs each)`);
    } else {
      console.log(`  Staircase: no viable combinations found`);
    }
  } catch (err) {
    console.error(`  Staircase error: ${(err as Error).message}`);
  }
}

function materializeClassifiedTheories(
  db: ReturnType<typeof initDb>,
  theories: ClassifiedTheory[]
): MaterializeResult {
  const allListings = getListingsForRarity(db, "Classified");
  if (allListings.length === 0) {
    return { attempted: 0, found: 0, profitable: 0, tradeUps: [], comparison: [], nearMisses: [] };
  }

  const allAdjusted = addAdjustedFloat(allListings);
  const byColAdj = new Map<string, AdjustedListing[]>();
  for (const l of allAdjusted) {
    const list = byColAdj.get(l.collection_name) ?? [];
    list.push(l);
    byColAdj.set(l.collection_name, list);
  }
  for (const [, list] of byColAdj) list.sort((a, b) => a.price_cents - b.price_cents);

  // Cache outcomes by collection set
  const outcomeCache = new Map<string, ReturnType<typeof getOutcomesForCollections>>();
  function getOutcomes(collectionIds: string[]) {
    const key = collectionIds.sort().join(",");
    if (!outcomeCache.has(key)) {
      outcomeCache.set(key, getOutcomesForCollections(db, collectionIds, "Covert"));
    }
    return outcomeCache.get(key)!;
  }

  const seen = new Set<string>();
  const results: TradeUp[] = [];
  const comparison: MaterializeResult["comparison"] = [];
  const nearMisses: MaterializeResult["nearMisses"] = [];
  let attempted = 0;

  for (const theory of theories) {
    attempted++;

    const quotas = new Map<string, number>();
    for (let i = 0; i < theory.collections.length; i++) {
      quotas.set(theory.collections[i], theory.split[i]);
    }

    // Check we have listings
    let hasAll = true;
    for (const [col, count] of quotas) {
      const pool = byColAdj.get(col);
      if (!pool || pool.length < count) { hasAll = false; break; }
    }
    if (!hasAll) continue;

    // Try theory's float target + variants
    const baseFloat = theory.adjustedFloat;
    const targets = [
      baseFloat,
      baseFloat - 0.005, baseFloat + 0.005,
      baseFloat - 0.01, baseFloat + 0.01,
      baseFloat - 0.02, baseFloat + 0.02,
    ].filter(t => t > 0 && t < 1);

    let bestResult: TradeUp | null = null;

    // Resolve collection IDs from names for outcome lookup
    const collectionIdMap = new Map<string, string>();
    for (const l of allAdjusted) {
      if (!collectionIdMap.has(l.collection_name)) {
        collectionIdMap.set(l.collection_name, l.collection_id);
      }
    }
    const collectionIds = theory.collections.map(c => collectionIdMap.get(c)).filter(Boolean) as string[];
    if (collectionIds.length === 0) continue;
    const outcomes = getOutcomes(collectionIds);
    if (outcomes.length === 0) continue;

    for (const target of targets) {
      const selected = selectForFloatTarget(byColAdj, quotas, target, 10);
      if (selected) {
        const key = selected.map(s => s.id).sort().join(",");
        if (!seen.has(key)) {
          const result = evaluateTradeUp(db, selected, outcomes);
          if (result && result.expected_value_cents > 0) {
            if (!bestResult || result.profit_cents > bestResult.profit_cents) {
              bestResult = result;
            }
          }
        }
      }
    }

    // Also try lowest-float selection
    const lowestFloat = selectLowestFloat(byColAdj, quotas, 10);
    if (lowestFloat) {
      const key = lowestFloat.map(s => s.id).sort().join(",");
      if (!seen.has(key)) {
        const result = evaluateTradeUp(db, lowestFloat, outcomes);
        if (result && result.expected_value_cents > 0) {
          if (!bestResult || result.profit_cents > bestResult.profit_cents) {
            bestResult = result;
          }
        }
      }
    }

    // Also try cheapest-by-price per condition (matches theory's pricing model)
    // Theory picks N cheapest listings per collection+condition, so replicate that here
    const conditionsToTry = ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle-Scarred"];
    for (const cond of conditionsToTry) {
      const cheapest: AdjustedListing[] = [];
      let ok = true;
      for (const [col, count] of quotas) {
        const pool = byColAdj.get(col);
        if (!pool) { ok = false; break; }
        const condPool = pool.filter(l => floatToCondition(l.float_value) === cond);
        if (condPool.length < count) { ok = false; break; }
        cheapest.push(...condPool.slice(0, count)); // already sorted by price
      }
      if (!ok || cheapest.length !== 10) continue;
      const key = cheapest.map(s => s.id).sort().join(",");
      if (seen.has(key)) continue;
      const result = evaluateTradeUp(db, cheapest, outcomes);
      if (result && result.expected_value_cents > 0) {
        if (!bestResult || result.profit_cents > bestResult.profit_cents) {
          bestResult = result;
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

        if (theory.profitCents > 0 && bestResult.profit_cents <= 0 && bestResult.profit_cents > -10000) {
          nearMisses.push({
            combo: theory.collections.join(","),
            theoryProfit: theory.profitCents,
            realProfit: bestResult.profit_cents,
            gap: -bestResult.profit_cents,
          });
        }
      }
    }
  }

  results.sort((a, b) => b.profit_cents - a.profit_cents);
  nearMisses.sort((a, b) => a.gap - b.gap);
  const profitable = results.filter(r => r.profit_cents > 0).length;

  return { attempted, found: results.length, profitable, tradeUps: results, comparison, nearMisses };
}
