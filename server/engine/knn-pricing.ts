/**
 * Float-range pricing infrastructure for theory generation.
 *
 * Provides float-aware input pricing via:
 *   1. float_price_data table — bucket-level learned prices from real listings
 *   2. price_observations table — individual float/price data points for KNN
 *   3. KNN lookup — K nearest neighbors by float distance, weighted average
 *
 * Also handles bootstrapping from existing data (zero API calls) and
 * observation management (seeding, snapshots, pruning).
 */

import pg from "pg";
import { floatToCondition } from "../../shared/types.js";

export const FLOAT_BUCKETS = [
  { min: 0.00, max: 0.03, label: "FN-low" },
  { min: 0.03, max: 0.07, label: "FN-high" },
  { min: 0.07, max: 0.10, label: "MW-low" },
  { min: 0.10, max: 0.15, label: "MW-high" },
  { min: 0.15, max: 0.25, label: "FT-low" },
  { min: 0.25, max: 0.38, label: "FT-high" },
  { min: 0.38, max: 0.45, label: "WW" },
  { min: 0.45, max: 1.00, label: "BS" },
];

export function getFloatBucket(float: number): { min: number; max: number } | null {
  for (const b of FLOAT_BUCKETS) {
    if (float < b.max || (b.label === "BS" && float <= 1.0)) {
      return { min: b.min, max: b.max };
    }
  }
  return null;
}


const _learnedCache = new Map<string, { price: number | null; unavailable: boolean; listingCount: number }>();
let _learnedCacheLoadedAt = 0;
const LEARNED_CACHE_TTL_MS = 60 * 1000;

async function ensureLearnedCache(pool: pg.Pool) {
  if (_learnedCache.size > 0 && Date.now() - _learnedCacheLoadedAt < LEARNED_CACHE_TTL_MS) return;
  _learnedCache.clear();

  const { rows } = await pool.query(`
    SELECT skin_name, float_min, float_max, avg_price_cents, listing_count
    FROM float_price_data
  `);

  for (const row of rows) {
    const key = `${row.skin_name}:${row.float_min}:${row.float_max}`;
    _learnedCache.set(key, {
      price: row.listing_count !== 0 ? row.avg_price_cents : null,
      unavailable: row.listing_count === 0,
      listingCount: row.listing_count,
    });
  }
  _learnedCacheLoadedAt = Date.now();
}

export function clearLearnedCache() {
  _learnedCache.clear();
  _learnedCacheLoadedAt = 0;
}

/**
 * Look up a learned float-range price with intra-bucket interpolation.
 *
 * Linearly interpolates between adjacent better-condition bucket avg and THIS
 * bucket avg based on position within the bucket, but only in the bottom 15%
 * (transition zone). Prevents boundary float exploitation.
 */
export async function getLearnedPrice(
  pool: pg.Pool,
  skinName: string,
  float: number,
  opts?: { realOnly?: boolean }
): Promise<number | null> {
  await ensureLearnedCache(pool);
  const bucket = getFloatBucket(float);
  if (!bucket) return null;

  const cached = _learnedCache.get(`${skinName}:${bucket.min}:${bucket.max}`);
  if (!cached?.price) return null;
  if (opts?.realOnly && cached.listingCount <= 0) return null;

  const thisBucketPrice = cached.price;

  const bucketIdx = FLOAT_BUCKETS.findIndex(b => b.min === bucket.min);
  if (bucketIdx <= 0) return thisBucketPrice;

  const prevBucket = FLOAT_BUCKETS[bucketIdx - 1];
  const prevCached = _learnedCache.get(`${skinName}:${prevBucket.min}:${prevBucket.max}`);

  if (!prevCached?.price) return thisBucketPrice;
  if (opts?.realOnly && prevCached.listingCount <= 0) return thisBucketPrice;

  const prevPrice = prevCached.price;
  if (prevPrice <= thisBucketPrice * 1.5) return thisBucketPrice;

  const BOUNDARY_FRAC = 0.15;
  const bucketRange = bucket.max - bucket.min;
  const boundaryEnd = bucket.min + bucketRange * BOUNDARY_FRAC;

  if (float >= boundaryEnd) return thisBucketPrice;

  const t = (float - bucket.min) / (boundaryEnd - bucket.min);
  return Math.round(prevPrice * (1 - t) + thisBucketPrice * t);
}

