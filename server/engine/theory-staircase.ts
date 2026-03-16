/**
 * Staircase theory engine: 50 Classified → 5 Coverts → 1 Knife/Glove.
 *
 * Uses classified theories (from theory-classified.ts) as Stage 1 candidates
 * instead of real trade-ups. This explores a much larger space since we have
 * ~2300 profitable classified theories vs ~8 real profitable trade-ups.
 *
 * Outputs:
 *   - Staircase theories (saved to DB for frontend display)
 *   - Boost map for classified wanted list (prioritize skins that unlock staircases)
 */

import Database from "better-sqlite3";
import { floatToCondition, type TradeUp } from "../../shared/types.js";
import type { ClassifiedTheory } from "./types.js";
import type { ListingWithCollection } from "./types.js";
import type { FinishData } from "./knife-data.js";
import { CASE_KNIFE_MAP, GLOVE_GEN_SKINS } from "./knife-data.js";
import { calculateOutputFloat } from "./core.js";
import { evaluateKnifeTradeUp, getKnifeFinishesWithPrices } from "./knife-evaluation.js";
import { buildPriceCache } from "./pricing.js";

interface SyntheticCovert {
  collection: string;
  collectionId: string;
  expectedFloat: number;
  manufacturedCostCents: number;
  classifiedTheory: ClassifiedTheory; // source theory
}

export interface StaircaseTheory {
  tradeUp: TradeUp; // Full knife trade-up with outcomes (synthetic Covert inputs → knife/glove outputs)
  stage1Theories: ClassifiedTheory[]; // The 5 classified theories feeding in
  totalClassifiedCostCents: number; // Sum of all 50 classified input costs
  manufacturingEdgeCents: number; // Sum of (stage1 EV - stage1 cost)
}

export interface StaircaseTheoryResult {
  generated: number;
  profitable: number;
  theories: StaircaseTheory[];
  boostMap: Map<string, number>; // genericComboKey → boost score
}

