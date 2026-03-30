// Condition-level output pricing with multi-source cache.

import pg from "pg";
import { floatToCondition } from "../../shared/types.js";
import { CONDITION_BOUNDS, type PriceAnchor, type FallbackParams, type FallbackResult } from "./types.js";
import { MARKETPLACE_FEES, effectiveSellProceeds } from "./fees.js";
import { knnOutputPriceAtFloat, computeConditionConfidence, getKnnConditionObsCount } from "./knn-pricing.js";
import { buildCurveCache } from "./curve-classification.js";
import { buildConditionMultipliers, conditionMultiplierCache } from "./condition-multipliers.js";

// KNN same-condition obs below this threshold → treat as sparse, apply tighter cap
const SPARSE_CONDITION_OBS_THRESHOLD = 10;

const CONDITION_MIDPOINTS = CONDITION_BOUNDS.map(b => ({
  name: b.name,
  mid: (b.min + b.max) / 2,
}));

export const priceCache = new Map<string, number>();
export const priceSources = new Map<string, string>(); // key → source label
export let priceCacheBuilt = false;

// Per-source listing floor caches (for per-marketplace output pricing)
export const dmarketFloorCache = new Map<string, number>(); // skinName:condition → lowest DMarket listing
export const skinportFloorCache = new Map<string, number>(); // skinName:condition → lowest Skinport listing
// Cache for getConditionPrices results — avoids repeated DB queries for knife phase names
const conditionPricesCache = new Map<string, PriceAnchor[]>();
let priceCacheBuiltAt = 0;
const PRICE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Module-level ref price map shared between loadCsfloatRefPrices and overrideWithListingFloors/fillKnifeLastResort.
// Exported so data-load.ts can filter outlier input listings before discovery.
export let refPriceCache = new Map<string, number>();
// Skinport median cache for listing floor sanity cap (skinName:condition → median cents)
// Exported so data-load.ts can use it to cap the outlier-filter reference price.
export let skinportMedianCache = new Map<string, number>();

/** Step 1: Load CSFloat ref prices (conservative condition-level averages, high volume).
 *  Sales are skewed by low-float premiums within a condition (FT 0.15 = $11 vs FT 0.32 = $6).
 *  Ref is the better estimate for "average price at this condition". */
async function loadCsfloatRefPrices(pool: pg.Pool): Promise<{ cached: number; totalRows: number }> {
  let cached = 0;
  const { rows } = await pool.query(`
    SELECT skin_name, condition, min_price_cents, median_price_cents, volume
    FROM price_data WHERE source = 'csfloat_ref' AND volume >= 3
  `);
  for (const row of rows) {
    const price = row.median_price_cents > 0 ? row.median_price_cents : row.min_price_cents;
    if (price > 0) {
      const k = `${row.skin_name}:${row.condition}`;
      priceCache.set(k, price);
      priceSources.set(k, `csfloat_ref (${row.volume} vol)`);
      cached++;
    }
  }
  return { cached, totalRows: rows.length };
}

/** Step 1b: CSFloat sales fill gaps where ref doesn't exist. */
async function fillCsfloatSalesGaps(pool: pg.Pool): Promise<number> {
  let count = 0;
  const { rows } = await pool.query(`
    SELECT skin_name, condition, median_price_cents, volume
    FROM price_data WHERE source = 'csfloat_sales'
  `);
  for (const row of rows) {
    if (row.median_price_cents > 0 && row.volume >= 2) {
      const k = `${row.skin_name}:${row.condition}`;
      if (!priceCache.has(k)) {
        priceCache.set(k, row.median_price_cents);
        priceSources.set(k, `csfloat_sales (${row.volume} sales)`);
        count++;
      }
    }
  }
  return count;
}

/** Step 1c: Override with listing floors where lower, fill Covert gaps from listings.
 *  Builds per-condition reference price map for outlier detection, shared with fillKnifeLastResort. */
