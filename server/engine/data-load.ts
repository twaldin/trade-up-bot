/**
 * Data loading: DB queries for listings and outcome skins.
 */

import pg from "pg";
import { createWriteStream, createReadStream } from "fs";
import { unlink } from "fs/promises";
import { createInterface } from "readline";
import { RARITY_ORDER } from "../../shared/types.js";
import type { ListingWithCollection, DbSkinOutcome, AdjustedListing } from "./types.js";
import { addAdjustedFloat } from "./selection.js";

export async function getListingsForRarity(
  pool: pg.Pool,
  rarity: string,
  maxPriceCents?: number,
  stattrak: boolean = false
): Promise<ListingWithCollection[]> {
  let sql = `
    SELECT
      l.id, l.skin_id, s.name as skin_name, s.weapon, l.price_cents,
      l.float_value, l.paint_seed, l.stattrak, s.min_float, s.max_float,
      s.rarity, l.source, sc.collection_id, c.name as collection_name
    FROM listings l
    JOIN skins s ON l.skin_id = s.id
    JOIN skin_collections sc ON s.id = sc.skin_id
    JOIN collections c ON sc.collection_id = c.id
    WHERE s.rarity = $1 AND l.stattrak = $2
      AND (l.listing_type = 'buy_now' OR l.listing_type IS NULL)
      AND l.claimed_by IS NULL
  `;
  const params: (string | number | boolean)[] = [rarity, stattrak];
  let paramIdx = 3;
  if (maxPriceCents) {
    sql += ` AND l.price_cents <= $${paramIdx}`;
    params.push(maxPriceCents);
    paramIdx++;
  }
  sql += " ORDER BY l.price_cents ASC";
  const { rows } = await pool.query(sql, params);
  return rows as ListingWithCollection[];
}

export async function getOutcomesForCollections(
  pool: pg.Pool,
  collectionIds: string[],
  targetRarity: string,
  stattrak: boolean = false
): Promise<DbSkinOutcome[]> {
  if (collectionIds.length === 0) return [];
  const placeholders = collectionIds.map((_, i) => `$${i + 1}`).join(",");
  const nextParam = collectionIds.length + 1;
  const { rows } = await pool.query(
    `SELECT s.id, s.name, s.weapon, s.min_float, s.max_float, s.rarity,
            sc.collection_id, c.name as collection_name
     FROM skins s
     JOIN skin_collections sc ON s.id = sc.skin_id
     JOIN collections c ON sc.collection_id = c.id
     WHERE sc.collection_id IN (${placeholders})
     AND s.rarity = $${nextParam} AND s.stattrak = $${nextParam + 1}`,
    [...collectionIds, targetRarity, stattrak]
  );
  return rows as DbSkinOutcome[];
}

export function getNextRarity(rarity: string): string | null {
  const order = RARITY_ORDER[rarity];
  if (order === undefined) return null;
  const entries = Object.entries(RARITY_ORDER);
  const next = entries.find(([, v]) => v === order + 1);
  return next?.[0] ?? null;
}

export interface DiscoveryData {
  allListings: ListingWithCollection[];
  allAdjusted: AdjustedListing[];
  byCollection: Map<string, ListingWithCollection[]>;
  byColAdj: Map<string, AdjustedListing[]>;
  byColValue: Map<string, ListingWithCollection[]>;
}

// Process-level cache: in workers (short-lived fork() processes) this avoids the duplicate
// loadDiscoveryData call when structured discovery and exploration both load the same rarity.
// In the main daemon process, call clearDiscoveryCache() between cycles.
const _discoveryCache = new Map<string, DiscoveryData>();

export function clearDiscoveryCache() {
  _discoveryCache.clear();
}

/**
 * Serialize pre-computed DiscoveryData to NDJSON file.
 * Line 1: header with rarity, groupKey, listing count
 * Lines 2+: one listing per line (JSON)
 */
export async function serializeDiscoveryData(
  data: DiscoveryData,
  rarity: string,
  groupKey: "collection_id" | "collection_name",
  filePath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = createWriteStream(filePath);
    ws.on("error", reject);
    ws.write(JSON.stringify({ rarity, groupKey, count: data.allListings.length }) + "\n");
    for (const l of data.allListings) {
      ws.write(JSON.stringify(l) + "\n");
    }
    ws.end(() => resolve());
  });
}

/**
 * Deserialize NDJSON file into DiscoveryData and populate the process-level cache.
 * Call this in workers before any discovery function to avoid PG + KNN overhead.
 */
export async function loadDiscoveryDataFromFile(filePath: string): Promise<DiscoveryData> {
  const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });

  let header: { rarity: string; groupKey: "collection_id" | "collection_name"; count: number } | null = null;
  const allListings: ListingWithCollection[] = [];

  for await (const line of rl) {
    if (!line.trim()) continue;
    if (!header) {
      header = JSON.parse(line);
      continue;
    }
    allListings.push(JSON.parse(line));
  }

  if (!header) throw new Error(`Empty NDJSON file: ${filePath}`);

  const groupKey = header.groupKey;
  const allAdjusted = addAdjustedFloat(allListings);

  const byCollection = new Map<string, ListingWithCollection[]>();
  const byColAdj = new Map<string, AdjustedListing[]>();
  for (const l of allAdjusted) {
    const key = l[groupKey];
    const list = byCollection.get(key) ?? [];
    list.push(l);
    byCollection.set(key, list);
    const adjList = byColAdj.get(key) ?? [];
    adjList.push(l);
    byColAdj.set(key, adjList);
  }
  for (const [, list] of byCollection) list.sort((a, b) => a.price_cents - b.price_cents);
  for (const [, list] of byColAdj) list.sort((a, b) => a.price_cents - b.price_cents);
  const byColValue = new Map<string, ListingWithCollection[]>();
  for (const [key, list] of byCollection) {
    byColValue.set(key, [...list].sort((a, b) => (a.valueRatio ?? 1) - (b.valueRatio ?? 1)));
  }

  const result: DiscoveryData = { allListings, allAdjusted, byCollection, byColAdj, byColValue };
  const cacheKey = `${header.rarity}|${groupKey}`;
  _discoveryCache.set(cacheKey, result);

  console.log(`  [loadDiscoveryData ${header.rarity}] from file (${allListings.length} listings)`);
  return result;
}