export function generateStaircaseTheories(
  db: Database.Database,
  classifiedTheories: ClassifiedTheory[],
  options: {
    onProgress?: (msg: string) => void;
    maxTheories?: number;
    minStage1Roi?: number; // minimum classified theory ROI to consider (default: -10%)
  } = {}
): StaircaseTheoryResult {
  const maxTheories = options.maxTheories ?? 500;
  const minStage1Roi = options.minStage1Roi ?? -10;

  buildPriceCache(db);

  // Filter to classified theories worth considering as Stage 1 inputs
  const stage1Pool = classifiedTheories.filter(t => t.roiPct >= minStage1Roi);

  if (stage1Pool.length < 5) {
    options.onProgress?.("Staircase theory: not enough classified theories");
    return { generated: 0, profitable: 0, theories: [], boostMap: new Map() };
  }

  // For each classified theory, compute expected Covert output
  const synthetics: SyntheticCovert[] = [];

  for (const theory of stage1Pool) {
    if (theory.outcomes.length === 0) continue;

    // Compute expected float (probability-weighted average)
    let expectedFloat = 0;
    let totalProb = 0;
    for (const o of theory.outcomes) {
      expectedFloat += o.probability * o.predictedFloat;
      totalProb += o.probability;
    }
    if (totalProb <= 0) continue;
    expectedFloat /= totalProb; // normalize in case probabilities don't sum to 1

    // Find most probable output collection
    const colProb = new Map<string, number>();
    for (const o of theory.outcomes) {
      colProb.set(o.collection, (colProb.get(o.collection) ?? 0) + o.probability);
    }
    let bestCol = "";
    let bestProb = 0;
    for (const [col, prob] of colProb) {
      if (prob > bestProb) { bestCol = col; bestProb = prob; }
    }

    // Only useful if the output collection has a knife/glove mapping
    if (!bestCol || !CASE_KNIFE_MAP[bestCol]) continue;

    const colRow = db.prepare("SELECT id FROM collections WHERE name = ?").get(bestCol) as { id: string } | undefined;
    if (!colRow) continue;

    synthetics.push({
      collection: bestCol,
      collectionId: colRow.id,
      expectedFloat,
      manufacturedCostCents: theory.totalCostCents,
      classifiedTheory: theory,
    });
  }

  options.onProgress?.(`Staircase theory: ${synthetics.length} classified theories with knife-eligible outputs`);

  if (synthetics.length < 5) {
    return { generated: 0, profitable: 0, theories: [], boostMap: new Map() };
  }

  // Group by output collection
  const byCollection = new Map<string, SyntheticCovert[]>();
  for (const s of synthetics) {
    const list = byCollection.get(s.collection) ?? [];
    list.push(s);
    byCollection.set(s.collection, list);
  }

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

  // Evaluate staircase combos
  const seen = new Set<string>();
  const results: StaircaseTheory[] = [];

  function tryCombo(combo: SyntheticCovert[]) {
    const key = combo.map(c => c.classifiedTheory.comboKey).sort().join("|");
    if (seen.has(key)) return;
    seen.add(key);
    const result = evaluateStaircaseTheory(db, combo, knifeFinishCache);
    if (result) results.push(result);
  }

  // Single-collection combos
  for (const [, coverts] of byCollection) {
    if (coverts.length < 5) continue;

    // Sort by manufactured cost ascending
    coverts.sort((a, b) => a.manufacturedCostCents - b.manufacturedCostCents);
    tryCombo(coverts.slice(0, 5));

    // Also try best ROI combo
    if (coverts.length >= 10) {
      const byRoi = [...coverts].sort((a, b) => {
        const roiA = a.classifiedTheory.roiPct;
        const roiB = b.classifiedTheory.roiPct;
        return roiB - roiA;
      });
      tryCombo(byRoi.slice(0, 5));
    }

    // Try cheapest 5 of profitable-only
    const profitable = coverts.filter(c => c.classifiedTheory.profitCents > 0);
    if (profitable.length >= 5) {
      tryCombo(profitable.slice(0, 5));
    }
  }

  // Cross-collection combos (2 collections)
  const colNames = [...byCollection.keys()].filter(c => (byCollection.get(c)?.length ?? 0) >= 2);
  for (let i = 0; i < Math.min(colNames.length, 20); i++) {
    for (let j = i + 1; j < Math.min(colNames.length, 20); j++) {
      const poolA = byCollection.get(colNames[i])!;
      const poolB = byCollection.get(colNames[j])!;
      const pooled = [...poolA, ...poolB].sort((a, b) => a.manufacturedCostCents - b.manufacturedCostCents);
      if (pooled.length < 5) continue;
      tryCombo(pooled.slice(0, 5));
    }
  }

  results.sort((a, b) => b.tradeUp.profit_cents - a.tradeUp.profit_cents);
  const kept = results.slice(0, maxTheories);
  const profitable = kept.filter(r => r.tradeUp.profit_cents > 0).length;

  // Build boost map: which classified theories contribute to profitable staircases?
  const boostMap = new Map<string, number>();
  for (const st of kept) {
    if (st.tradeUp.profit_cents <= 0) continue;
    const boost = Math.min(500, Math.round(st.tradeUp.profit_cents / 10)); // $1 staircase profit → 10 boost
    for (const ct of st.stage1Theories) {
      const existing = boostMap.get(ct.comboKey) ?? 0;
      boostMap.set(ct.comboKey, Math.max(existing, boost));
    }
  }

  options.onProgress?.(`Staircase theory: ${kept.length} theories (${profitable} profitable), ${boostMap.size} classified combos boosted`);

  return { generated: kept.length, profitable, theories: kept, boostMap };
}

