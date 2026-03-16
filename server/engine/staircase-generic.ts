/**
 * Generic N-stage staircase trade-ups.
 *
 * Composes multiple trade-up tiers into multi-step chains:
 *   - staircase_rc:  100 Restricted → 10 Classified → 1 Covert
 *   - staircase_rck: 100 Restricted → 10 Classified → 5 Covert → 1 Knife
 *   - staircase_mrc: 1000 Mil-Spec → 100 Restricted → 10 Classified → 1 Covert
 *
 * Each stage takes existing 1-step trade-ups from the DB, computes their
 * probability-weighted expected output (synthetic skin), then groups synthetics
 * and evaluates them as the next tier's trade-up.
 *
 * The existing `staircase.ts` handles the original 2-stage (Classified→Covert→Knife).
 * This module handles all new multi-stage chains.
 */

import Database from "better-sqlite3";
import { floatToCondition, type TradeUp, type TradeUpOutcome } from "../../shared/types.js";
import type { ListingWithCollection, DbSkinOutcome } from "./types.js";
import type { FinishData } from "./knife-data.js";
import { CASE_KNIFE_MAP, GLOVE_GEN_SKINS } from "./knife-data.js";
import { evaluateKnifeTradeUp, getKnifeFinishesWithPrices } from "./knife-evaluation.js";
import { evaluateTradeUp } from "./evaluation.js";
import { getOutcomesForCollections } from "./data-load.js";
import { buildPriceCache } from "./pricing.js";
import type { StaircaseChainConfig } from "./rarity-tiers.js";
import { getTierById, STAIRCASE_CHAINS } from "./rarity-tiers.js";

interface SyntheticOutput {
  skinName: string;
  collection: string;
  collectionId: string;
  expectedFloat: number;
  manufacturedCostCents: number;
  sourceTradeUpId: number;
  sourceEV: number;
  outputRarity: string;
  baseTradeUpIds: number[]; // IDs of base-level trade-ups that feed this synthetic
}

export interface GenericStaircaseTradeUp {
  tradeUp: TradeUp;
  stageIds: number[][]; // IDs of trade-ups at each stage
  totalInputCount: number;
}

export interface GenericStaircaseResult {
  chainId: string;
  total: number;
  profitable: number;
  tradeUps: GenericStaircaseTradeUp[];
}

/**
 * Build synthetic outputs from existing trade-ups of a given type.
 * Each trade-up's outcomes are collapsed into a single probability-weighted synthetic output.
 */
function buildSyntheticsFromTradeUps(
  db: Database.Database,
  tradeUpType: string,
  outputRarity: string,
  options: {
    minRoi?: number;
    limit?: number;
    requireKnifeEligible?: boolean;
  } = {}
): SyntheticOutput[] {
  const minRoi = options.minRoi ?? -30;
  const limit = options.limit ?? 5000;

  // Use all trade-ups (including multi-collection). The EV calculation correctly
  // weights all possible outcome paths. Multi-collection staircases have higher
  // variance but the expected value is still mathematically accurate.
  const candidates = db.prepare(`
    SELECT t.id, t.total_cost_cents, t.expected_value_cents, t.profit_cents, t.roi_percentage
    FROM trade_ups t
    WHERE t.type = ? AND t.is_theoretical = 0
      AND t.roi_percentage >= ?
    ORDER BY t.roi_percentage DESC
    LIMIT ?
  `).all(tradeUpType, minRoi, limit) as {
    id: number; total_cost_cents: number; expected_value_cents: number;
    profit_cents: number; roi_percentage: number;
  }[];

  const synthetics: SyntheticOutput[] = [];

  for (const s1 of candidates) {
    const tuRow = db.prepare("SELECT outcomes_json FROM trade_ups WHERE id = ?").get(s1.id) as { outcomes_json: string | null } | undefined;
    const outcomes = (tuRow?.outcomes_json ? JSON.parse(tuRow.outcomes_json) : []) as {
      skin_name: string; collection_name: string; probability: number;
      predicted_float: number; estimated_price_cents: number;
    }[];

    if (outcomes.length === 0) continue;

    // Probability-weighted expected float
    let expectedFloat = 0;
    for (const o of outcomes) {
      expectedFloat += o.probability * o.predicted_float;
    }

    // Use most-probable output collection for the synthetic.
    // This is an approximation — multi-collection trade-ups have variance in which
    // collection the output lands. The EV is correct in expectation but individual
    // executions may differ. Single-collection base trade-ups are fully deterministic.
    const colProb = new Map<string, number>();
    for (const o of outcomes) {
      colProb.set(o.collection_name, (colProb.get(o.collection_name) ?? 0) + o.probability);
    }
    let bestCol = "";
    let bestProb = 0;
    for (const [col, prob] of colProb) {
      if (prob > bestProb) { bestCol = col; bestProb = prob; }
    }
    if (!bestCol) continue;

    if (options.requireKnifeEligible && !CASE_KNIFE_MAP[bestCol]) continue;

    const colRow = db.prepare("SELECT id FROM collections WHERE name = ?").get(bestCol) as { id: string } | undefined;
    if (!colRow) continue;

    const isSingleCollection = colProb.size === 1;

    synthetics.push({
      skinName: `Synthetic#${s1.id}`,
      collection: bestCol,
      collectionId: colRow.id,
      expectedFloat,
      manufacturedCostCents: s1.total_cost_cents,
      sourceTradeUpId: s1.id,
      sourceEV: s1.expected_value_cents,
      outputRarity,
      baseTradeUpIds: [s1.id],
    });
  }

  return synthetics;
}

