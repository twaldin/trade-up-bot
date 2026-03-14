/**
 * Knife/glove trade-up evaluation: EV calculation for 5-input → knife/glove pool.
 */

import Database from "better-sqlite3";
import { floatToCondition, type TradeUp, type TradeUpInput, type TradeUpOutcome } from "../../shared/types.js";
import type { ListingWithCollection } from "./types.js";
import type { FinishData } from "./knife-data.js";
import { CASE_KNIFE_MAP, GLOVE_GEN_SKINS, DOPPLER_PHASES } from "./knife-data.js";
import { calculateOutputFloat } from "./core.js";
import { lookupOutputPrice } from "./pricing.js";
import { effectiveBuyCost } from "./fees.js";

/**
 * Get all knife/glove finish skins with prices for a weapon type.
 * Returns skins with their average price across conditions.
 */
export function getKnifeFinishesWithPrices(
  db: Database.Database,
  knifeType: string
): FinishData[] {
  const skins = db.prepare(`
    SELECT DISTINCT s.name, s.min_float, s.max_float
    FROM skins s
    WHERE s.weapon = ? AND s.stattrak = 0
  `).all(knifeType) as { name: string; min_float: number; max_float: number }[];

  const results: FinishData[] = [];

  for (const skin of skins) {
    const finishPart = skin.name.includes(" | ") ? skin.name.split(" | ")[1] : null;
    const dopplerPhases = finishPart ? DOPPLER_PHASES[finishPart] : undefined;

    if (dopplerPhases) {
      // For Doppler/Gamma Doppler: compute weighted average across phases
      let totalWeightedPrice = 0;
      let totalWeight = 0;
      let hasAnyPrice = false;

      for (const { phase, weight } of dopplerPhases) {
        const phaseName = `${skin.name} ${phase}`;
        const phasePrices = db.prepare(`
          SELECT condition, median_price_cents FROM price_data
          WHERE skin_name = ? AND median_price_cents > 0
          ORDER BY median_price_cents ASC
        `).all(phaseName) as { condition: string; median_price_cents: number }[];

        if (phasePrices.length > 0) {
          const phaseAvg = phasePrices.reduce((s, p) => s + p.median_price_cents, 0) / phasePrices.length;
          totalWeightedPrice += phaseAvg * weight;
          totalWeight += weight;
          hasAnyPrice = true;
        }
      }

      if (!hasAnyPrice) {
        // Fall back to base name
        const basePrices = db.prepare(`
          SELECT condition, median_price_cents FROM price_data
          WHERE skin_name = ? AND median_price_cents > 0
        `).all(skin.name) as { condition: string; median_price_cents: number }[];
        if (basePrices.length === 0) continue;
        totalWeightedPrice = basePrices.reduce((s, p) => s + p.median_price_cents, 0) / basePrices.length;
        totalWeight = 1;
      }

      if (totalWeight === 0) continue;
      const avgPrice = totalWeightedPrice / totalWeight;

      results.push({
        name: skin.name, avgPrice, minPrice: avgPrice * 0.5, maxPrice: avgPrice * 2,
        conditions: 1, skinMinFloat: skin.min_float, skinMaxFloat: skin.max_float,
      });
    } else {
      const prices = db.prepare(`
        SELECT condition,
          COALESCE(NULLIF(median_price_cents, 0), avg_price_cents) as median_price_cents,
          min_price_cents
        FROM price_data
        WHERE skin_name = ? AND (median_price_cents > 0 OR avg_price_cents > 0)
        ORDER BY median_price_cents ASC
      `).all(skin.name) as { condition: string; median_price_cents: number; min_price_cents: number }[];

      if (prices.length === 0) continue;

      const avgPrice = prices.reduce((s, p) => s + p.median_price_cents, 0) / prices.length;
      const minPrice = Math.min(...prices.map(p => p.median_price_cents));
      const maxPrice = Math.max(...prices.map(p => p.median_price_cents));

      results.push({
        name: skin.name, avgPrice, minPrice, maxPrice, conditions: prices.length,
        skinMinFloat: skin.min_float, skinMaxFloat: skin.max_float,
      });
    }
  }

  return results;
}

/**
 * Evaluate a knife trade-up: given 5 Covert listings, compute EV from knife pool.
 *
 * For single-collection: 100% chance of that collection's knife pool.
 * For mixed collections: weighted by input proportion.
 *
 * Within each case's knife pool, all finishes are equally likely.
 */