async function overrideWithListingFloors(pool: pg.Pool): Promise<{ overrides: number; fills: number }> {
  let overrides = 0;
  let fills = 0;

  // Build per-condition reference price from price_data to detect outlier listings.
  // Per-condition avoids filtering out legitimate FN premiums (e.g., Wild Lotus FN=$17k vs BS=$150).
  // CSFloat sales/ref first (most reliable), then Skinport median to fill gaps —
  // many skins only have CSFloat data for FN, leaving BS/WW/FT without a reference.
  refPriceCache = new Map<string, number>();
  const { rows: refRows } = await pool.query(`
    SELECT skin_name, condition, MIN(CASE WHEN min_price_cents > 0 THEN min_price_cents ELSE median_price_cents END) as ref
    FROM price_data WHERE (min_price_cents > 0 OR median_price_cents > 0)
      AND source IN ('csfloat_sales', 'csfloat_ref')
    GROUP BY skin_name, condition
  `);
  for (const r of refRows) if (r.ref > 0) refPriceCache.set(`${r.skin_name}:${r.condition}`, r.ref);

  // Fill gaps with Skinport median (broader condition coverage than CSFloat)
  const { rows: spRows } = await pool.query(`
    SELECT skin_name, condition, median_price_cents as ref
    FROM price_data WHERE median_price_cents > 0 AND source = 'skinport'
  `);
  skinportMedianCache.clear();
  let spFills = 0;
  for (const r of spRows) {
    const key = `${r.skin_name}:${r.condition}`;
    if (r.ref > 0) skinportMedianCache.set(key, r.ref);
    if (!refPriceCache.has(key) && r.ref > 0) {
      refPriceCache.set(key, r.ref);
      spFills++;
    }
  }
  if (spFills > 0) console.log(`  Ref price map: ${refRows.length} from CSFloat, ${spFills} gaps filled from Skinport`);

  // Final fallback: derive median from Buff listings for skins still missing a ref price.
  // Cheap skins (e.g. Desert Eagle | Mudder FT ~$0.03) may have no CSFloat sales/ref or
  // Skinport data, so refPriceCache is empty for them. Without a ref, the 20x outlier
  // guard in data-load.ts passes all listings through — including $400 sticker-premiums.
  // Buff has near-complete coverage and its listings are bulk market prices, not sticker picks.
  const { rows: buffRows } = await pool.query(`
    SELECT s.name as skin_name,
      CASE
        WHEN l.float_value < 0.07 THEN 'Factory New'
        WHEN l.float_value < 0.15 THEN 'Minimal Wear'
        WHEN l.float_value < 0.38 THEN 'Field-Tested'
        WHEN l.float_value < 0.45 THEN 'Well-Worn'
        ELSE 'Battle-Scarred'
      END as condition,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY l.price_cents) as median
    FROM listings l JOIN skins s ON l.skin_id = s.id
    WHERE l.source = 'buff' AND l.price_cents > 0
    GROUP BY s.name, condition
  `);
  let buffFills = 0;
  for (const r of buffRows) {
    const key = `${r.skin_name}:${r.condition}`;
    if (!refPriceCache.has(key) && r.median > 0) {
      refPriceCache.set(key, Math.round(r.median));
      buffFills++;
    }
  }
  if (buffFills > 0) console.log(`  Ref price map: ${buffFills} gaps filled from Buff listings median`);

  for (const cond of CONDITION_BOUNDS) {
    const { rows } = await pool.query(`
      SELECT s.name, s.rarity, MIN(l.price_cents) as lowest_price, COUNT(*) as cnt
      FROM listings l JOIN skins s ON l.skin_id = s.id
      WHERE l.float_value >= $1 AND l.float_value < $2
        AND l.source = 'csfloat'
        AND (l.listing_type = 'buy_now' OR l.listing_type IS NULL)
      GROUP BY s.name, s.rarity
    `, [cond.min, cond.max]);

    for (const row of rows) {
      if (row.lowest_price <= 0) continue;
      // Filter out outlier listings: >5x the per-condition reference price
      const ref = refPriceCache.get(`${row.name}:${cond.name}`);
      if (ref && row.lowest_price > ref * 5) continue;

      const key = `${row.name}:${cond.name}`;
      const existing = priceCache.get(key);

      if (existing !== undefined) {
        // Override only if listing is LOWER (more conservative for output pricing)
        if (row.lowest_price < existing) {
          priceCache.set(key, row.lowest_price);
          priceSources.set(key, `listing floor (${row.cnt} listings, lower than ${priceSources.get(key)})`);
          overrides++;
        }
      } else if (row.rarity === "Covert" && parseInt(row.cnt, 10) >= 3) {
        // For Covert inputs with decent listing depth: fill from listings
        priceCache.set(key, row.lowest_price);
        priceSources.set(key, `listing floor (${row.cnt} listings)`);
        fills++;
      }
      // For Extraordinary (knives/gloves): don't fill from listings alone —
      // let ref/steam/skinport prices fill first (listings can be inflated by rare patterns)
    }
  }
  return { overrides, fills };
}

/** Step 3: Fill remaining gaps from listings (last resort for knives/gloves). */
async function fillKnifeLastResort(pool: pg.Pool): Promise<{ lastResort: number; overrides: number }> {
  let lastResort = 0;
  let overrides = 0;
  for (const cond of CONDITION_BOUNDS) {
    const { rows } = await pool.query(`
      SELECT s.name, MIN(l.price_cents) as lowest_price
      FROM listings l JOIN skins s ON l.skin_id = s.id
      WHERE l.float_value >= $1 AND l.float_value < $2
        AND l.source = 'csfloat'
        AND s.rarity = 'Extraordinary'
        AND (l.listing_type = 'buy_now' OR l.listing_type IS NULL)
      GROUP BY s.name
    `, [cond.min, cond.max]);

    for (const row of rows) {
      if (row.lowest_price <= 0) continue;
      const ref = refPriceCache.get(`${row.name}:${cond.name}`);
      if (ref && row.lowest_price > ref * 5) continue;

      const key = `${row.name}:${cond.name}`;
      const existing = priceCache.get(key);
      if (existing === undefined) {
        priceCache.set(key, row.lowest_price);
        priceSources.set(key, `knife listing floor`);
        lastResort++;
      } else if (row.lowest_price < existing) {
        priceCache.set(key, row.lowest_price);
        priceSources.set(key, `knife listing floor (lower than ${priceSources.get(key)})`);
        overrides++;
      }
    }
  }
  return { lastResort, overrides };
}

/** Step 4: Condition extrapolation for ★ items — fill missing conditions from adjacent known ones.
 *  Uses conservative ratios: 0.85x stepping down (worse condition), 1.15x stepping up. */
