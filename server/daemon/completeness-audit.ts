/**
 * Completeness Audit — brute-force gap detection.
 *
 * Every 10th cycle, checks whether the discovery engine is missing profitable
 * trade-ups by exhaustively evaluating "obvious" combos and comparing against
 * what's in the database.
 *
 * Gun audit: picks 5 random collections, tries cheapest-N windows and cross-
 * collection pairs, flags any profitable TU not in DB.
 *
 * Knife audit: ALL knife-eligible collection pairs (~43 collections, ~903 pairs).
 * For each pair, tries cheapest 5 inputs in various splits.
 */

import pg from "pg";
import { loadDiscoveryData, getOutcomesForCollections, getNextRarity } from "../engine/data-load.js";
import { CASE_KNIFE_MAP, KNIFE_WEAPONS } from "../engine/knife-data.js";
import { evaluateTradeUp } from "../engine/evaluation.js";
import { evaluateKnifeTradeUp, buildKnifeFinishCache } from "../engine/knife-evaluation.js";
import { buildPriceCache } from "../engine/pricing.js";
import { listingSig } from "../engine/utils.js";
import { EXCLUDED_COLLECTIONS } from "../engine/types.js";
import type { ListingWithCollection } from "../engine/types.js";

interface AuditGap {
  type: "knife" | "gun";
  rarity: string;
  collections: string[];
  profitCents: number;
  roi: number;
  inputCount: number;
  sig: string;
}

interface AuditResult {
  gunGaps: AuditGap[];
  knifeGaps: AuditGap[];
  gunCollectionsAudited: number;
  gunCombosEvaluated: number;
  knifePairsAudited: number;
  knifeCombosEvaluated: number;
  durationMs: number;
}

/** Load existing trade-up signatures for a given type. */
async function loadExistingSigs(pool: pg.Pool, tradeUpType: string): Promise<Set<string>> {
  const sigs = new Set<string>();
  const { rows } = await pool.query(`
    SELECT STRING_AGG(listing_id::text, ',' ORDER BY listing_id) as ids
    FROM trade_up_inputs WHERE trade_up_id IN (
      SELECT id FROM trade_ups WHERE type = $1 AND is_theoretical = false
    ) GROUP BY trade_up_id
  `, [tradeUpType]);
  for (const row of rows) {
    sigs.add(row.ids.split(",").sort().join(","));
  }
  return sigs;
}

/**
 * Generate all combos of `count` inputs from a collection's cheapest listings.
 * Uses sliding windows over price-sorted listings for efficiency.
 */
function cheapestWindows(listings: ListingWithCollection[], count: number, maxWindows: number): ListingWithCollection[][] {
  if (listings.length < count) return [];
  const sorted = [...listings].sort((a, b) => a.price_cents - b.price_cents);
  const windows: ListingWithCollection[][] = [];
  const limit = Math.min(sorted.length - count + 1, maxWindows);
  for (let i = 0; i < limit; i++) {
    windows.push(sorted.slice(i, i + count));
  }
  return windows;
}

/**
 * Generate cross-collection combos: try splits from two collections.
 * For gun trade-ups: 10 inputs, splits 1/9 through 9/1.
 * For knife trade-ups: 5 inputs, splits 1/4 through 4/1.
 */
function crossCollectionCombos(
  listingsA: ListingWithCollection[],
  listingsB: ListingWithCollection[],
  totalInputs: number,
): ListingWithCollection[][] {
  const sortedA = [...listingsA].sort((a, b) => a.price_cents - b.price_cents);
  const sortedB = [...listingsB].sort((a, b) => a.price_cents - b.price_cents);
  const combos: ListingWithCollection[][] = [];

  for (let countA = 1; countA < totalInputs; countA++) {
    const countB = totalInputs - countA;
    if (sortedA.length < countA || sortedB.length < countB) continue;
    combos.push([...sortedA.slice(0, countA), ...sortedB.slice(0, countB)]);
  }
  return combos;
}