/**
 * Interpolated price lookup: if exact bucket has no data, interpolate between
 * nearest known buckets for this skin. Returns null if zero learned prices.
 */
export async function getInterpolatedPrice(
  pool: pg.Pool,
  skinName: string,
  float: number
): Promise<number | null> {
  await ensureLearnedCache(pool);

  const direct = await getLearnedPrice(pool, skinName, float);
  if (direct !== null) return direct;

  const known: { mid: number; price: number }[] = [];
  for (const b of FLOAT_BUCKETS) {
    const cached = _learnedCache.get(`${skinName}:${b.min}:${b.max}`);
    if (cached?.price) {
      known.push({ mid: (b.min + b.max) / 2, price: cached.price });
    }
  }
  if (known.length === 0) return null;
  if (known.length === 1) return known[0].price;

  known.sort((a, b) => a.mid - b.mid);
  let lower: { mid: number; price: number } | null = null;
  let upper: { mid: number; price: number } | null = null;
  for (const k of known) {
    if (k.mid <= float) lower = k;
    if (k.mid > float && !upper) upper = k;
  }

  if (!lower) return upper!.price;
  if (!upper) return lower.price;

  const t = (float - lower.mid) / (upper.mid - lower.mid);
  return Math.round(lower.price + t * (upper.price - lower.price));
}

const KNN_SOURCE_WEIGHTS: Record<string, number> = {
  sale: 3.0,              // CSFloat verified transactions — ground truth
  listing: 1.5,           // CSFloat market offers
  listing_dmarket: 1.0,   // DMarket listings, buyer-fee-normalized
  listing_skinport: 0.7,  // Skinport data-only source
};

const _knnCache = new Map<string, { float: number; price: number; weight: number }[]>();
let _knnCacheLoadedAt = 0;
const KNN_CACHE_TTL_MS = 2 * 60 * 1000;
const KNN_MAX_OBS_AGE_DAYS = 90;

/**
 * Dynamic half-life based on observation density:
 * - < 10 observations in 90 days → 45 days (rare skins need longer memory)
 * - > 50 observations → 14 days (liquid skins can use fresh data)
 * - Linear interpolation between
 */
function dynamicHalfLife(observationCount: number): number {
  if (observationCount <= 10) return 45;
  if (observationCount >= 50) return 14;
  return Math.round(45 - (observationCount - 10) * (45 - 14) / (50 - 10));
}

async function ensureKnnCache(pool: pg.Pool) {
  if (_knnCache.size > 0 && Date.now() - _knnCacheLoadedAt < KNN_CACHE_TTL_MS) return;
  _knnCache.clear();

  const { rows } = await pool.query(`
    SELECT skin_name, float_value, price_cents, source,
      EXTRACT(EPOCH FROM NOW() - observed_at::timestamptz) / 86400.0 as age_days
    FROM price_observations
    WHERE EXTRACT(EPOCH FROM NOW() - observed_at::timestamptz) / 86400.0 <= $1
    ORDER BY skin_name, float_value
  `, [KNN_MAX_OBS_AGE_DAYS]);

  // Group raw observations by skin
  const rawBySkin = new Map<string, typeof rows>();
  for (const row of rows) {
    let arr = rawBySkin.get(row.skin_name);
    if (!arr) { arr = []; rawBySkin.set(row.skin_name, arr); }
    arr.push(row);
  }

  // Build cache with per-skin dynamic half-life
  for (const [skinName, skinRows] of rawBySkin) {
    const halfLife = dynamicHalfLife(skinRows.length);
    const arr: { float: number; price: number; weight: number }[] = [];
    for (const row of skinRows) {
      const baseWeight = KNN_SOURCE_WEIGHTS[row.source] ?? 1.0;
      const ageDecay = 1 / (1 + (row.age_days || 0) / halfLife);
      arr.push({
        float: row.float_value,
        price: row.price_cents,
        weight: baseWeight * ageDecay,
      });
    }
    _knnCache.set(skinName, arr);
  }
  _knnCacheLoadedAt = Date.now();
}