function extrapolateKnifeConditions(): number {
  let knifeExtrapolated = 0;
  const condOrder = CONDITION_BOUNDS.map(c => c.name);
  const STEP_DOWN = 0.85; // conservative discount for worse condition
  const STEP_UP = 1.15;   // conservative FN premium over MW (real premiums often 2-10x)

  // Collect all ★ skin names that have at least one cached price
  const knifeSkins = new Set<string>();
  for (const key of priceCache.keys()) {
    if (key.startsWith("★") && !key.includes("StatTrak")) {
      knifeSkins.add(key.split(":")[0]);
    }
  }

  for (const skinName of knifeSkins) {
    // Find which conditions we already have
    const existing = new Map<number, number>(); // condIndex → price
    for (let i = 0; i < condOrder.length; i++) {
      const p = priceCache.get(`${skinName}:${condOrder[i]}`);
      if (p !== undefined && p > 0) existing.set(i, p);
    }
    if (existing.size === 0 || existing.size === condOrder.length) continue;

    // Extrapolate outward from each known condition (single-hop only to limit error)
    for (const [idx, price] of existing) {
      // Extrapolate one step worse (higher float)
      if (idx < condOrder.length - 1 && !existing.has(idx + 1)) {
        const key = `${skinName}:${condOrder[idx + 1]}`;
        if (!priceCache.has(key)) {
          const extPrice = Math.round(price * STEP_DOWN);
          priceCache.set(key, extPrice);
          priceSources.set(key, `extrapolated from ${condOrder[idx]}`);
          knifeExtrapolated++;
        }
      }
      // Extrapolate one step better (lower float)
      if (idx > 0 && !existing.has(idx - 1)) {
        const key = `${skinName}:${condOrder[idx - 1]}`;
        if (!priceCache.has(key)) {
          const extPrice = Math.round(price * STEP_UP);
          priceCache.set(key, extPrice);
          priceSources.set(key, `extrapolated from ${condOrder[idx]}`);
          knifeExtrapolated++;
        }
      }
    }
  }
  return knifeExtrapolated;
}

/** Rebuild price cache. Skips if already built within TTL unless force=true. */
export async function buildPriceCache(pool: pg.Pool, force = false) {
  if (!force && priceCacheBuilt && Date.now() - priceCacheBuiltAt < PRICE_CACHE_TTL_MS) {
    return; // Cache is fresh, skip rebuild
  }
  priceCache.clear();
  priceSources.clear();
  dmarketFloorCache.clear();
  skinportFloorCache.clear();
  skinportMedianCache.clear();
  conditionPricesCache.clear();
  _floatCeilingCache.clear();
  _floatCeilingCacheBuiltAt = 0;

  const { cached: refCached, totalRows: csfloatRefCount } = await loadCsfloatRefPrices(pool);
  const salesGapFills = await fillCsfloatSalesGaps(pool);
  const salesCount = refCached + salesGapFills;
  const { overrides: listingOverrides1, fills: listingFills } = await overrideWithListingFloors(pool);
  const { lastResort: listingLastResort, overrides: listingOverrides2 } = await fillKnifeLastResort(pool);
  const listingOverrides = listingOverrides1 + listingOverrides2;
  const knifeExtrapolated = extrapolateKnifeConditions();
  await buildSourceFloorCaches(pool);

  const curveCount = await buildCurveCache(pool);
  await buildConditionMultipliers(pool);

  priceCacheBuilt = true;
  priceCacheBuiltAt = Date.now();
  console.log(`  Price cache: ${salesCount} sales, ${listingOverrides} listing overrides (lower), ${listingFills} listing fills, ${listingLastResort} knife listing fills, ${csfloatRefCount} ref, 0 steam, 0 skinport, ${knifeExtrapolated} knife extrapolated = ${priceCache.size} total (DM floors: ${dmarketFloorCache.size}, SP floors: ${skinportFloorCache.size}, curves: ${curveCount})`);
}

async function buildSourceFloorCaches(pool: pg.Pool) {
  dmarketFloorCache.clear();
  skinportFloorCache.clear();

  for (const source of ["dmarket", "skinport"] as const) {
    const cache = source === "dmarket" ? dmarketFloorCache : skinportFloorCache;
    for (const cond of CONDITION_BOUNDS) {
      // Require 2+ listings for floor price — single listings are unreliable
      // (collector prices, mispriced items, etc.)
      const { rows } = await pool.query(`
        SELECT s.name, MIN(l.price_cents) as lowest_price, COUNT(*) as cnt
        FROM listings l JOIN skins s ON l.skin_id = s.id
        WHERE l.float_value >= $1 AND l.float_value < $2
          AND l.source = $3
          AND (l.listing_type = 'buy_now' OR l.listing_type IS NULL)
        GROUP BY s.name
        HAVING COUNT(*) >= 2
      `, [cond.min, cond.max, source]);

      for (const row of rows) {
        if (row.lowest_price <= 0) continue;
        cache.set(`${row.name}:${cond.name}`, row.lowest_price);
      }
    }
  }
}