/**
 * Run the gun completeness audit.
 * Picks 5 random collections from a given rarity, exhaustively tries cheapest combos.
 */
async function auditGunTier(
  pool: pg.Pool,
  inputRarity: string,
  tradeUpType: string,
): Promise<{ gaps: AuditGap[]; collectionsAudited: number; combosEvaluated: number }> {
  const outputRarity = getNextRarity(inputRarity);
  if (!outputRarity) return { gaps: [], collectionsAudited: 0, combosEvaluated: 0 };

  await buildPriceCache(pool);
  const { byCollection } = await loadDiscoveryData(pool, inputRarity, "collection_id");

  const allCollectionIds = [...byCollection.keys()].filter(id => !EXCLUDED_COLLECTIONS.has(id));
  if (allCollectionIds.length === 0) return { gaps: [], collectionsAudited: 0, combosEvaluated: 0 };

  // Pick 5 random collections
  const shuffled = [...allCollectionIds].sort(() => Math.random() - 0.5);
  const sampled = shuffled.slice(0, Math.min(5, shuffled.length));

  const existingSigs = await loadExistingSigs(pool, tradeUpType);
  const gaps: AuditGap[] = [];
  let combosEvaluated = 0;

  // Single-collection: cheapest 10-input windows
  for (const colId of sampled) {
    const listings = byCollection.get(colId);
    if (!listings || listings.length < 10) continue;

    const outcomes = await getOutcomesForCollections(pool, [colId], outputRarity);
    if (outcomes.length === 0) continue;

    const windows = cheapestWindows(listings, 10, 50);
    for (const inputs of windows) {
      combosEvaluated++;
      const result = await evaluateTradeUp(pool, inputs, outcomes);
      if (!result || result.profit_cents <= 0) continue;

      const sig = listingSig(inputs.map(i => i.id));
      if (existingSigs.has(sig)) continue;

      gaps.push({
        type: "gun",
        rarity: inputRarity,
        collections: [inputs[0].collection_name],
        profitCents: result.profit_cents,
        roi: result.roi_percentage,
        inputCount: 10,
        sig,
      });
    }
  }

  // Cross-collection pairs from sampled set
  for (let i = 0; i < sampled.length; i++) {
    for (let j = i + 1; j < sampled.length; j++) {
      const listA = byCollection.get(sampled[i]);
      const listB = byCollection.get(sampled[j]);
      if (!listA || !listB) continue;

      const outcomes = await getOutcomesForCollections(pool, [sampled[i], sampled[j]], outputRarity);
      if (outcomes.length === 0) continue;

      const combos = crossCollectionCombos(listA, listB, 10);
      for (const inputs of combos) {
        combosEvaluated++;
        const result = await evaluateTradeUp(pool, inputs, outcomes);
        if (!result || result.profit_cents <= 0) continue;

        const sig = listingSig(inputs.map(i => i.id));
        if (existingSigs.has(sig)) continue;

        gaps.push({
          type: "gun",
          rarity: inputRarity,
          collections: [...new Set(inputs.map(i => i.collection_name))],
          profitCents: result.profit_cents,
          roi: result.roi_percentage,
          inputCount: 10,
          sig,
        });
      }
    }
  }

  return { gaps, collectionsAudited: sampled.length, combosEvaluated };
}

/**
 * Run the knife completeness audit.
 * Tries ALL knife-eligible collection pairs (only ~43 collections → ~903 pairs).
 */
