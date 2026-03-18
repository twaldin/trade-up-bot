/**
 * Staircase trade-ups: 50 Classified → 5 Coverts → 1 Knife/Glove.
 *
 * Uses EV approximation: each Stage 1 trade-up produces a synthetic Covert
 * with expected float and manufactured cost. Stage 2 evaluates these as a
 * knife trade-up. This is correct in expectation and avoids O(k^5) blowup.
 */

import pg from "pg";
import { floatToCondition, type TradeUp } from "../../shared/types.js";
import type { ListingWithCollection } from "./types.js";
import type { FinishData } from "./knife-data.js";
import { CASE_KNIFE_MAP, GLOVE_GEN_SKINS } from "./knife-data.js";
import { evaluateKnifeTradeUp, getKnifeFinishesWithPrices } from "./knife-evaluation.js";
import { buildPriceCache } from "./pricing.js";

interface SyntheticCovert {
  skinName: string;
  collection: string;
  collectionId: string;
  expectedFloat: number;
  manufacturedCostCents: number; // total cost of the 10 classified inputs
  stage1TradeUpId: number;
  stage1EV: number; // expected value of stage 1 outputs
}

export interface StaircaseTradeUp {
  tradeUp: TradeUp; // Full trade-up with knife/glove outcomes and synthetic Covert inputs
  stage1Ids: number[]; // IDs of classified→covert trade-ups feeding into this
  manufacturingEdgeCents: number;
}

export interface StaircaseResult {
  total: number;
  profitable: number;
  tradeUps: StaircaseTradeUp[];
}

/**
 * Find staircase trade-ups from existing classified→covert and knife trade-up data.
 */
export async function findStaircaseTradeUps(
  pool: pg.Pool,
  options: {
    onProgress?: (msg: string) => void;
    minStage1Roi?: number; // minimum stage 1 ROI to consider (default: -20%)
  } = {}
): Promise<StaircaseResult> {
  const minStage1Roi = options.minStage1Roi ?? -20;

  await buildPriceCache(pool);

  // Load classified→covert trade-ups with their outcomes
  const { rows: stage1Candidates } = await pool.query(`
    SELECT t.id, t.total_cost_cents, t.expected_value_cents, t.profit_cents, t.roi_percentage
    FROM trade_ups t
    WHERE t.type = 'classified_covert' AND t.is_theoretical = 0
      AND t.roi_percentage >= $1
    ORDER BY t.roi_percentage DESC
    LIMIT 5000
  `, [minStage1Roi]);

  if (stage1Candidates.length === 0) {
    options.onProgress?.("Staircase: no stage 1 candidates");
    return { total: 0, profitable: 0, tradeUps: [] };
  }

  // For each candidate, compute probability-weighted expected output
  const synthetics: SyntheticCovert[] = [];

  for (const s1 of stage1Candidates) {
    const { rows: tuRows } = await pool.query("SELECT outcomes_json FROM trade_ups WHERE id = $1", [s1.id]);
    const tuRow = tuRows[0] as { outcomes_json: string | null } | undefined;
    const outcomes = (tuRow?.outcomes_json ? JSON.parse(tuRow.outcomes_json) : []) as { skin_name: string; collection_name: string; probability: number; predicted_float: number; estimated_price_cents: number }[];

    if (outcomes.length === 0) continue;

    // Compute expected float (probability-weighted average)
    let expectedFloat = 0;
    for (const o of outcomes) {
      expectedFloat += o.probability * o.predicted_float;
    }

    // Find most probable output collection (where manufactured Covert will land)
    const colProb = new Map<string, number>();
    for (const o of outcomes) {
      colProb.set(o.collection_name, (colProb.get(o.collection_name) ?? 0) + o.probability);
    }
    let bestCol = "";
    let bestProb = 0;
    for (const [col, prob] of colProb) {
      if (prob > bestProb) { bestCol = col; bestProb = prob; }
    }

    // Only useful if the output collection has a knife/glove mapping
    if (!bestCol || !CASE_KNIFE_MAP[bestCol]) continue;

    // Get collection ID
    const { rows: colRows } = await pool.query("SELECT id FROM collections WHERE name = $1", [bestCol]);
    const colRow = colRows[0] as { id: string } | undefined;
    if (!colRow) continue;

    synthetics.push({
      skinName: `Stage1#${s1.id}`,
      collection: bestCol,
      collectionId: colRow.id,
      expectedFloat,
      manufacturedCostCents: s1.total_cost_cents,
      stage1TradeUpId: s1.id,
      stage1EV: s1.expected_value_cents,
    });
  }

  options.onProgress?.(`Staircase: ${synthetics.length} stage 1 candidates with knife-eligible outputs`);

  if (synthetics.length < 5) {
    return { total: 0, profitable: 0, tradeUps: [] };
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
    const finishes = await getKnifeFinishesWithPrices(pool, itemType);
    if (finishes.length > 0) knifeFinishCache.set(itemType, finishes);
  }

  // Deduplicate by sorted stage1Ids
  const seen = new Set<string>();
  const results: StaircaseTradeUp[] = [];

  async function tryCombo(combo: SyntheticCovert[]) {
    const key = combo.map(c => c.stage1TradeUpId).sort((a, b) => a - b).join(",");
    if (seen.has(key)) return;
    seen.add(key);
    const result = await evaluateStaircase(pool, combo, knifeFinishCache);
    if (result) results.push(result);
  }

  // For each collection with 5+ synthetic Coverts, try staircase combos
  for (const [, coverts] of byCollection) {
    if (coverts.length < 5) continue;

    // Sort by manufacturing cost (cheapest first)
    coverts.sort((a, b) => a.manufacturedCostCents - b.manufacturedCostCents);

    // Try sliding windows over cheapest-sorted list (stride 1)
    const maxWindows = Math.min(coverts.length - 4, 20);
    for (let w = 0; w < maxWindows; w++) {
      await tryCombo(coverts.slice(w, w + 5));
    }

    // Try combinations with best ROI
    if (coverts.length >= 10) {
      const byRoi = [...coverts].sort((a, b) => {
        const roiA = (a.stage1EV - a.manufacturedCostCents) / a.manufacturedCostCents;
        const roiB = (b.stage1EV - b.manufacturedCostCents) / b.manufacturedCostCents;
        return roiB - roiA;
      });
      const maxRoiWindows = Math.min(byRoi.length - 4, 20);
      for (let w = 0; w < maxRoiWindows; w++) {
        await tryCombo(byRoi.slice(w, w + 5));
      }
    }
  }

  // Also try cross-collection combos (2 collections)
  const colNames = [...byCollection.keys()].filter(c => (byCollection.get(c)?.length ?? 0) >= 2);
  for (let i = 0; i < Math.min(colNames.length, 50); i++) {
    for (let j = i + 1; j < Math.min(colNames.length, 50); j++) {
      const poolA = byCollection.get(colNames[i])!;
      const poolB = byCollection.get(colNames[j])!;
      const pooled = [...poolA, ...poolB].sort((a, b) => a.manufacturedCostCents - b.manufacturedCostCents);
      if (pooled.length < 5) continue;
      await tryCombo(pooled.slice(0, 5));
    }
  }

  // Try 3-collection combos
  for (let i = 0; i < Math.min(colNames.length, 30); i++) {
    for (let j = i + 1; j < Math.min(colNames.length, 30); j++) {
      for (let k = j + 1; k < Math.min(colNames.length, 30); k++) {
        const poolA = byCollection.get(colNames[i])!;
        const poolB = byCollection.get(colNames[j])!;
        const poolC = byCollection.get(colNames[k])!;
        const pooled = [...poolA, ...poolB, ...poolC].sort((a, b) => a.manufacturedCostCents - b.manufacturedCostCents);
        if (pooled.length < 5) continue;
        await tryCombo(pooled.slice(0, 5));
        if (pooled.length >= 7) await tryCombo(pooled.slice(1, 6));
      }
    }
  }

  results.sort((a, b) => b.tradeUp.profit_cents - a.tradeUp.profit_cents);
  const profitable = results.filter(r => r.tradeUp.profit_cents > 0).length;

  options.onProgress?.(`Staircase: ${results.length} evaluated, ${profitable} profitable`);

  return { total: results.length, profitable, tradeUps: results };
}