/**
 * Build synthetic ListingWithCollection from a SyntheticOutput.
 * Finds a real skin of the target rarity in the collection to get float range.
 */
function syntheticToListing(
  db: Database.Database,
  synthetic: SyntheticOutput,
  excludeKnife: boolean = true,
): ListingWithCollection | null {
  const knifeFilter = excludeKnife ? " AND s.name NOT LIKE '★%'" : "";
  const skin = db.prepare(`
    SELECT s.id, s.name, s.weapon, s.min_float, s.max_float, s.rarity,
      sc.collection_id, c.name as collection_name
    FROM skins s
    JOIN skin_collections sc ON s.id = sc.skin_id
    JOIN collections c ON sc.collection_id = c.id
    WHERE c.name = ? AND s.rarity = ? AND s.stattrak = 0${knifeFilter}
    LIMIT 1
  `).get(synthetic.collection, synthetic.outputRarity) as {
    id: string; name: string; weapon: string; min_float: number; max_float: number;
    rarity: string; collection_id: string; collection_name: string;
  } | undefined;

  if (!skin) return null;

  return {
    id: `staircase-${synthetic.sourceTradeUpId}`,
    skin_id: skin.id,
    skin_name: skin.name,
    weapon: skin.weapon,
    price_cents: synthetic.manufacturedCostCents,
    float_value: synthetic.expectedFloat,
    paint_seed: null,
    stattrak: 0,
    min_float: skin.min_float,
    max_float: skin.max_float,
    rarity: synthetic.outputRarity,
    collection_id: synthetic.collectionId,
    collection_name: synthetic.collection,
    source: "csfloat",
  };
}

/**
 * Evaluate a combo of synthetics as a non-knife trade-up (gun → gun).
 */
function evaluateGunStaircase(
  db: Database.Database,
  synthetics: SyntheticOutput[],
  outputRarity: string,
): TradeUp | null {
  const inputs: ListingWithCollection[] = [];
  for (const s of synthetics) {
    const listing = syntheticToListing(db, s, true);
    if (!listing) return null;
    inputs.push(listing);
  }

  const collectionIds = [...new Set(inputs.map(i => i.collection_id))];
  const outcomes = getOutcomesForCollections(db, collectionIds, outputRarity, false);
  if (outcomes.length === 0) return null;

  return evaluateTradeUp(db, inputs, outcomes);
}

/**
 * Evaluate a combo of synthetics as a knife trade-up (5 Covert → 1 Knife/Glove).
 */