export function lookupPrice(
  pool: pg.Pool,
  skinName: string,
  predictedFloat: number
): number {
  const condition = floatToCondition(predictedFloat);
  const cached = priceCache.get(`${skinName}:${condition}`);
  if (cached !== undefined && cached > 0) return cached;

  // No interpolation between conditions — FN premiums make linear interpolation wildly wrong.
  // If we don't have CSFloat data for this exact condition, return 0 (unpriced).
  // The price cache already has CSFloat sales + ref + listing floors per condition.
  return 0;
}

export interface OutputPriceResult {
  priceCents: number;      // net proceeds after seller fee
  marketplace: string;     // 'csfloat' | 'dmarket' | 'skinport'
  grossPrice: number;      // price before fee
  feePct: number;          // seller fee percentage
}

// Float-monotonicity ceiling: per-skin sorted arrays of (float, price) from all data sources
const _floatCeilingCache = new Map<string, { float: number; price: number }[]>();
let _floatCeilingCacheBuiltAt = 0;
const FLOAT_CEILING_CACHE_TTL_MS = 5 * 60 * 1000;

async function ensureFloatCeilingCache(pool: pg.Pool): Promise<void> {
  if (_floatCeilingCache.size > 0 && Date.now() - _floatCeilingCacheBuiltAt < FLOAT_CEILING_CACHE_TTL_MS) return;
  _floatCeilingCache.clear();

  // Listings-only ceiling: active market offers represent current reality.
  // Historical sales excluded — they introduce noise from below-market transactions
  // and Skinport fee differentials. KNN already handles sale history for estimation.
  const { rows } = await pool.query(`
    SELECT skin_name, float_value, price_cents, source FROM (
      -- Active CSFloat listings
      SELECT s.name as skin_name, l.float_value, l.price_cents, 'csfloat' as source
      FROM listings l JOIN skins s ON l.skin_id = s.id
      WHERE (l.source = 'csfloat' OR l.source IS NULL) AND l.stattrak = false
        AND l.float_value > 0 AND l.price_cents > 0
        AND (l.listing_type = 'buy_now' OR l.listing_type IS NULL)
      UNION ALL
      -- Active DMarket listings (normalized with 2.5% buyer fee)
      SELECT s.name, l.float_value, CAST(ROUND(l.price_cents * 1.025) AS INTEGER), 'dmarket'
      FROM listings l JOIN skins s ON l.skin_id = s.id
      WHERE l.source = 'dmarket' AND l.stattrak = false
        AND l.float_value > 0 AND l.price_cents > 0
      UNION ALL
      -- Active Buff listings (no buyer fee)
      SELECT s.name, l.float_value, l.price_cents, 'buff'
      FROM listings l JOIN skins s ON l.skin_id = s.id
      WHERE l.source = 'buff' AND l.stattrak = false
        AND l.float_value > 0 AND l.price_cents > 0
    ) combined
    ORDER BY skin_name, float_value
  `);

  let buffFiltered = 0;
  let dmarketFiltered = 0;
  for (const row of rows) {
    // Filter outlier listings from Buff and DMarket: sticker/pattern premiums
    // can be 10-100x market price. CSFloat listings are trusted (verified buy-now).
    // Use refPriceCache (built by overrideWithListingFloors, includes Skinport fallback).
    // Same filter applied to CSFloat input listings in data-load.ts.
    if (row.source === 'buff' || row.source === 'dmarket') {
      const condition = floatToCondition(row.float_value);
      const ref = refPriceCache.get(`${row.skin_name}:${condition}`);
      if (row.source === 'buff') {
        // Buff: filter if no ref OR >5x ref (conservative — Buff has many sticker premiums)
        if (!ref || row.price_cents > ref * 5) {
          buffFiltered++;
          continue;
        }
      } else {
        // DMarket: filter only if >5x ref (DMarket data is generally reliable,
        // but pattern premiums still exist). Don't filter when no ref — DMarket
        // is a primary data source.
        if (ref && row.price_cents > ref * 5) {
          dmarketFiltered++;
          continue;
        }
      }
    }
    let arr = _floatCeilingCache.get(row.skin_name);
    if (!arr) { arr = []; _floatCeilingCache.set(row.skin_name, arr); }
    arr.push({ float: row.float_value, price: row.price_cents });
  }
  if (buffFiltered > 0 || dmarketFiltered > 0) console.log(`  Float ceiling cache: filtered ${buffFiltered} Buff + ${dmarketFiltered} DMarket outlier listings (>5x ref)`);
  _floatCeilingCacheBuiltAt = Date.now();
}

/**
 * Float-monotonicity ceiling: cap output price at the bottom-3 average of
 * nearby data points at equal-or-lower floats WITHIN THE SAME CONDITION.
 *
 * Only considers data within 0.05 float distance below the predicted float,
 * and never crosses condition boundaries (FN/MW/FT/WW/BS are different markets).
 *
 * Returns null if insufficient data to establish a ceiling.
 */
const CEILING_MAX_FLOAT_DIST = 0.05;
const CONDITION_BOUNDARIES = [0.07, 0.15, 0.38, 0.45]; // FN|MW|FT|WW|BS

function conditionFloor(float: number): number {
  // Returns the lower bound of the current condition range
  for (let i = CONDITION_BOUNDARIES.length - 1; i >= 0; i--) {
    if (float >= CONDITION_BOUNDARIES[i]) return CONDITION_BOUNDARIES[i];
  }
  return 0; // Factory New starts at 0
}