async function auditKnives(
  pool: pg.Pool,
): Promise<{ gaps: AuditGap[]; pairsAudited: number; combosEvaluated: number }> {
  await buildPriceCache(pool);
  const { byCollection } = await loadDiscoveryData(pool, "Covert", "collection_name", { excludeWeapons: KNIFE_WEAPONS });
  const knifeFinishCache = await buildKnifeFinishCache(pool);

  const knifeCollections = [...byCollection.keys()].filter(name => {
    const m = CASE_KNIFE_MAP[name];
    return m && (m.knifeTypes.length > 0 || m.gloveGen !== null);
  });

  const existingSigs = await loadExistingSigs(pool, "covert_knife");
  const gaps: AuditGap[] = [];
  let pairsAudited = 0;
  let combosEvaluated = 0;

  // Single-collection: cheapest 5 windows
  for (const col of knifeCollections) {
    const listings = byCollection.get(col);
    if (!listings || listings.length < 5) continue;

    const windows = cheapestWindows(listings, 5, 20);
    for (const inputs of windows) {
      combosEvaluated++;
      const result = await evaluateKnifeTradeUp(pool, inputs, knifeFinishCache);
      if (!result || result.profit_cents <= 0) continue;

      const sig = listingSig(inputs.map(i => i.id));
      if (existingSigs.has(sig)) continue;

      gaps.push({
        type: "knife",
        rarity: "Covert",
        collections: [col],
        profitCents: result.profit_cents,
        roi: result.roi_percentage,
        inputCount: 5,
        sig,
      });
    }
  }

  // All pairs
  for (let i = 0; i < knifeCollections.length; i++) {
    for (let j = i + 1; j < knifeCollections.length; j++) {
      pairsAudited++;
      const colA = knifeCollections[i];
      const colB = knifeCollections[j];
      const listA = byCollection.get(colA);
      const listB = byCollection.get(colB);
      if (!listA || !listB) continue;

      const combos = crossCollectionCombos(listA, listB, 5);
      for (const inputs of combos) {
        combosEvaluated++;
        const result = await evaluateKnifeTradeUp(pool, inputs, knifeFinishCache);
        if (!result || result.profit_cents <= 0) continue;

        const sig = listingSig(inputs.map(i => i.id));
        if (existingSigs.has(sig)) continue;

        gaps.push({
          type: "knife",
          rarity: "Covert",
          collections: [colA, colB],
          profitCents: result.profit_cents,
          roi: result.roi_percentage,
          inputCount: 5,
          sig,
        });
      }
    }
  }

  return { gaps, pairsAudited, combosEvaluated };
}

/**
 * Run a full completeness audit across all tiers.
 * Should be called every 10th cycle.
 */
export async function runCompletenessAudit(pool: pg.Pool): Promise<AuditResult> {
  const t0 = Date.now();

  // Gun tiers: audit classified (most valuable) with 5 random collections
  const classifiedAudit = await auditGunTier(pool, "Classified", "classified_covert");

  // Knife audit: all pairs
  const knifeAudit = await auditKnives(pool);

  return {
    gunGaps: classifiedAudit.gaps,
    knifeGaps: knifeAudit.gaps,
    gunCollectionsAudited: classifiedAudit.collectionsAudited,
    gunCombosEvaluated: classifiedAudit.combosEvaluated,
    knifePairsAudited: knifeAudit.pairsAudited,
    knifeCombosEvaluated: knifeAudit.combosEvaluated,
    durationMs: Date.now() - t0,
  };
}

/** Log audit results to console. */
export function logAuditResult(result: AuditResult): void {
  const totalGaps = result.gunGaps.length + result.knifeGaps.length;
  console.log(`  completeness audit: ${totalGaps} gaps found (${(result.durationMs / 1000).toFixed(1)}s)`);
  console.log(`    Gun: ${result.gunCollectionsAudited} collections, ${result.gunCombosEvaluated} combos → ${result.gunGaps.length} gaps`);
  console.log(`  knife audit: ${result.knifePairsAudited} pairs, ${result.knifeCombosEvaluated} combos → ${result.knifeGaps.length} gaps`);

  // Log top gaps
  const allGaps = [...result.gunGaps, ...result.knifeGaps].sort((a, b) => b.profitCents - a.profitCents);
  for (const gap of allGaps.slice(0, 10)) {
    console.log(`    GAP: ${gap.type} ${gap.rarity} $${(gap.profitCents / 100).toFixed(2)} profit (${gap.roi.toFixed(0)}% ROI) | ${gap.collections.join(" + ")}`);
  }
}