function evaluateStaircaseTheory(
  db: Database.Database,
  inputs: SyntheticCovert[],
  knifeFinishCache: Map<string, FinishData[]>
): StaircaseTheory | null {
  if (inputs.length !== 5) return null;

  // Build synthetic ListingWithCollection entries
  const syntheticInputs: ListingWithCollection[] = [];
  for (const inp of inputs) {
    const covertSkin = db.prepare(`
      SELECT s.id, s.name, s.weapon, s.min_float, s.max_float, s.rarity,
        sc.collection_id, c.name as collection_name
      FROM skins s
      JOIN skin_collections sc ON s.id = sc.skin_id
      JOIN collections c ON sc.collection_id = c.id
      WHERE c.name = ? AND s.rarity = 'Covert' AND s.stattrak = 0 AND s.name NOT LIKE '★%'
      LIMIT 1
    `).get(inp.collection) as { id: string; name: string; weapon: string; min_float: number; max_float: number; rarity: string; collection_id: string; collection_name: string } | undefined;

    if (!covertSkin) continue;

    syntheticInputs.push({
      id: `staircase-theory-${inp.classifiedTheory.comboKey}`,
      skin_id: covertSkin.id,
      skin_name: covertSkin.name,
      weapon: covertSkin.weapon,
      price_cents: inp.manufacturedCostCents,
      float_value: inp.expectedFloat,
      paint_seed: null,
      stattrak: 0,
      min_float: covertSkin.min_float,
      max_float: covertSkin.max_float,
      rarity: "Covert",
      collection_id: inp.collectionId,
      collection_name: inp.collection,
      source: "csfloat",
    });
  }

  if (syntheticInputs.length !== 5) return null;

  const tradeUp = evaluateKnifeTradeUp(db, syntheticInputs, knifeFinishCache);
  if (!tradeUp || tradeUp.expected_value_cents <= 0) return null;

  const totalCost = inputs.reduce((s, i) => s + i.manufacturedCostCents, 0);
  const manufacturingEdge = inputs.reduce((s, i) => s + (i.classifiedTheory.evCents - i.manufacturedCostCents), 0);
  const profit = tradeUp.expected_value_cents - totalCost;

  // Patch the TradeUp with staircase-specific costs
  tradeUp.total_cost_cents = totalCost;
  tradeUp.profit_cents = profit;
  tradeUp.roi_percentage = totalCost > 0 ? Math.round((profit / totalCost) * 10000) / 100 : 0;
  tradeUp.type = "staircase";

  return {
    tradeUp,
    stage1Theories: inputs.map(i => i.classifiedTheory),
    totalClassifiedCostCents: totalCost,
    manufacturingEdgeCents: Math.round(manufacturingEdge),
  };
}

export function saveStaircaseTheoryTradeUps(db: Database.Database, theories: StaircaseTheory[]) {
  const lookupSkinId = db.prepare("SELECT id FROM skins WHERE name = ? AND stattrak = 0 LIMIT 1");

  const insertTradeUp = db.prepare(`
    INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, chance_to_profit, type, best_case_cents, worst_case_cents, is_theoretical, source, outcomes_json)
    VALUES (?, ?, ?, ?, ?, 'staircase', ?, ?, 1, 'theory', ?)
  `);
  const insertInput = db.prepare(`
    INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const saveAll = db.transaction(() => {
    // Clear old staircase theoretical trade-ups only
    db.exec("DELETE FROM trade_up_inputs WHERE trade_up_id IN (SELECT id FROM trade_ups WHERE is_theoretical = 1 AND type = 'staircase')");
    db.exec("DELETE FROM trade_ups WHERE is_theoretical = 1 AND type = 'staircase'");

    for (const st of theories) {
      const tu = st.tradeUp;
      const chanceToProfit = tu.outcomes.reduce((sum, o) =>
        sum + (o.estimated_price_cents > tu.total_cost_cents ? o.probability : 0), 0
      );
      const bestCase = tu.outcomes.length > 0
        ? Math.max(...tu.outcomes.map(o => o.estimated_price_cents)) - tu.total_cost_cents : 0;
      const worstCase = tu.outcomes.length > 0
        ? Math.min(...tu.outcomes.map(o => o.estimated_price_cents)) - tu.total_cost_cents : -tu.total_cost_cents;

      const result = insertTradeUp.run(
        tu.total_cost_cents, tu.expected_value_cents, tu.profit_cents,
        tu.roi_percentage, chanceToProfit, bestCase, worstCase,
        JSON.stringify(tu.outcomes)
      );
      const tradeUpId = result.lastInsertRowid;

      // Inputs: save ALL 50 classified inputs from stage-1 theories (what you actually buy)
      for (const stage1 of st.stage1Theories) {
        for (const input of stage1.inputSkins) {
          const skinRow = lookupSkinId.get(input.skinName) as { id: string } | undefined;
          insertInput.run(
            tradeUpId, "theoretical", skinRow?.id ?? "", input.skinName,
            input.collection, input.priceCents, input.floatValue, input.condition
          );
        }
      }
    }
  });

  saveAll();
}