async function getFloatCeiling(
  pool: pg.Pool,
  skinName: string,
  predictedFloat: number
): Promise<number | null> {
  await ensureFloatCeilingCache(pool);
  const data = _floatCeilingCache.get(skinName);
  if (!data || data.length < 3) return null;

  const condFloor = conditionFloor(predictedFloat);

  // Find data points within CEILING_MAX_FLOAT_DIST below the predicted float,
  // but never crossing condition boundaries
  const nearbyLower = data.filter(d =>
    d.float <= predictedFloat &&
    d.float >= condFloor &&
    (predictedFloat - d.float) <= CEILING_MAX_FLOAT_DIST
  );
  if (nearbyLower.length < 5) return null;

  // Sort by price ascending
  const sorted = nearbyLower.map(d => d.price).sort((a, b) => a - b);
  const n = Math.min(5, sorted.length);
  const bottom5Avg = Math.round(sorted.slice(0, n).reduce((s, p) => s + p, 0) / n);

  // Also consider the cheapest single listing — if one listing at a better float
  // is cheaper than our estimate, our worse-float output can't be worth more.
  // Takes min(cheapest, bottom5Avg) for a conservative, correct ceiling.
  return Math.min(sorted[0], bottom5Avg);
}

/**
 * Listing floor: bottom-3 average of nearby listings at similar floats within
 * the same condition. Used as a price estimate when KNN has no sale data.
 * Requires 3+ listings (lower threshold than ceiling since this is a fallback).
 */
async function getListingFloor(
  pool: pg.Pool,
  skinName: string,
  predictedFloat: number
): Promise<number | null> {
  await ensureFloatCeilingCache(pool);
  const data = _floatCeilingCache.get(skinName);
  if (!data || data.length < 3) return null;

  const condFloor = conditionFloor(predictedFloat);
  const condCeiling = CONDITION_BOUNDARIES.find(b => b > condFloor) ?? 1.0;

  // Find all listings within the same condition, within ±0.05 float
  const nearby = data.filter(d =>
    d.float >= condFloor &&
    d.float < condCeiling &&
    Math.abs(d.float - predictedFloat) <= 0.05
  );
  if (nearby.length < 3) return null;

  const sorted = nearby.map(d => d.price).sort((a, b) => a - b);
  const n = Math.min(3, sorted.length);
  const bottom3Avg = Math.round(sorted.slice(0, n).reduce((s, p) => s + p, 0) / n);

  // Skinport median sanity cap: catch inflated floors when outlier listings
  // slip through (e.g. no refPriceCache for BS/WW → >5x filter can't exclude them)
  const condition = floatToCondition(predictedFloat);
  const spMedianForFloor = skinportMedianCache.get(`${skinName}:${condition}`) ?? 0;
  const refForFloor = refPriceCache.get(`${skinName}:${condition}`) ?? 0;
  const floorCapRef = spMedianForFloor > 0 ? spMedianForFloor : refForFloor > 0 ? refForFloor : 0;
  if (floorCapRef > 0 && bottom3Avg > floorCapRef * 3) return floorCapRef;

  return bottom3Avg;
}

/**
 * Cross-condition monotonicity guard: clamp grossPrice if it exceeds
 * the next better condition's price. BS should never cost more than WW, etc.
 * Returns the clamped price, or grossPrice unchanged if no clamping needed.
 */
export function applyMonotonicityGuard(
  grossPrice: number,
  skinName: string,
  predictedFloat: number
): number {
  const condition = floatToCondition(predictedFloat);
  const condIdx = CONDITION_BOUNDS.findIndex(c => c.name === condition);
  if (condIdx <= 0) return grossPrice; // FN or not found — no better condition

  // Walk up the condition chain to find the nearest priced better condition.
  // WW with no FT price should still clamp against MW or FN.
  for (let i = condIdx - 1; i >= 0; i--) {
    const betterPrice = priceCache.get(`${skinName}:${CONDITION_BOUNDS[i].name}`);
    if (betterPrice && betterPrice > 0) {
      if (grossPrice > betterPrice) return betterPrice;
      break; // found a priced better condition, no need to check further
    }
  }
  return grossPrice;
}

/**
 * Estimate target-condition price from an adjacent condition price.
 * Uses priceCache + conditionMultiplierCache (both loaded at cache build time).
 * Returns null if no adjacent condition has both a cached price and a multiplier.
 */
export function computeCrossConditionEstimate(skinName: string, predictedFloat: number): number | null {
  const targetCond = floatToCondition(predictedFloat);
  const targetIdx = CONDITION_BOUNDS.findIndex(c => c.name === targetCond);
  if (targetIdx < 0) return null;

  // Try adjacent conditions: closest first (±1), then ±2
  const order = [targetIdx + 1, targetIdx - 1, targetIdx + 2, targetIdx - 2]
    .filter(i => i >= 0 && i < CONDITION_BOUNDS.length);

  for (const adjIdx of order) {
    const adjCond = CONDITION_BOUNDS[adjIdx].name;
    const adjPrice = priceCache.get(`${skinName}:${adjCond}`) ?? 0;
    if (adjPrice <= 0) continue;
    const multiplier = conditionMultiplierCache.get(`${adjCond}→${targetCond}`);
    if (!multiplier) continue;
    return Math.round(adjPrice * multiplier);
  }
  return null;
}