async function evaluateStaircase(
  pool: pg.Pool,
  inputs: SyntheticCovert[],
  knifeFinishCache: Map<string, FinishData[]>
): Promise<StaircaseTradeUp | null> {
  if (inputs.length !== 5) return null;

  // Build synthetic ListingWithCollection entries
  const syntheticInputs: ListingWithCollection[] = [];
  for (const inp of inputs) {
    // Find a real Covert skin from this collection to get float range
    const { rows: covertRows } = await pool.query(`
      SELECT s.id, s.name, s.weapon, s.min_float, s.max_float, s.rarity,
        sc.collection_id, c.name as collection_name
      FROM skins s
      JOIN skin_collections sc ON s.id = sc.skin_id
      JOIN collections c ON sc.collection_id = c.id
      WHERE c.name = $1 AND s.rarity = 'Covert' AND s.stattrak = 0 AND s.name NOT LIKE '★%'
      LIMIT 1
    `, [inp.collection]);
    const covertSkin = covertRows[0] as {
      id: string; name: string; weapon: string; min_float: number; max_float: number;
      rarity: string; collection_id: string; collection_name: string;
    } | undefined;

    if (!covertSkin) continue;

    syntheticInputs.push({
      id: `staircase-${inp.stage1TradeUpId}`,
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

  // Evaluate as knife trade-up — this returns a full TradeUp with outcomes
  const tradeUp = await evaluateKnifeTradeUp(pool, syntheticInputs, knifeFinishCache);
  if (!tradeUp || tradeUp.expected_value_cents <= 0) return null;

  // Override cost with total manufactured cost (sum of 5 stage-1 costs)
  const totalCost = inputs.reduce((s, i) => s + i.manufacturedCostCents, 0);
  const manufacturingEdge = inputs.reduce((s, i) => s + (i.stage1EV - i.manufacturedCostCents), 0);
  const profit = tradeUp.expected_value_cents - totalCost;

  // Patch the TradeUp with staircase-specific costs
  tradeUp.total_cost_cents = totalCost;
  tradeUp.profit_cents = profit;
  tradeUp.roi_percentage = totalCost > 0 ? Math.round((profit / totalCost) * 10000) / 100 : 0;
  tradeUp.type = "staircase";

  return {
    tradeUp,
    stage1Ids: inputs.map(i => i.stage1TradeUpId),
    manufacturingEdgeCents: Math.round(manufacturingEdge),
  };
}
