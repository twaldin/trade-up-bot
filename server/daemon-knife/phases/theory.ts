/**
 * Phase 2: Theory — price cache, bootstrap, and theory generation (pure computation, no API).
 * Phase 2b: Classified→Covert theory generation.
 * Phase 2c: Staircase theory generation.
 * Also: printTheoryAccuracy (theory vs reality comparison).
 */

import { initDb, setSyncMeta } from "../../db.js";
import {
  buildPriceCache,
  bootstrapLearnedPrices,
  seedPriceObservations,
  seedKnifeSaleObservations,
  getOutcomesForCollections,
  generatePessimisticKnifeTheories,
  buildWantedList,
  saveTheoryTradeUps,
  loadTheoryCooldowns,
  getProfitableCombosForWantedList,
  generateTheoriesForTier,
  buildWantedListForTier,
  saveTheoryTradeUpsForTier,
  getTierById,
  generateStaircaseTheories,
  saveStaircaseTheoryTradeUps,
  type WantedListing,
  type NearMissInfo,
  type PessimisticTheory,
} from "../../engine.js";
import type { ClassifiedTheory } from "../../engine.js";

import { timestamp, setDaemonStatus } from "../utils.js";

export interface TheoryResult {
  generated: number;
  profitable: number;
  wantedList: WantedListing[];
  bestFloatTargets: number[];  // Normalized floats from top theories for discovery
  theories: PessimisticTheory[];  // Full theories for materialization in Phase 5
}

export interface ClassifiedTheoryResult {
  generated: number;
  profitable: number;
  wantedList: WantedListing[];
  bestFloatTargets: number[];
  theories: ClassifiedTheory[];
}

export interface ClassifiedCalcResult {
  total: number;
  profitable: number;
  topProfit: number;
  avgProfit: number;
  nearMisses: NearMissInfo[];
}

export interface StaircaseTheoryPhaseResult {
  generated: number;
  profitable: number;
  boostMap: Map<string, number>; // genericComboKey → boost score
}