/**
 * Pure pricing resolver — no DB calls.
 * All async lookups (KNN, ref, floor, ceiling) are pre-computed by the caller.
 *
 * NOTE: Calls applyMonotonicityGuard which reads the priceCache module global.
 * Populate priceCache before calling in tests.
 */
export function resolvePriceWithFallbacks(params: FallbackParams): FallbackResult {
  const {
    knn, refPrice, listingFloor, spMedian, floatCeiling,
    crossConditionEstimate, skinName, predictedFloat, isStarSkin,
  } = params;

  let grossPrice = 0;
  let source = "none";
  let conditionConfidence = 1.0;

  // Continuous confidence scoring for ★ skins
  if (isStarSkin && knn !== null) {
    conditionConfidence = computeConditionConfidence(knn);
  }
  const knnUsable = knn !== null
    && knn.confidence >= 0.3
    && (!isStarSkin || conditionConfidence >= 0.1);

  if (knnUsable && knn !== null) {
    grossPrice = knn.priceCents;
    source = "knn";

    // Obs-count cap against ref price
    if (refPrice > 0) {
      const maxMultiplier = knn.observationCount <= 3 ? 2.0
        : knn.observationCount <= 5 ? 3.0
        : 5.0;
      if (grossPrice > refPrice * maxMultiplier) {
        grossPrice = refPrice;
        source = "knn (ref-capped)";
      }
    }

    // Sparse-condition cap: if same-condition obs < 10 and no CSFloat ref for this
    // condition, KNN Tier 2 extrapolation can produce prices far above market reality
    // (e.g. Nova | Ocular BS: 4 obs → $3.68 vs $0.60–1.94 actual). Cap to Skinport
    // median (1×) — cheap skins with sparse BS data don't command float premiums.
    if (knn.conditionObsCount < SPARSE_CONDITION_OBS_THRESHOLD && refPrice === 0 && spMedian != null && spMedian > 0 && grossPrice > spMedian) {
      grossPrice = spMedian;
      source = "knn (sparse-capped)";
    }

    const initialCapRef = spMedian != null && spMedian > 0 ? spMedian
                        : refPrice > 0 ? refPrice : 0;
    if (initialCapRef > 0 && grossPrice > initialCapRef * 3) {
      grossPrice = initialCapRef;
      source = "knn (sp-capped)";
    }

    // Confidence-weighted attractor blend for ★ sparse skins
    if (isStarSkin && conditionConfidence < 1.0) {
      const attractor =
        spMedian != null && spMedian > 0 ? spMedian :
        refPrice > 0 ? refPrice :
        listingFloor != null && listingFloor > 0 ? listingFloor :
        null;
      if (attractor !== null) {
        grossPrice = Math.round(conditionConfidence * grossPrice + (1 - conditionConfidence) * attractor);
        source = `knn-blend(conf=${conditionConfidence.toFixed(2)})`;
      }
    }
  } else {
    // Cross-condition extrapolation for ★ zero-obs skins
    if (crossConditionEstimate != null && crossConditionEstimate > 0 && isStarSkin) {
      grossPrice = crossConditionEstimate;
      source = "cross-condition";
    } else if (listingFloor != null && listingFloor > 0 && refPrice > 0) {
      grossPrice = Math.min(refPrice, listingFloor);
      source = "min(ref, floor)";
    } else if (listingFloor != null && listingFloor > 0) {
      // ★ skins: skip Skinport-median cap. Skinport prices run 10-20% below CSFloat
      // for knives/gloves, so capping a CSFloat listing floor at Skinport median
      // under-values knife outputs in the no-KNN/no-refPrice fallback path.
      // getListingFloor already rejects 3× outliers internally, so extreme sticker
      // premiums are already filtered before we get here.
      const capBounds = resolveOutputCapBounds(skinName, floatToCondition(predictedFloat), { skipSkinport: isStarSkin });
      if (capBounds && listingFloor > capBounds.knnCap) {
        grossPrice = capBounds.knnCap;
        source = "cap-bounded (listing floor)";
      } else {
        grossPrice = listingFloor;
        source = "listing floor";
      }
    } else if (refPrice > 0) {
      grossPrice = refPrice;
      source = "ref";
    }
  }

  if (grossPrice <= 0) return { grossPrice: 0, source: "none", conditionConfidence };

  grossPrice = applyMonotonicityGuard(grossPrice, skinName, predictedFloat);

  if (floatCeiling !== null && floatCeiling < grossPrice) {
    grossPrice = floatCeiling;
    source = `${source} (ceiling)`;
  }

  const hardCapRef = spMedian != null && spMedian > 0 ? spMedian
                   : refPrice > 0 ? refPrice : 0;
  if (hardCapRef > 0 && grossPrice > hardCapRef * 3) {
    grossPrice = Math.round(hardCapRef * 3);
    source = `${source} (hard-capped)`;
  }

  return { grossPrice, source, conditionConfidence };
}