export function clearKnnCache() {
  _knnCache.clear();
  _knnCacheLoadedAt = 0;
}

const KNN_K = 12;
const KNN_BOTTOM_N = 5;
const KNN_MIN_OBS = 3;
const KNN_MAX_FLOAT_DIST = 0.04;
const KNN_MAX_NEAREST_DIST = 0.012;

export async function knnPriceAtFloat(
  pool: pg.Pool,
  skinName: string,
  float: number
): Promise<number | null> {
  await ensureKnnCache(pool);
  const obs = _knnCache.get(skinName);
  if (!obs || obs.length < KNN_MIN_OBS) return null;

  const targetCondition = floatToCondition(float);
  const sameCondition = obs.filter(o => floatToCondition(o.float) === targetCondition);
  if (sameCondition.length < KNN_MIN_OBS) return null;

  const withDist = sameCondition
    .map(o => ({ ...o, dist: Math.abs(o.float - float) }))
    .filter(o => o.dist <= KNN_MAX_FLOAT_DIST);

  if (withDist.length < KNN_MIN_OBS) return null;

  withDist.sort((a, b) => a.dist - b.dist);
  if (withDist[0].dist > KNN_MAX_NEAREST_DIST) return null;

  const neighbors = withDist.slice(0, KNN_K);

  const prices = neighbors.map(n => n.price).sort((a, b) => a - b);
  const median = prices[Math.floor(prices.length / 2)];
  const priceFloor = Math.round(median / 2);
  const filtered = neighbors.filter(n => n.price <= median * 5 && n.price >= priceFloor);
  if (filtered.length < KNN_MIN_OBS) return null;

  filtered.sort((a, b) => a.price - b.price);
  const bottomN = filtered.slice(0, KNN_BOTTOM_N);
  const EPSILON = 0.001;
  const totalWeight = bottomN.reduce((s, o) => s + o.weight / (o.dist + EPSILON), 0);
  const weightedAvg = bottomN.reduce((s, o) => s + o.price * o.weight / (o.dist + EPSILON), 0) / totalWeight;

  return Math.round(weightedAvg);
}

/**
 * KNN output price lookup — estimates sell price at a specific float.
 * Uses weighted median (not bottom-N average like input pricing).
 * Returns null if insufficient data.
 */
export async function knnOutputPriceAtFloat(
  pool: pg.Pool,
  skinName: string,
  float: number
): Promise<{ priceCents: number; confidence: number; observationCount: number } | null> {
  await ensureKnnCache(pool);
  const obs = _knnCache.get(skinName);
  if (!obs || obs.length < KNN_MIN_OBS) return null;

  const targetCondition = floatToCondition(float);
  const sameCondition = obs.filter(o => floatToCondition(o.float) === targetCondition);
  if (sameCondition.length < KNN_MIN_OBS) return null;

  const withDist = sameCondition
    .map(o => ({ ...o, dist: Math.abs(o.float - float) }))
    .filter(o => o.dist <= KNN_MAX_FLOAT_DIST);

  if (withDist.length < KNN_MIN_OBS) return null;

  withDist.sort((a, b) => a.dist - b.dist);
  if (withDist[0].dist > KNN_MAX_NEAREST_DIST) return null;

  const neighbors = withDist.slice(0, KNN_K);

  // Outlier filtering: remove prices >5x or <0.2x the median
  const prices = neighbors.map(n => n.price).sort((a, b) => a - b);
  const median = prices[Math.floor(prices.length / 2)];
  const filtered = neighbors.filter(n => n.price <= median * 5 && n.price >= median * 0.2);
  if (filtered.length < KNN_MIN_OBS) return null;

  // Weighted median by (source_weight * age_decay / distance)
  const EPSILON = 0.001;
  const weighted: { price: number; weight: number }[] = filtered.map(n => ({
    price: n.price,
    weight: n.weight / (n.dist + EPSILON),
  }));
  weighted.sort((a, b) => a.price - b.price);

  const totalWeight = weighted.reduce((s, w) => s + w.weight, 0);
  let cumWeight = 0;
  let medianPrice = weighted[0].price;
  for (const w of weighted) {
    cumWeight += w.weight;
    if (cumWeight >= totalWeight / 2) {
      medianPrice = w.price;
      break;
    }
  }

  // Confidence based on observation count and distance spread
  const avgDist = filtered.reduce((s, n) => s + n.dist, 0) / filtered.length;
  const countFactor = Math.min(filtered.length / 8, 1.0); // peaks at 8+ obs
  const distFactor = 1 - Math.min(avgDist / KNN_MAX_FLOAT_DIST, 1.0);
  const confidence = countFactor * 0.6 + distFactor * 0.4;

  return { priceCents: Math.round(medianPrice), confidence, observationCount: filtered.length };
}