export function phase2Theory(db: ReturnType<typeof initDb>, cycleCount: number, previousNearMisses?: NearMissInfo[]): TheoryResult {
  console.log(`\n[${timestamp()}] Phase 2: Theory (computation only)`);
  setDaemonStatus(db, "calculating", "Phase 2: Price cache + theory");

  // 2a: Build price cache
  buildPriceCache(db, true);

  // 2b: Bootstrap float pricing data (seeds from existing listings, no API)
  const seeded = seedPriceObservations(db);
  if (seeded > 0) console.log(`  Seeded ${seeded} price observations`);

  const knifeSeeded = seedKnifeSaleObservations(db);
  if (knifeSeeded > 0) console.log(`  Seeded ${knifeSeeded} knife/glove observations`);

  const bootstrapped = bootstrapLearnedPrices(db);
  if (bootstrapped > 0) console.log(`  Bootstrapped ${bootstrapped} learned prices`);

  // 2c: Load cooldowns from previous validation results
  const cooldownMap = loadTheoryCooldowns(db);
  if (cooldownMap.size > 0) {
    console.log(`  Loaded ${cooldownMap.size} theory cooldowns (recently invalidated combos will be skipped)`);
  }

  // 2d: Generate theories using float-aware pricing, respecting cooldowns
  setDaemonStatus(db, "calculating", "Phase 2: Generating theories");
  const theories = generatePessimisticKnifeTheories(db, {
    onProgress: (msg) => setDaemonStatus(db, "calculating", msg),
    maxTheories: 5000,
    minRoiThreshold: -100,
    cooldownMap,
  });

  // 2d: Build wanted list from ALL theories (including near-misses)
  // Near-miss combos need data too — they might become profitable with better pricing
  const wantedList = buildWantedList(theories, previousNearMisses);
  if (previousNearMisses && previousNearMisses.length > 0) {
    console.log(`  Near-miss boost: ${previousNearMisses.length} combos from last cycle boosting wanted list`);
    for (const nm of previousNearMisses.slice(0, 3)) {
      const colShort = nm.combo.replace(/The /g, "").replace(/ Collection/g, "");
      console.log(`    ${colShort}: need $${(nm.gap / 100).toFixed(2)} cheaper → boost ${Math.round(1000 / Math.max(nm.gap / 100, 1))}`);
    }
  }

  // 2d.2: Boost wanted list with historically profitable combos
  // Combos that were profitable in the past week get massive priority — we want fresh data to check if they're still viable
  const profitableHistory = getProfitableCombosForWantedList(db);
  if (profitableHistory.length > 0) {
    let boosted = 0;
    for (const pc of profitableHistory) {
      // Parse input recipe to extract skin names + conditions
      const parts = pc.input_recipe.split(";").filter(Boolean);
      for (const part of parts) {
        const [skinName, , ] = part.split("|");
        if (!skinName) continue;
        // Find and boost matching wanted list entries
        const match = wantedList.find(w => w.skin_name === skinName);
        if (match) {
          const boost = Math.min(200, Math.round(pc.best_profit / 10)); // $11 profit → 110 boost
          match.priority_score += boost;
          boosted++;
        }
      }
    }
    if (boosted > 0) {
      console.log(`  Profitable history boost: ${profitableHistory.length} combos, ${boosted} wanted entries boosted`);
      // Re-sort wanted list by updated priority
      wantedList.sort((a, b) => b.priority_score - a.priority_score);
    }
  }

  // 2e: Save all theories to DB (profitable + near-miss for UI display)
  if (theories.length > 0) {
    saveTheoryTradeUps(db, theories);
    console.log(`  Saved ${theories.length} theories to DB (${theories.filter(t => t.profitCents > 0).length} profitable)`);
  } else {
    saveTheoryTradeUps(db, []);
  }

  if (wantedList.length > 0) {
    console.log(`  Wanted list: ${wantedList.length} input skins to fetch`);
    for (const w of wantedList.slice(0, 5)) {
      console.log(`    ${w.skin_name} @ <${w.max_float.toFixed(2)} (score ${w.priority_score.toFixed(0)})`);
    }
  }

  // Extract unique float targets from profitable theories for discovery
  const profitableTheories = theories.filter(t => t.profitCents > 0);
  const bestFloatTargets = [...new Set(profitableTheories.map(t => t.adjustedFloat))].sort((a, b) => a - b);
  if (bestFloatTargets.length > 0) {
    console.log(`  Theory float targets for discovery: ${bestFloatTargets.length} unique (${bestFloatTargets.slice(0, 5).map(f => f.toFixed(3)).join(", ")}${bestFloatTargets.length > 5 ? "..." : ""})`);
  }

  return { generated: theories.length, profitable: profitableTheories.length, wantedList, bestFloatTargets, theories };
}

export function phase2ClassifiedTheory(
  db: ReturnType<typeof initDb>,
  cycleCount: number,
  previousNearMisses?: NearMissInfo[]
): ClassifiedTheoryResult {
  console.log(`\n[${timestamp()}] Phase 2b: Classified→Covert Theory`);
  setDaemonStatus(db, "calculating", "Phase 2b: Classified theory");

  // Price cache already built in Phase 2a — reuse (5-min TTL)

  // Load cooldowns (classified theories use "classified:" prefix in combo_key)
  const cooldownMap = loadTheoryCooldowns(db, "classified");

  setDaemonStatus(db, "calculating", "Phase 2b: Generating classified theories");
  const theories = generateTheoriesForTier(db, getTierById("classified_covert")!, {
    onProgress: (msg) => setDaemonStatus(db, "calculating", msg),
    maxTheories: 3000,
    minRoiThreshold: -100,
    cooldownMap,
  });

  const profitableTheories = theories.filter(t => t.profitCents > 0);
  console.log(`  Generated ${theories.length} classified theories (${profitableTheories.length} profitable)`);

  // Save classified theories to DB for frontend display
  saveTheoryTradeUpsForTier(db, theories, "classified_covert");
  console.log(`  Saved ${theories.length} classified theories to DB`);

  // Build wanted list from classified theories
  const wantedList = buildWantedListForTier(theories, previousNearMisses);
  if (previousNearMisses && previousNearMisses.length > 0) {
    console.log(`  Near-miss boost: ${previousNearMisses.length} classified combos from last cycle`);
  }

  if (wantedList.length > 0) {
    console.log(`  Classified wanted list: ${wantedList.length} input skins`);
    for (const w of wantedList.slice(0, 3)) {
      console.log(`    ${w.skin_name} @ <${w.max_float.toFixed(2)} (score ${w.priority_score.toFixed(0)})`);
    }
  }

  // Extract float targets for discovery
  const bestFloatTargets = [...new Set(profitableTheories.map(t => t.adjustedFloat))].sort((a, b) => a - b);

  return { generated: theories.length, profitable: profitableTheories.length, wantedList, bestFloatTargets, theories };
}