/**
 * Resolves price cap bounds for output pricing, ensuring KNN is never uncapped.
 * Priority: Skinport median → CSFloat ref median (priceCache) → 5x cheapest obs (refPriceCache).
 * Returns null only when no market reference exists for this skin+condition (genuinely unpriced).
 *
 * Fixes #49: `skinportMedianCache` silently skips when Skinport has no data for a condition,
 * allowing KNN to extrapolate unchecked (e.g. Sawed-Off Serenity BS: $34.79 vs actual $2.89).
 *
 * opts.skipSkinport: skip the Skinport-median branch (used for ★ skins where Skinport prices
 * run 10-20% below CSFloat market rates, making the SP cap too conservative for knife outputs).
 */
export function resolveOutputCapBounds(
  skinName: string,
  condition: string,
  opts?: { skipSkinport?: boolean }
): { trigger: number; knnCap: number; hardCap: number } | null {
  if (!opts?.skipSkinport) {
    const sp = skinportMedianCache.get(`${skinName}:${condition}`);
    if (sp && sp > 0) return { trigger: sp * 3, knnCap: sp, hardCap: sp * 3 };
  }

  const cf = priceCache.get(`${skinName}:${condition}`);
  if (cf && cf > 0) return { trigger: cf * 3, knnCap: cf, hardCap: cf * 3 };

  const cheapest = refPriceCache.get(`${skinName}:${condition}`);
  if (cheapest && cheapest > 0) {
    const cap = cheapest * 5;
    return { trigger: cap, knnCap: cap, hardCap: cap };
  }

  return null;
}

/**
 * Look up best output price across all marketplaces.
 * Architecture: KNN-primary for all skins → condition-level fallback → float ceiling guard rail.
 * Vanilla knives (no finish): listing floor / recent sale floor.
 */
export async function lookupOutputPrice(
  pool: pg.Pool,
  skinName: string,
  predictedFloat: number
): Promise<OutputPriceResult> {
  const zeroResult: OutputPriceResult = { priceCents: 0, marketplace: "csfloat", grossPrice: 0, feePct: MARKETPLACE_FEES.csfloat.sellerFee };

  // Vanilla knives: no finish, no condition — use listing/sale floor
  const isVanilla = skinName.startsWith("★") && !skinName.includes(" | ");
  if (isVanilla) {
    const vanillaPrice = await getVanillaKnifePrice(pool, skinName);
    if (vanillaPrice <= 0) return zeroResult;
    const netPrice = effectiveSellProceeds(vanillaPrice, "csfloat");
    return { priceCents: netPrice, marketplace: "csfloat", grossPrice: vanillaPrice, feePct: MARKETPLACE_FEES.csfloat.sellerFee };
  }

  const isStarSkin = skinName.startsWith("★");
  const knn = await knnOutputPriceAtFloat(pool, skinName, predictedFloat);
  const refPrice = lookupPrice(pool, skinName, predictedFloat);
  const listingFloor = await getListingFloor(pool, skinName, predictedFloat);
  const floatCeiling = await getFloatCeiling(pool, skinName, predictedFloat);
  const spCondition = floatToCondition(predictedFloat);
  const spMedian = skinportMedianCache.get(`${skinName}:${spCondition}`) ?? null;

  let crossConditionEstimate: number | null = null;
  if (isStarSkin) {
    const knnCondObs = await getKnnConditionObsCount(pool, skinName, predictedFloat);
    if (knnCondObs === 0) {
      crossConditionEstimate = computeCrossConditionEstimate(skinName, predictedFloat);
    }
  }

  const result = resolvePriceWithFallbacks({
    knn, refPrice, listingFloor, spMedian, floatCeiling,
    crossConditionEstimate, skinName, predictedFloat, isStarSkin,
  });

  if (result.grossPrice <= 0) return zeroResult;
  const netPrice = effectiveSellProceeds(result.grossPrice, "csfloat");
  return { priceCents: netPrice, marketplace: "csfloat", grossPrice: result.grossPrice, feePct: MARKETPLACE_FEES.csfloat.sellerFee };
}

/**
 * Vanilla knife pricing: listing floor + recent sale floor (no condition/float).
 * Returns the lower of the two (conservative).
 */
async function getVanillaKnifePrice(pool: pg.Pool, skinName: string): Promise<number> {
  // Primary: CSFloat ref price (condition-agnostic — float has no value on vanilla knives)
  const { rows: refRows } = await pool.query(`
    SELECT median_price_cents FROM price_data
    WHERE skin_name = $1 AND source = 'csfloat_ref' AND median_price_cents > 0
    LIMIT 1
  `, [skinName]);
  if (refRows[0]?.median_price_cents > 0) return refRows[0].median_price_cents;

  // Fallback: recent sale median (condition-agnostic)
  const { rows: saleRows } = await pool.query(`
    SELECT price_cents FROM sale_history
    WHERE skin_name = $1 AND price_cents > 0
      AND sold_at > NOW() - INTERVAL '14 days'
    ORDER BY price_cents
  `, [skinName]);
  if (saleRows.length >= 2) {
    const mid = Math.floor(saleRows.length / 2);
    return saleRows.length % 2 === 0
      ? Math.round((saleRows[mid - 1].price_cents + saleRows[mid].price_cents) / 2)
      : saleRows[mid].price_cents;
  }

  // Last resort: listing floor (cheapest active listing, require 2+)
  const { rows: listingRows } = await pool.query(`
    SELECT MIN(CASE WHEN l.source = 'dmarket' THEN CAST(ROUND(l.price_cents * 1.025) AS INTEGER) ELSE l.price_cents END) as floor_price,
      COUNT(*) as cnt
    FROM listings l JOIN skins s ON l.skin_id = s.id
    WHERE s.name = $1 AND l.stattrak = false AND l.price_cents > 0
      AND l.source IN ('csfloat', 'dmarket')
      AND (l.listing_type = 'buy_now' OR l.listing_type IS NULL)
  `, [skinName]);
  return (listingRows[0]?.cnt >= 2 && listingRows[0]?.floor_price > 0) ? listingRows[0].floor_price : 0;
}