function evaluateKnifeStaircase(
  db: Database.Database,
  synthetics: SyntheticOutput[],
  knifeFinishCache: Map<string, FinishData[]>,
): TradeUp | null {
  const inputs: ListingWithCollection[] = [];
  for (const s of synthetics) {
    const listing = syntheticToListing(db, s, true);
    if (!listing) return null;
    inputs.push(listing);
  }

  return evaluateKnifeTradeUp(db, inputs, knifeFinishCache);
}

/**
 * Try combos of N synthetics from the pool. Uses sliding windows + cross-collection mixing.
 */
function findCombos(
  byCollection: Map<string, SyntheticOutput[]>,
  comboSize: number,
  callback: (combo: SyntheticOutput[]) => void,
) {
  const seen = new Set<string>();

  function tryCombo(combo: SyntheticOutput[]) {
    const key = combo.map(c => c.sourceTradeUpId).sort((a, b) => a - b).join(",");
    if (seen.has(key)) return;
    seen.add(key);
    callback(combo);
  }

  // Single-collection combos
  for (const [, pool] of byCollection) {
    if (pool.length < comboSize) continue;
    pool.sort((a, b) => a.manufacturedCostCents - b.manufacturedCostCents);
    const maxWindows = Math.min(pool.length - comboSize + 1, 20);
    for (let w = 0; w < maxWindows; w++) {
      tryCombo(pool.slice(w, w + comboSize));
    }
  }

  // Cross-collection combos (2 collections)
  const colNames = [...byCollection.keys()].filter(c => (byCollection.get(c)?.length ?? 0) >= 1);
  for (let i = 0; i < Math.min(colNames.length, 40); i++) {
    for (let j = i + 1; j < Math.min(colNames.length, 40); j++) {
      const pooled = [
        ...byCollection.get(colNames[i])!,
        ...byCollection.get(colNames[j])!,
      ].sort((a, b) => a.manufacturedCostCents - b.manufacturedCostCents);
      if (pooled.length < comboSize) continue;
      tryCombo(pooled.slice(0, comboSize));
    }
  }

  // Cross-collection combos (3 collections)
  for (let i = 0; i < Math.min(colNames.length, 25); i++) {
    for (let j = i + 1; j < Math.min(colNames.length, 25); j++) {
      for (let k = j + 1; k < Math.min(colNames.length, 25); k++) {
        const pooled = [
          ...byCollection.get(colNames[i])!,
          ...byCollection.get(colNames[j])!,
          ...byCollection.get(colNames[k])!,
        ].sort((a, b) => a.manufacturedCostCents - b.manufacturedCostCents);
        if (pooled.length < comboSize) continue;
        tryCombo(pooled.slice(0, comboSize));
      }
    }
  }
}

/**
 * Build knife finish cache (shared across all knife-output chains).
 */
function buildKnifeFinishCache(db: Database.Database): Map<string, FinishData[]> {
  const cache = new Map<string, FinishData[]>();
  const allItemTypes = new Set<string>();
  for (const caseInfo of Object.values(CASE_KNIFE_MAP)) {
    for (const kt of caseInfo.knifeTypes) allItemTypes.add(kt);
    if (caseInfo.gloveGen) {
      for (const gt of Object.keys(GLOVE_GEN_SKINS[caseInfo.gloveGen])) allItemTypes.add(gt);
    }
  }
  for (const itemType of allItemTypes) {
    const finishes = getKnifeFinishesWithPrices(db, itemType);
    if (finishes.length > 0) cache.set(itemType, finishes);
  }
  return cache;
}

/**
 * Find staircase trade-ups for a specific chain config.
 */
