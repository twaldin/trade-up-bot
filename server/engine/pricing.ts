// Condition-level output pricing with multi-source cache.

import pg from "pg";
import { floatToCondition } from "../../shared/types.js";
import { CONDITION_BOUNDS, type PriceAnchor } from "./types.js";
import { MARKETPLACE_FEES, effectiveSellProceeds } from "./fees.js";
import { knnOutputPriceAtFloat } from "./knn-pricing.js";

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

// Module-level ref price map shared between loadCsfloatRefPrices and overrideWithListingFloors/fillKnifeLastResort
let _refPrice = new Map<string, number>();

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

  // Build per-condition reference price from price_data to detect outlier listings
  // Per-condition avoids filtering out legitimate FN premiums (e.g., Wild Lotus FN=$17k vs BS=$150)
  _refPrice = new Map<string, number>();
  const { rows: refRows } = await pool.query(`
    SELECT skin_name, condition, MIN(CASE WHEN min_price_cents > 0 THEN min_price_cents ELSE median_price_cents END) as ref
    FROM price_data WHERE (min_price_cents > 0 OR median_price_cents > 0)
      AND source IN ('csfloat_sales', 'csfloat_ref')
    GROUP BY skin_name, condition
  `);
  for (const r of refRows) if (r.ref > 0) _refPrice.set(`${r.skin_name}:${r.condition}`, r.ref);

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
      const ref = _refPrice.get(`${row.name}:${cond.name}`);
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
      const ref = _refPrice.get(`${row.name}:${cond.name}`);
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

  priceCacheBuilt = true;
  priceCacheBuiltAt = Date.now();
  console.log(`  Price cache: ${salesCount} sales, ${listingOverrides} listing overrides (lower), ${listingFills} listing fills, ${listingLastResort} knife listing fills, ${csfloatRefCount} ref, 0 steam, 0 skinport, ${knifeExtrapolated} knife extrapolated = ${priceCache.size} total (DM floors: ${dmarketFloorCache.size}, SP floors: ${skinportFloorCache.size})`);
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
    SELECT skin_name, float_value, price_cents FROM (
      -- Active CSFloat listings
      SELECT s.name as skin_name, l.float_value, l.price_cents
      FROM listings l JOIN skins s ON l.skin_id = s.id
      WHERE (l.source = 'csfloat' OR l.source IS NULL) AND l.stattrak = false
        AND l.float_value > 0 AND l.price_cents > 0
        AND (l.listing_type = 'buy_now' OR l.listing_type IS NULL)
      UNION ALL
      -- Active DMarket listings (normalized with 2.5% buyer fee)
      SELECT s.name, l.float_value, CAST(ROUND(l.price_cents * 1.025) AS INTEGER)
      FROM listings l JOIN skins s ON l.skin_id = s.id
      WHERE l.source = 'dmarket' AND l.stattrak = false
        AND l.float_value > 0 AND l.price_cents > 0
    ) combined
    ORDER BY skin_name, float_value
  `);

  for (const row of rows) {
    let arr = _floatCeilingCache.get(row.skin_name);
    if (!arr) { arr = []; _floatCeilingCache.set(row.skin_name, arr); }
    arr.push({ float: row.float_value, price: row.price_cents });
  }
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

  // Sort by price ascending, take bottom-5 average as ceiling
  // Requires 5+ listings for consensus — prevents single outlier listings from capping
  const sorted = nearbyLower.map(d => d.price).sort((a, b) => a - b);
  const n = Math.min(5, sorted.length);
  const bottom5Avg = Math.round(sorted.slice(0, n).reduce((s, p) => s + p, 0) / n);

  return bottom5Avg;
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

  // 1. Try KNN float-specific pricing for ALL skins (not just ★)
  const knn = await knnOutputPriceAtFloat(pool, skinName, predictedFloat);
  let grossPrice = 0;

  if (knn && knn.confidence >= 0.3) {
    grossPrice = knn.priceCents;
    // Sanity cap: if KNN is >5x condition-level ref, KNN is probably wrong
    // (pattern premiums, Skinport platform bias, sparse-data interpolation artifacts).
    // 98.5% of real sales are within 2x ref; >5x are pattern items KNN can't price.
    const refPrice = lookupPrice(pool, skinName, predictedFloat);
    if (refPrice > 0 && grossPrice > refPrice * 5) {
      grossPrice = refPrice;
    }
  } else {
    // 2. Fallback: condition-level pricing from csfloat_ref + listing floors
    grossPrice = lookupPrice(pool, skinName, predictedFloat);
  }

  if (grossPrice <= 0) return zeroResult;

  // 3. Apply float-monotonicity ceiling from listings + sales at equal-or-lower floats
  const ceiling = await getFloatCeiling(pool, skinName, predictedFloat);
  if (ceiling !== null && ceiling < grossPrice) {
    grossPrice = ceiling;
  }

  const netPrice = effectiveSellProceeds(grossPrice, "csfloat");
  return {
    priceCents: netPrice,
    marketplace: "csfloat",
    grossPrice,
    feePct: MARKETPLACE_FEES.csfloat.sellerFee,
  };
}

/**
 * Vanilla knife pricing: listing floor + recent sale floor (no condition/float).
 * Returns the lower of the two (conservative).
 */
async function getVanillaKnifePrice(pool: pg.Pool, skinName: string): Promise<number> {
  // Listing floor: cheapest active listing across CSFloat + DMarket (require 2+)
  const { rows: listingRows } = await pool.query(`
    SELECT MIN(CASE WHEN l.source = 'dmarket' THEN CAST(ROUND(l.price_cents * 1.025) AS INTEGER) ELSE l.price_cents END) as floor_price,
      COUNT(*) as cnt
    FROM listings l JOIN skins s ON l.skin_id = s.id
    WHERE s.name = $1 AND l.stattrak = false AND l.price_cents > 0
      AND l.source IN ('csfloat', 'dmarket')
      AND (l.listing_type = 'buy_now' OR l.listing_type IS NULL)
  `, [skinName]);
  const listingFloor = (listingRows[0]?.cnt >= 2 && listingRows[0]?.floor_price > 0) ? listingRows[0].floor_price : 0;

  // Recent sale floor: cheapest sale in last 7 days
  const { rows: saleRows } = await pool.query(`
    SELECT MIN(price_cents) as floor_price, COUNT(*) as cnt
    FROM sale_history
    WHERE skin_name = $1 AND price_cents > 0
      AND sold_at > NOW() - INTERVAL '7 days'
  `, [skinName]);
  const saleFloor = (saleRows[0]?.cnt >= 1 && saleRows[0]?.floor_price > 0) ? saleRows[0].floor_price : 0;

  // Use the lower of the two, or whichever is available
  if (listingFloor > 0 && saleFloor > 0) return Math.min(listingFloor, saleFloor);
  return listingFloor || saleFloor;
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