export async function getConditionPrices(
  pool: pg.Pool,
  skinName: string
): Promise<PriceAnchor[]> {
  const cached = conditionPricesCache.get(skinName);
  if (cached !== undefined) return cached;

  const { rows: skinInfoRows } = await pool.query(
    `SELECT min_float, max_float FROM skins WHERE name = $1 AND stattrak = false LIMIT 1`,
    [skinName]
  );
  const skinInfo = skinInfoRows[0] as { min_float: number; max_float: number } | undefined;

  // Prefer CSFloat data; fall back to Skinport min_price if no CSFloat data at all
  const { rows } = await pool.query(
    `SELECT condition, min_price_cents, avg_price_cents
     FROM price_data WHERE skin_name = $1 AND source IN ('csfloat_sales', 'csfloat_ref')
       AND (min_price_cents > 0 OR avg_price_cents > 0)
     ORDER BY min_price_cents DESC`,
    [skinName]
  );

  if (rows.length === 0) {
    // StatTrak: don't use Skinport-only pricing for outputs — too unreliable
    // (Skinport has thin volume and inflated prices for ST items)
    const isStatTrak = skinName.startsWith("StatTrak™");
    if (isStatTrak) {
      conditionPricesCache.set(skinName, []);
      return [];
    }

    // No Skinport/Steam fallback — CSFloat-only for output pricing accuracy.
    // Doppler phase fallback: "★ Karambit | Doppler Phase 1" → "★ Karambit | Doppler"
    // Covers: "Phase N", "Ruby", "Sapphire", "Black Pearl", "Emerald"
    const phaseMatch = skinName.match(/^(.+\| (?:Doppler|Gamma Doppler))\s+(?:Phase \d|Ruby|Sapphire|Black Pearl|Emerald)$/);
    if (phaseMatch) {
      const baseName = phaseMatch[1];
      const { rows: baseRows } = await pool.query(
        `SELECT condition, min_price_cents, avg_price_cents FROM price_data WHERE skin_name = $1`,
        [baseName]
      );
      const result = buildAnchors(baseRows, 1.0, skinInfo);
      conditionPricesCache.set(skinName, result);
      return result;
    }
    conditionPricesCache.set(skinName, []);
    return [];
  }

  const result = buildAnchors(rows, 1.0, skinInfo);
  conditionPricesCache.set(skinName, result);
  return result;
}

export function buildAnchors(
  rows: { condition: string; min_price_cents: number; avg_price_cents: number }[],
  multiplier: number,
  floatRange?: { min_float: number; max_float: number }
): PriceAnchor[] {
  const anchors: PriceAnchor[] = [];
  for (const row of rows) {
    const midpoint = CONDITION_MIDPOINTS.find((c) => c.name === row.condition);
    if (!midpoint) continue;

    if (floatRange) {
      const bounds = CONDITION_BOUNDS.find(b => b.name === row.condition);
      if (bounds && (floatRange.min_float >= bounds.max || floatRange.max_float <= bounds.min)) {
        continue;
      }
    }

    const price = row.avg_price_cents > 0 ? row.avg_price_cents : row.min_price_cents;
    if (price <= 0) continue;
    anchors.push({ float: midpoint.mid, price: Math.round(price * multiplier) });
  }
  anchors.sort((a, b) => a.float - b.float);
  for (let i = 1; i < anchors.length; i++) {
    if (anchors[i].price > anchors[i - 1].price) {
      anchors[i].price = anchors[i - 1].price;
    }
  }
  return anchors;
}

export function interpolatePrice(anchors: PriceAnchor[], float: number): number {
  if (anchors.length === 0) return 0;
  // Single anchor: only use if float is in the SAME condition.
  // FN ($141) should NOT be used for MW, FT, WW, or BS.
  if (anchors.length === 1) {
    const anchorCond = floatToCondition(anchors[0].float);
    const targetCond = floatToCondition(float);
    return anchorCond === targetCond ? anchors[0].price : 0;
  }
  // Multi-anchor: interpolate within range, don't extrapolate beyond.
  // If float is outside all anchors, only use nearest if same condition.
  if (float <= anchors[0].float) {
    return floatToCondition(float) === floatToCondition(anchors[0].float) ? anchors[0].price : 0;
  }
  if (float >= anchors[anchors.length - 1].float) {
    return floatToCondition(float) === floatToCondition(anchors[anchors.length - 1].float)
      ? anchors[anchors.length - 1].price : 0;
  }
  for (let i = 0; i < anchors.length - 1; i++) {
    const lo = anchors[i];
    const hi = anchors[i + 1];
    if (float >= lo.float && float <= hi.float) {
      const t = (float - lo.float) / (hi.float - lo.float);
      return Math.round(lo.price + t * (hi.price - lo.price));
    }
  }
  return anchors[anchors.length - 1].price;
}