export function phase2cStaircaseTheory(
  db: ReturnType<typeof initDb>,
  classifiedTheories: ClassifiedTheory[]
): StaircaseTheoryPhaseResult {
  console.log(`\n[${timestamp()}] Phase 2c: Staircase Theory`);
  setDaemonStatus(db, "calculating", "Phase 2c: Staircase theory");

  const result = generateStaircaseTheories(db, classifiedTheories, {
    onProgress: (msg) => setDaemonStatus(db, "calculating", msg),
    maxTheories: 500,
    minStage1Roi: -10,
  });

  if (result.theories.length > 0) {
    console.log(`  Generated ${result.generated} staircase theories (${result.profitable} profitable)`);
    for (const st of result.theories.slice(0, 3)) {
      const tu = st.tradeUp;
      console.log(`    $${(tu.profit_cents / 100).toFixed(2)} profit (${tu.roi_percentage.toFixed(0)}% ROI) from ${st.stage1Theories.length} stage-1 theories`);
    }

    // Save staircase theories to DB for frontend
    saveStaircaseTheoryTradeUps(db, result.theories);
    console.log(`  Saved ${result.theories.length} staircase theories to DB`);

    if (result.boostMap.size > 0) {
      console.log(`  Boost map: ${result.boostMap.size} classified combos boosted for staircase value`);
    }
  } else {
    console.log(`  No staircase theories generated`);
    saveStaircaseTheoryTradeUps(db, []);
  }

  return { generated: result.generated, profitable: result.profitable, boostMap: result.boostMap };
}