export function evaluateKnifeTradeUp(
  db: Database.Database,
  inputs: ListingWithCollection[],
  knifeFinishCache: Map<string, FinishData[]>
): TradeUp | null {
  if (inputs.length !== 5) return null;

  const totalCost = inputs.reduce((sum, i) => sum + effectiveBuyCost(i), 0);

  const inputFloats = inputs.map(i => ({
    float_value: i.float_value,
    min_float: i.min_float,
    max_float: i.max_float,
  }));

  const inputsPerCollection = new Map<string, number>();
  for (const input of inputs) {
    inputsPerCollection.set(
      input.collection_name,
      (inputsPerCollection.get(input.collection_name) ?? 0) + 1
    );
  }

  let totalEv = 0;
  const outcomes: TradeUpOutcome[] = [];

  for (const [colName, inputCount] of inputsPerCollection) {
    const caseInfo = CASE_KNIFE_MAP[colName];
    if (!caseInfo) continue;

    const collectionWeight = inputCount / 5;

    const allFinishes: (FinishData & { itemType: string })[] = [];

    // Knife finishes — filter to only the correct finish set for this case
    if (caseInfo.knifeTypes.length > 0 && caseInfo.knifeFinishes.length > 0) {
      const allowedFinishes = new Set(caseInfo.knifeFinishes);
      for (const knifeType of caseInfo.knifeTypes) {
        const finishes = knifeFinishCache.get(knifeType) ?? [];
        for (const f of finishes) {
          const finishName = f.name.split(" | ")[1];
          if (finishName ? allowedFinishes.has(finishName) : allowedFinishes.has("Vanilla")) {
            allFinishes.push({ ...f, itemType: knifeType });
          }
        }
      }
    }

    // Glove finishes — filter to only the correct generation's skins
    if (caseInfo.gloveGen) {
      const genSkins = GLOVE_GEN_SKINS[caseInfo.gloveGen];
      if (genSkins) {
        for (const [gloveType, finishNames] of Object.entries(genSkins)) {
          const allowedNames = new Set(finishNames.map(f => `★ ${gloveType} | ${f}`));
          const finishes = knifeFinishCache.get(gloveType) ?? [];
          for (const f of finishes) {
            if (allowedNames.has(f.name)) {
              allFinishes.push({ ...f, itemType: gloveType });
            }
          }
        }
      }
    }

    if (allFinishes.length === 0) continue;

    const perFinishProb = collectionWeight / allFinishes.length;

    for (const finish of allFinishes) {
      const predFloat = calculateOutputFloat(inputFloats, finish.skinMinFloat, finish.skinMaxFloat);
      const predCondition = floatToCondition(predFloat);

      // Check if this is a Doppler/Gamma Doppler — expand into per-phase outcomes
      const finishPart = finish.name.includes(" | ") ? finish.name.split(" | ")[1] : null;
      const dopplerPhases = finishPart ? DOPPLER_PHASES[finishPart] : undefined;

      if (dopplerPhases) {
        for (const { phase, weight } of dopplerPhases) {
          const phaseName = `${finish.name} ${phase}`;
          const phaseProb = perFinishProb * weight;
          const output = lookupOutputPrice(db, phaseName, predFloat);
          if (output.priceCents <= 0) continue;

          totalEv += phaseProb * output.priceCents;
          outcomes.push({
            skin_id: "",
            skin_name: phaseName,
            collection_name: finish.itemType,
            probability: phaseProb,
            predicted_float: predFloat,
            predicted_condition: predCondition,
            estimated_price_cents: output.priceCents,
            sell_marketplace: output.marketplace,
          });
        }
      } else {
        const output = lookupOutputPrice(db, finish.name, predFloat);
        if (output.priceCents <= 0) continue;

        totalEv += perFinishProb * output.priceCents;
        outcomes.push({
          skin_id: "",
          skin_name: finish.name,
          collection_name: finish.itemType,
          probability: perFinishProb,
          predicted_float: predFloat,
          predicted_condition: predCondition,
          estimated_price_cents: output.priceCents,
          sell_marketplace: output.marketplace,
        });
      }
    }
  }

  if (outcomes.length === 0) return null;

  // Merge duplicate outcomes (e.g. two collections sharing a glove generation)
  const mergedMap = new Map<string, TradeUpOutcome>();
  for (const o of outcomes) {
    const key = `${o.skin_name}:${o.predicted_condition}`;
    const existing = mergedMap.get(key);
    if (existing) {
      existing.probability += o.probability;
      // Recalculate weighted EV contribution is already summed in totalEv — just merge the outcome entries
    } else {
      mergedMap.set(key, { ...o });
    }
  }
  const mergedOutcomes = [...mergedMap.values()];

  const evCents = Math.round(totalEv);
  const profit = evCents - totalCost;
  const roi = totalCost > 0 ? (profit / totalCost) * 100 : 0;

  const tradeUpInputs: TradeUpInput[] = inputs.map(i => ({
    listing_id: i.id,
    skin_id: i.skin_id,
    skin_name: i.skin_name,
    collection_name: i.collection_name,
    price_cents: effectiveBuyCost(i),
    float_value: i.float_value,
    condition: floatToCondition(i.float_value),
    source: i.source ?? "csfloat",
  }));

  return {
    id: 0,
    inputs: tradeUpInputs,
    outcomes: mergedOutcomes,
    total_cost_cents: totalCost,
    expected_value_cents: evCents,
    profit_cents: profit,
    roi_percentage: Math.round(roi * 100) / 100,
    created_at: new Date().toISOString(),
  };
}