export async function getKnnObservationCount(
  pool: pg.Pool,
  skinName: string,
  float: number
): Promise<number> {
  await ensureKnnCache(pool);
  const obs = _knnCache.get(skinName);
  if (!obs) return 0;
  const targetCondition = floatToCondition(float);
  return obs.filter(o => Math.abs(o.float - float) <= KNN_MAX_FLOAT_DIST && floatToCondition(o.float) === targetCondition).length;
}

export async function getKnnObservationCountBroad(
  pool: pg.Pool,
  skinName: string,
  float: number
): Promise<number> {
  await ensureKnnCache(pool);
  const obs = _knnCache.get(skinName);
  if (!obs) return 0;
  const targetCondition = floatToCondition(float);
  return obs.filter(o => floatToCondition(o.float) === targetCondition).length;
}

/**
 * Seed knife/glove sale_history into price_observations.
 * These records have float+price tuples ideal for KNN output pricing.
 * Also snapshots current knife/glove listings as observations.
 */
export async function seedKnifeSaleObservations(pool: pg.Pool): Promise<number> {
  let inserted = 0;

  // Seed knife/glove sales from sale_history
  const sales = await pool.query(`
    INSERT INTO price_observations (skin_name, float_value, price_cents, source, observed_at)
    SELECT skin_name, float_value, price_cents, 'sale', sold_at
    FROM sale_history WHERE skin_name LIKE '★%' AND float_value > 0 AND price_cents > 0
    ON CONFLICT DO NOTHING
  `);
  inserted += sales.rowCount ?? 0;

  // Seed knife/glove listings as observations (Extraordinary rarity)
  const listings = await pool.query(`
    INSERT INTO price_observations (skin_name, float_value, price_cents, source, observed_at)
    SELECT s.name, l.float_value, l.price_cents, 'listing', l.created_at
    FROM listings l JOIN skins s ON l.skin_id = s.id
    WHERE s.rarity = 'Extraordinary' AND l.float_value > 0 AND l.price_cents > 0
      AND l.stattrak = 0
      AND (l.source = 'csfloat' OR l.source IS NULL)
    ON CONFLICT DO NOTHING
  `);
  inserted += listings.rowCount ?? 0;

  if (inserted > 0) clearKnnCache();
  return inserted;
}

export async function seedPriceObservations(pool: pg.Pool): Promise<number> {
  const { rows } = await pool.query("SELECT COUNT(*) as n FROM price_observations");
  const existing = parseInt(rows[0].n, 10);
  if (existing > 1000) return 0;

  let inserted = 0;

  const sales = await pool.query(`
    INSERT INTO price_observations (skin_name, float_value, price_cents, source, observed_at)
    SELECT skin_name, float_value, price_cents, 'sale', sold_at
    FROM sale_history WHERE float_value > 0 AND price_cents > 0
    ON CONFLICT DO NOTHING
  `);
  inserted += sales.rowCount ?? 0;

  const listings = await pool.query(`
    INSERT INTO price_observations (skin_name, float_value, price_cents, source, observed_at)
    SELECT s.name, l.float_value, l.price_cents, 'listing', l.created_at
    FROM listings l JOIN skins s ON l.skin_id = s.id
    WHERE l.float_value > 0 AND l.price_cents > 0 AND l.stattrak = 0
    ON CONFLICT DO NOTHING
  `);
  inserted += listings.rowCount ?? 0;

  clearKnnCache();
  return inserted;
}