/** Clean up temp NDJSON files */
export async function cleanupDiscoveryFiles(filePaths: string[]): Promise<void> {
  for (const f of filePaths) {
    try { await unlink(f); } catch { /* already deleted */ }
  }
}

/**
 * Load listings for a rarity, compute adjusted floats, and group by collection.
 * Replaces the duplicated 20-30 line data-loading block in discovery functions.
 *
 * Results are cached per rarity+groupKey within the process lifetime.
 *
 * @param groupKey - "collection_id" for gun discovery, "collection_name" for knife discovery
 * @param options.excludeWeapons - filter out listings whose weapon is in this set (e.g. KNIFE_WEAPONS)
 */
export async function loadDiscoveryData(
  pool: pg.Pool,
  rarity: string,
  groupKey: "collection_id" | "collection_name",
  options?: { maxInputCost?: number; stattrak?: boolean; excludeWeapons?: readonly string[] }
): Promise<DiscoveryData> {
  const cacheKey = `${rarity}|${groupKey}`;
  const cached = _discoveryCache.get(cacheKey);
  if (cached) {
    console.log(`  [loadDiscoveryData ${rarity}] cached (${cached.allListings.length} listings)`);
    return cached;
  }

  const t0 = Date.now();
  let allListings = await getListingsForRarity(pool, rarity, options?.maxInputCost, options?.stattrak);
  const tQuery = Date.now();

  if (options?.excludeWeapons) {
    const excluded = options.excludeWeapons;
    allListings = allListings.filter(l => !(excluded as readonly string[]).includes(l.weapon));
  }

  // KNN-based input value scoring: identify underpriced listings at their specific float
  const { batchInputValueRatios } = await import("./knn-pricing.js");
  const valueRatios = await batchInputValueRatios(pool, allListings);
  const tKnn = Date.now();
  for (const l of allListings) {
    l.valueRatio = valueRatios.get(l.id);
  }

  const allAdjusted = addAdjustedFloat(allListings);

  const byCollection = new Map<string, ListingWithCollection[]>();
  const byColAdj = new Map<string, AdjustedListing[]>();
  for (const l of allAdjusted) {
    const key = l[groupKey];
    const list = byCollection.get(key) ?? [];
    list.push(l);
    byCollection.set(key, list);

    const adjList = byColAdj.get(key) ?? [];
    adjList.push(l);
    byColAdj.set(key, adjList);
  }

  // Sort both maps by price within each group (for greedy selection)
  for (const [, list] of byCollection) list.sort((a, b) => a.price_cents - b.price_cents);
  for (const [, list] of byColAdj) list.sort((a, b) => a.price_cents - b.price_cents);

  // Also create value-sorted maps for strategies that want underpriced listings first
  const byColValue = new Map<string, ListingWithCollection[]>();
  for (const [key, list] of byCollection) {
    byColValue.set(key, [...list].sort((a, b) => (a.valueRatio ?? 1) - (b.valueRatio ?? 1)));
  }
  const tSort = Date.now();

  console.log(`  [loadDiscoveryData ${rarity}] ${allListings.length} listings — query ${tQuery - t0}ms, KNN ${tKnn - tQuery}ms, sort ${tSort - tKnn}ms, total ${tSort - t0}ms`);

  const result = { allListings, allAdjusted, byCollection, byColAdj, byColValue };
  _discoveryCache.set(cacheKey, result);
  return result;
}

/**
 * Build a profit-weighted collection pool for randomized exploration.
 * Collections with more historically profitable trade-ups get higher weight (sqrt-scaled).
 *
 * @param byCollection - when provided, builds a collection_id → collection_name mapping
 *   so that gun discovery (which passes collection_id values as eligibleCollections)
 *   can resolve IDs to names for the profit weight lookup.
 */
export async function buildWeightedPool(
  pool: pg.Pool,
  eligibleCollections: string[],
  tradeUpType: string,
  byCollection?: Map<string, ListingWithCollection[]>,
): Promise<string[]> {
  const profitWeights = new Map<string, number>();
  const { rows: profitRows } = await pool.query(`
    SELECT tui.collection_name, COUNT(*) as cnt
    FROM trade_up_inputs tui JOIN trade_ups t ON t.id = tui.trade_up_id
    WHERE t.type = $1 AND t.profit_cents > 0
    GROUP BY tui.collection_name
  `, [tradeUpType]);
  for (const r of profitRows) profitWeights.set(r.collection_name, parseInt(r.cnt, 10));

  // Build ID → name mapping from byCollection listings (gun discovery passes IDs)
  const nameMap = new Map<string, string>();
  if (byCollection) {
    for (const [key, listings] of byCollection) {
      if (listings.length > 0) {
        nameMap.set(key, listings[0].collection_name);
      }
    }
  }

  const weightedPool: string[] = [];
  for (const col of eligibleCollections) {
    const resolvedName = nameMap.get(col) ?? col;
    const w = Math.max(1, profitWeights.get(resolvedName) ?? 0);
    for (let i = 0; i < Math.min(10, Math.ceil(Math.sqrt(w))); i++) weightedPool.push(col);
  }
  return weightedPool;
}