export function findGenericStaircaseTradeUps(
  db: Database.Database,
  chain: StaircaseChainConfig,
  options: { onProgress?: (msg: string) => void } = {},
): GenericStaircaseResult {
  const label = chain.label;
  buildPriceCache(db);

  // The last stage in the chain produces the "feeder" trade-ups.
  // For staircase_rc: stages = [restricted_classified, classified_covert]
  //   → Use classified_covert trade-ups (which already exist) as the base.
  //   → But we actually want to BUILD classified_covert from restricted_classified synthetics first.
  //
  // Actually, the chain works bottom-up:
  //   Stage 0: Load existing trade-ups of stages[0] type → build synthetics
  //   Stage 1: Combine synthetics into stages[1] trade-ups → build next-level synthetics
  //   ...
  //   Final: Evaluate last-level synthetics as either gun-trade-up or knife-trade-up

  if (chain.stages.length === 0) {
    return { chainId: chain.id, total: 0, profitable: 0, tradeUps: [] };
  }

  // Get tier configs for each stage
  const tiers = chain.stages.map(id => getTierById(id)!);
  if (tiers.some(t => !t)) {
    options.onProgress?.(`${label}: invalid tier config`);
    return { chainId: chain.id, total: 0, profitable: 0, tradeUps: [] };
  }

  // Stage 0: Load base trade-ups → build synthetics
  const baseTier = tiers[0];
  let synthetics = buildSyntheticsFromTradeUps(
    db, baseTier.tradeUpType, baseTier.outputRarity,
    { minRoi: -30, limit: 5000 },
  );
  options.onProgress?.(`${label}: ${synthetics.length} base synthetics from ${baseTier.tradeUpType}`);

  if (synthetics.length === 0) {
    return { chainId: chain.id, total: 0, profitable: 0, tradeUps: [] };
  }

  // Track all stage IDs for the final result
  // stageIds[0] = base trade-up IDs, stageIds[1] = intermediate IDs, etc.
  // For now we only track the base stage IDs.

  const results: GenericStaircaseTradeUp[] = [];
  const isLastStageKnife = chain.isKnifeOutput;

  // Intermediate stages: compose synthetics into next-tier synthetics.
  // For the LAST stage of non-knife chains, keep the full TradeUp results
  // instead of collapsing into synthetics (so we have real inputs+outcomes).
  for (let stageIdx = 1; stageIdx < tiers.length; stageIdx++) {
    const tier = tiers[stageIdx];
    const prevOutputRarity = tiers[stageIdx - 1].outputRarity;
    const isLastIntermediateStage = stageIdx === tiers.length - 1 && !isLastStageKnife;

    options.onProgress?.(`${label}: stage ${stageIdx + 1} — ${synthetics.length} ${prevOutputRarity} synthetics → ${tier.outputRarity}`);

    const byCol = new Map<string, SyntheticOutput[]>();
    for (const s of synthetics) {
      const list = byCol.get(s.collection) ?? [];
      list.push(s);
      byCol.set(s.collection, list);
    }

    const nextSynthetics: SyntheticOutput[] = [];
    let evalCount = 0;

    // Compute total inputs for this chain depth
    let totalInputs = tier.inputCount;
    for (let i = stageIdx - 1; i >= 0; i--) {
      totalInputs *= tiers[i].inputCount;
    }

    findCombos(byCol, tier.inputCount, (combo) => {
      evalCount++;
      const result = evaluateGunStaircase(db, combo, tier.outputRarity);
      if (!result || result.expected_value_cents <= 0) return;

      const totalCost = combo.reduce((s, c) => s + c.manufacturedCostCents, 0);

      if (isLastIntermediateStage) {
        // This IS the final output — keep the full TradeUp with real outcomes
        const profit = result.expected_value_cents - totalCost;
        result.total_cost_cents = totalCost;
        result.profit_cents = profit;
        result.roi_percentage = totalCost > 0 ? Math.round((profit / totalCost) * 10000) / 100 : 0;
        result.type = chain.tradeUpType;

        if (profit > 0) {
          const allBaseIds = combo.flatMap(c => c.baseTradeUpIds);
          results.push({
            tradeUp: result,
            stageIds: [allBaseIds],
            totalInputCount: totalInputs,
          });
        }
      } else {
        // Intermediate — collapse into synthetic for the next stage
        const avgFloat = result.outcomes.reduce((s, o) => s + o.probability * o.predicted_float, 0);
        const colProb = new Map<string, number>();
        for (const o of result.outcomes) {
          colProb.set(o.collection_name, (colProb.get(o.collection_name) ?? 0) + o.probability);
        }
        let bestCol = "";
        let bestProb = 0;
        for (const [col, prob] of colProb) {
          if (prob > bestProb) { bestCol = col; bestProb = prob; }
        }
        if (!bestCol) return;
        const colRow = db.prepare("SELECT id FROM collections WHERE name = ?").get(bestCol) as { id: string } | undefined;
        if (!colRow) return;

        // Aggregate base trade-up IDs from all input synthetics
        const allBaseIds = combo.flatMap(c => c.baseTradeUpIds);

        nextSynthetics.push({
          skinName: `Chain${stageIdx}#${evalCount}`,
          collection: bestCol,
          collectionId: colRow.id,
          expectedFloat: avgFloat,
          manufacturedCostCents: totalCost,
          sourceTradeUpId: evalCount,
          sourceEV: result.expected_value_cents,
          outputRarity: tier.outputRarity,
          baseTradeUpIds: allBaseIds,
        });
      }
    });

    options.onProgress?.(`${label}: stage ${stageIdx + 1} produced ${isLastIntermediateStage ? results.length + ' results' : nextSynthetics.length + ' synthetics'} from ${evalCount} combos`);

    if (!isLastIntermediateStage) {
      if (nextSynthetics.length === 0) {
        return { chainId: chain.id, total: 0, profitable: 0, tradeUps: [] };
      }
      synthetics = nextSynthetics;
    }
  }

  // Final stage for knife-output chains: 5 synthetics → 1 knife/glove
  if (isLastStageKnife) {
    const byCol = new Map<string, SyntheticOutput[]>();
    for (const s of synthetics) {
      const list = byCol.get(s.collection) ?? [];
      list.push(s);
      byCol.set(s.collection, list);
    }

    const knifeFinishCache = buildKnifeFinishCache(db);
    const knifeEligible = new Map<string, SyntheticOutput[]>();
    for (const [col, pool] of byCol) {
      if (CASE_KNIFE_MAP[col]) knifeEligible.set(col, pool);
    }

    let totalInputs = 5;
    for (let i = tiers.length - 1; i >= 0; i--) {
      totalInputs *= tiers[i].inputCount;
    }

    findCombos(knifeEligible, 5, (combo) => {
      const tradeUp = evaluateKnifeStaircase(db, combo, knifeFinishCache);
      if (!tradeUp || tradeUp.expected_value_cents <= 0) return;

      const totalCost = combo.reduce((s, c) => s + c.manufacturedCostCents, 0);
      const profit = tradeUp.expected_value_cents - totalCost;

      tradeUp.total_cost_cents = totalCost;
      tradeUp.profit_cents = profit;
      tradeUp.roi_percentage = totalCost > 0 ? Math.round((profit / totalCost) * 10000) / 100 : 0;
      tradeUp.type = chain.tradeUpType;

      const allBaseIds = combo.flatMap(c => c.baseTradeUpIds);
      results.push({
        tradeUp,
        stageIds: [allBaseIds],
        totalInputCount: totalInputs,
      });
    });
  }

  results.sort((a, b) => b.tradeUp.profit_cents - a.tradeUp.profit_cents);
  const profitable = results.filter(r => r.tradeUp.profit_cents > 0).length;

  options.onProgress?.(`${label}: ${results.length} evaluated, ${profitable} profitable`);

  return { chainId: chain.id, total: results.length, profitable, tradeUps: results };
}

/**
 * Run all new staircase chains (excludes the original "staircase" which is handled by staircase.ts).
 */
export function findAllGenericStaircases(
  db: Database.Database,
  options: { onProgress?: (msg: string) => void } = {},
): GenericStaircaseResult[] {
  const results: GenericStaircaseResult[] = [];

  for (const chain of STAIRCASE_CHAINS) {
    // Skip the original staircase — handled by staircase.ts
    if (chain.id === "staircase") continue;

    options.onProgress?.(`\n  Evaluating chain: ${chain.label}`);
    const result = findGenericStaircaseTradeUps(db, chain, options);
    results.push(result);

    if (result.profitable > 0) {
      options.onProgress?.(`  ${chain.label}: ${result.profitable} profitable (best $${(result.tradeUps[0]?.tradeUp.profit_cents / 100).toFixed(2)})`);
    }
  }

  return results;
}