export async function snapshotListingsToObservations(
  pool: pg.Pool,
  maxAgeDays: number = 14
): Promise<number> {
  let total = 0;

  // CSFloat listings → source 'listing'
  // Phase-qualify Doppler skins so observations are per-phase
  const csfloat = await pool.query(`
    INSERT INTO price_observations (skin_name, float_value, price_cents, source, observed_at)
    SELECT CASE WHEN s.name LIKE '%Doppler%' AND l.phase IS NOT NULL AND l.phase != ''
                THEN s.name || ' ' || l.phase ELSE s.name END,
           l.float_value, l.price_cents, 'listing', l.created_at
    FROM listings l JOIN skins s ON l.skin_id = s.id
    WHERE l.float_value > 0 AND l.price_cents > 0 AND l.stattrak = 0
      AND (l.source = 'csfloat' OR l.source IS NULL)
      AND l.created_at < NOW() - ($1 || ' days')::interval
    ON CONFLICT DO NOTHING
  `, [maxAgeDays]);
  total += csfloat.rowCount ?? 0;

  // DMarket listings → source 'listing_dmarket' (price normalized with 2.5% buyer fee)
  const dmarket = await pool.query(`
    INSERT INTO price_observations (skin_name, float_value, price_cents, source, observed_at)
    SELECT CASE WHEN s.name LIKE '%Doppler%' AND l.phase IS NOT NULL AND l.phase != ''
                THEN s.name || ' ' || l.phase ELSE s.name END,
           l.float_value, CAST(ROUND(l.price_cents * 1.025) AS INTEGER), 'listing_dmarket', l.created_at
    FROM listings l JOIN skins s ON l.skin_id = s.id
    WHERE l.float_value > 0 AND l.price_cents > 0 AND l.stattrak = 0
      AND l.source = 'dmarket'
      AND l.created_at < NOW() - ($1 || ' days')::interval
    ON CONFLICT DO NOTHING
  `, [maxAgeDays]);
  total += dmarket.rowCount ?? 0;

  // Skinport listings → source 'listing_skinport'
  const skinport = await pool.query(`
    INSERT INTO price_observations (skin_name, float_value, price_cents, source, observed_at)
    SELECT s.name, l.float_value, l.price_cents, 'listing_skinport', l.created_at
    FROM listings l JOIN skins s ON l.skin_id = s.id
    WHERE l.float_value > 0 AND l.price_cents > 0 AND l.stattrak = 0
      AND l.source = 'skinport'
      AND l.created_at < NOW() - ($1 || ' days')::interval
    ON CONFLICT DO NOTHING
  `, [maxAgeDays]);
  total += skinport.rowCount ?? 0;

  if (total > 0) clearKnnCache();
  return total;
}

export async function pruneObservations(pool: pg.Pool, maxPerSkin: number = 500): Promise<number> {
  let pruned = 0;

  const stale = await pool.query(`
    DELETE FROM price_observations
    WHERE EXTRACT(EPOCH FROM NOW() - observed_at::timestamptz) / 86400.0 > $1
  `, [KNN_MAX_OBS_AGE_DAYS]);
  pruned += stale.rowCount ?? 0;

  const { rows: overLimit } = await pool.query(`
    SELECT skin_name, COUNT(*) as cnt FROM price_observations
    GROUP BY skin_name HAVING COUNT(*) > $1
  `, [maxPerSkin]);

  for (const { skin_name, cnt } of overLimit) {
    const excess = parseInt(cnt, 10) - maxPerSkin;
    const result = await pool.query(`
      DELETE FROM price_observations WHERE id IN (
        SELECT id FROM price_observations
        WHERE skin_name = $1
        ORDER BY source ASC, observed_at ASC
        LIMIT $2
      )
    `, [skin_name, excess]);
    pruned += result.rowCount ?? 0;
  }
  if (pruned > 0) clearKnnCache();
  return pruned;
}

const _supplyCache = new Map<string, number>();
let _supplyCacheLoadedAt = 0;
const SUPPLY_CACHE_TTL_MS = 5 * 60 * 1000;