export function printTheoryAccuracy(db: ReturnType<typeof initDb>) {
  // Compare theory vs real discovery — focus on what matters:
  // 1. Theory-only wins (profitable combos discovery didn't find)
  // 2. Discovery-only wins (profitable combos theory missed)
  // 3. For overlapping profitable combos: pricing accuracy
  const theories = db.prepare(`
    SELECT t.id, t.total_cost_cents, t.expected_value_cents, t.profit_cents,
      GROUP_CONCAT(DISTINCT tui.collection_name ORDER BY tui.collection_name) as collections
    FROM trade_ups t
    JOIN trade_up_inputs tui ON t.id = tui.trade_up_id
    WHERE t.is_theoretical = 1
    GROUP BY t.id
  `).all() as { id: number; total_cost_cents: number; expected_value_cents: number; profit_cents: number; collections: string }[];

  const reals = db.prepare(`
    SELECT t.id, t.total_cost_cents, t.expected_value_cents, t.profit_cents,
      GROUP_CONCAT(DISTINCT tui.collection_name ORDER BY tui.collection_name) as collections
    FROM trade_ups t
    JOIN trade_up_inputs tui ON t.id = tui.trade_up_id
    WHERE t.is_theoretical = 0 AND t.type = 'covert_knife'
    GROUP BY t.id
  `).all() as { id: number; total_cost_cents: number; expected_value_cents: number; profit_cents: number; collections: string }[];

  if (theories.length === 0 || reals.length === 0) return;

  // Group by collection combo, take BEST profit per combo
  const theoryBest = new Map<string, { cost: number; ev: number; profit: number }>();
  for (const t of theories) {
    const existing = theoryBest.get(t.collections);
    if (!existing || t.profit_cents > existing.profit) {
      theoryBest.set(t.collections, { cost: t.total_cost_cents, ev: t.expected_value_cents, profit: t.profit_cents });
    }
  }
  const realBest = new Map<string, { cost: number; ev: number; profit: number }>();
  for (const r of reals) {
    const existing = realBest.get(r.collections);
    if (!existing || r.profit_cents > existing.profit) {
      realBest.set(r.collections, { cost: r.total_cost_cents, ev: r.expected_value_cents, profit: r.profit_cents });
    }
  }

  // Find theory-only profitable combos (theory found it, discovery didn't)
  const theoryOnlyWins: { combo: string; profit: number; cost: number }[] = [];
  const discoveryOnlyWins: { combo: string; profit: number; cost: number }[] = [];
  const bothProfitable: { combo: string; theoryProfit: number; realProfit: number; theoryCost: number; realCost: number }[] = [];
  let matched = 0;
  let theoryHigherCost = 0;

  for (const [combo, t] of theoryBest) {
    const real = realBest.get(combo);
    if (!real) {
      if (t.profit > 0) theoryOnlyWins.push({ combo, profit: t.profit, cost: t.cost });
      continue;
    }
    matched++;
    if (t.cost > real.cost) theoryHigherCost++;
    if (t.profit > 0 && real.profit <= 0) {
      theoryOnlyWins.push({ combo, profit: t.profit, cost: t.cost });
    } else if (t.profit <= 0 && real.profit > 0) {
      discoveryOnlyWins.push({ combo, profit: real.profit, cost: real.cost });
    } else if (t.profit > 0 && real.profit > 0) {
      bothProfitable.push({ combo, theoryProfit: t.profit, realProfit: real.profit, theoryCost: t.cost, realCost: real.cost });
    }
  }
  // Also check discovery combos theory doesn't cover
  for (const [combo, r] of realBest) {
    if (!theoryBest.has(combo) && r.profit > 0) {
      discoveryOnlyWins.push({ combo, profit: r.profit, cost: r.cost });
    }
  }

  console.log(`\n  Theory accuracy: ${matched} collection combos overlap`);
  console.log(`    Theory costs higher: ${theoryHigherCost}/${matched} (${matched > 0 ? Math.round(theoryHigherCost / matched * 100) : 0}%)`);

  const theoryProfitable = [...theoryBest.values()].filter(t => t.profit > 0).length;
  const realProfitable = [...realBest.values()].filter(r => r.profit > 0).length;
  console.log(`    Profitable: theory ${theoryProfitable}, discovery ${realProfitable}`);

  if (theoryOnlyWins.length > 0) {
    theoryOnlyWins.sort((a, b) => b.profit - a.profit);
    console.log(`    Theory finds ${theoryOnlyWins.length} profitable combos discovery missed:`);
    for (const w of theoryOnlyWins.slice(0, 3)) {
      const colShort = w.combo.replace(/The /g, "").replace(/ Collection/g, "");
      console.log(`      ${colShort}: +$${(w.profit / 100).toFixed(2)} (cost $${(w.cost / 100).toFixed(2)})`);
    }
  }

  if (discoveryOnlyWins.length > 0) {
    discoveryOnlyWins.sort((a, b) => b.profit - a.profit);
    console.log(`    Discovery finds ${discoveryOnlyWins.length} profitable combos theory missed:`);
    for (const w of discoveryOnlyWins.slice(0, 3)) {
      const colShort = w.combo.replace(/The /g, "").replace(/ Collection/g, "");
      console.log(`      ${colShort}: +$${(w.profit / 100).toFixed(2)} (cost $${(w.cost / 100).toFixed(2)})`);
    }
  }

  if (bothProfitable.length > 0) {
    const avgTheoryProfit = bothProfitable.reduce((s, b) => s + b.theoryProfit, 0) / bothProfitable.length;
    const avgRealProfit = bothProfitable.reduce((s, b) => s + b.realProfit, 0) / bothProfitable.length;
    console.log(`    Both profitable: ${bothProfitable.length} combos (theory avg $${(avgTheoryProfit / 100).toFixed(2)} vs real avg $${(avgRealProfit / 100).toFixed(2)})`);
  }
}