async function ensureSupplyCache(pool: pg.Pool): Promise<void> {
  if (_supplyCache.size > 0 && Date.now() - _supplyCacheLoadedAt < SUPPLY_CACHE_TTL_MS) return;
  _supplyCache.clear();

  const { rows } = await pool.query(`
    SELECT s.name as skin_name,
      CASE
        WHEN l.float_value < 0.03 THEN 0.00
        WHEN l.float_value < 0.07 THEN 0.03
        WHEN l.float_value < 0.10 THEN 0.07
        WHEN l.float_value < 0.15 THEN 0.10
        WHEN l.float_value < 0.25 THEN 0.15
        WHEN l.float_value < 0.38 THEN 0.25
        WHEN l.float_value < 0.45 THEN 0.38
        ELSE 0.45
      END as bucket_min,
      COUNT(*) as cnt
    FROM listings l
    JOIN skins s ON l.skin_id = s.id
    WHERE l.stattrak = 0
    GROUP BY s.name, bucket_min
  `);

  for (const r of rows) {
    _supplyCache.set(`${r.skin_name}:${r.bucket_min}`, parseInt(r.cnt, 10));
  }
  _supplyCacheLoadedAt = Date.now();
}

export async function getSupplyCount(
  pool: pg.Pool,
  skinName: string,
  float: number
): Promise<number> {
  await ensureSupplyCache(pool);
  const bucket = getFloatBucket(float);
  if (!bucket) return 0;
  return _supplyCache.get(`${skinName}:${bucket.min}`) ?? 0;
}

export function clearSupplyCache(): void {
  _supplyCache.clear();
  _supplyCacheLoadedAt = 0;
}

export async function isFloatUnavailable(
  pool: pg.Pool,
  skinName: string,
  float: number
): Promise<boolean> {
  await ensureLearnedCache(pool);
  const bucket = getFloatBucket(float);
  if (!bucket) return false;
  const cached = _learnedCache.get(`${skinName}:${bucket.min}:${bucket.max}`);
  return cached?.unavailable ?? false;
}

async function storeLearnedPrice(
  pool: pg.Pool,
  skinName: string,
  floatMin: number,
  floatMax: number,
  avgPriceCents: number,
  listingCount: number
) {
  await pool.query(`
    INSERT INTO float_price_data (skin_name, float_min, float_max, avg_price_cents, listing_count, last_checked)
    VALUES ($1, $2, $3, $4, $5, NOW())
    ON CONFLICT (skin_name, float_min, float_max) DO UPDATE SET
      avg_price_cents = $4, listing_count = $5, last_checked = NOW()
  `, [skinName, floatMin, floatMax, avgPriceCents, listingCount]);
}

const CONDITION_TO_BUCKETS: Record<string, typeof FLOAT_BUCKETS> = {
  "Factory New": FLOAT_BUCKETS.filter(b => b.max <= 0.07),
  "Minimal Wear": FLOAT_BUCKETS.filter(b => b.min >= 0.07 && b.max <= 0.15),
  "Field-Tested": FLOAT_BUCKETS.filter(b => b.min >= 0.15 && b.max <= 0.38),
  "Well-Worn": FLOAT_BUCKETS.filter(b => b.min >= 0.38 && b.max <= 0.45),
  "Battle-Scarred": FLOAT_BUCKETS.filter(b => b.min >= 0.45),
};

/**
 * Seed float_price_data from existing listings + ref prices. No API calls needed.
 *
 * Pass 1: Real listings → bottom-5 avg per skin × float bucket (high confidence).
 * Pass 2: Ref prices → fill remaining gaps with condition-level averages (lower confidence).
 */
export async function bootstrapLearnedPrices(pool: pg.Pool): Promise<number> {
  let seeded = 0;

  // Per-condition ref price map for outlier filtering
  const condRefMap = new Map<string, number>();
  const { rows: condRefRows } = await pool.query(`
    SELECT skin_name, condition, MIN(CASE WHEN min_price_cents > 0 THEN min_price_cents ELSE avg_price_cents END) as ref
    FROM price_data WHERE (min_price_cents > 0 OR avg_price_cents > 0)
    GROUP BY skin_name, condition
  `);
  for (const r of condRefRows) if (r.ref > 0) condRefMap.set(`${r.skin_name}:${r.condition}`, r.ref);

  const bucketToCondition = (bucketMin: number): string => {
    if (bucketMin < 0.07) return "Factory New";
    if (bucketMin < 0.15) return "Minimal Wear";
    if (bucketMin < 0.38) return "Field-Tested";
    if (bucketMin < 0.45) return "Well-Worn";
    return "Battle-Scarred";
  };

  // Pass 1: Seed from real listings
  for (const bucket of FLOAT_BUCKETS) {
    const { rows } = await pool.query(`
      SELECT s.name as skin_name, COUNT(*) as cnt,
        (SELECT CAST(AVG(sub.price_cents) AS INTEGER)
         FROM (SELECT price_cents FROM listings l2
               JOIN skins s2 ON l2.skin_id = s2.id
               WHERE s2.name = s.name
                 AND l2.float_value >= $1 AND l2.float_value < $2
                 AND l2.stattrak = 0
               ORDER BY l2.price_cents ASC LIMIT 5) sub
        ) as avg_bottom5
      FROM listings l
      JOIN skins s ON l.skin_id = s.id
      WHERE l.float_value >= $3 AND l.float_value < $4
        AND l.stattrak = 0
      GROUP BY s.name
      HAVING COUNT(*) >= 2
    `, [bucket.min, bucket.max, bucket.min, bucket.max]);

    const condition = bucketToCondition(bucket.min);

    for (const row of rows) {
      if (!row.avg_bottom5 || row.avg_bottom5 <= 0) continue;

      const condRef = condRefMap.get(`${row.skin_name}:${condition}`);
      if (condRef && row.avg_bottom5 > condRef * 5) continue;

      const { rows: existingRows } = await pool.query(
        `SELECT listing_count, last_checked FROM float_price_data WHERE skin_name = $1 AND float_min = $2 AND float_max = $3`,
        [row.skin_name, bucket.min, bucket.max]
      );
      const existing = existingRows[0] as { listing_count: number; last_checked: string } | undefined;
      if (!existing || existing.listing_count === -1 ||
          (Date.now() - new Date(existing.last_checked + 'Z').getTime() > 12 * 3600 * 1000)) {
        await storeLearnedPrice(pool, row.skin_name, bucket.min, bucket.max, row.avg_bottom5, parseInt(row.cnt, 10));
        seeded++;
      }
    }
  }

  // Pass 2: Fill gaps from ref prices for skins with NO real listing data
  const { rows: skinsWithRealRows } = await pool.query(
    `SELECT DISTINCT skin_name FROM float_price_data WHERE listing_count > 0`
  );
  const skinsWithRealData = new Set(skinsWithRealRows.map((r: { skin_name: string }) => r.skin_name));

  const { rows: refRows } = await pool.query(`
    SELECT skin_name, condition, avg_price_cents,
      CASE source
        WHEN 'csfloat_sales' THEN 1
        WHEN 'listing' THEN 2
        WHEN 'csfloat_ref' THEN 3
        WHEN 'steam' THEN 4
        WHEN 'skinport' THEN 5
        ELSE 6
      END as priority
    FROM price_data
    WHERE avg_price_cents > 0
    ORDER BY skin_name, condition, priority
  `);

  const refMap = new Map<string, Record<string, number>>();
  for (const row of refRows) {
    let skin = refMap.get(row.skin_name);
    if (!skin) { skin = {}; refMap.set(row.skin_name, skin); }
    if (!(row.condition in skin)) skin[row.condition] = row.avg_price_cents;
  }

  for (const [skinName, prices] of refMap) {
    if (skinsWithRealData.has(skinName)) continue;

    for (const [condition, buckets] of Object.entries(CONDITION_TO_BUCKETS)) {
      const condPrice = prices[condition];
      if (!condPrice || condPrice <= 0) continue;

      for (const bucket of buckets) {
        const { rows: existCheck } = await pool.query(
          `SELECT 1 FROM float_price_data WHERE skin_name = $1 AND float_min = $2 AND float_max = $3`,
          [skinName, bucket.min, bucket.max]
        );
        if (existCheck.length > 0) continue;

        let price = condPrice;
        if (bucket.label === "FN-low") {
          const mwPrice = prices["Minimal Wear"];
          price = Math.round(condPrice * 1.5);
          if (mwPrice && mwPrice > price) price = mwPrice;
        }

        await storeLearnedPrice(pool, skinName, bucket.min, bucket.max, price, -1);
        seeded++;
      }
    }
  }

  clearLearnedCache();
  return seeded;
}
