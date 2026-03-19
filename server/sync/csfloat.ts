
import pg from "pg";
import { getSyncMeta, setSyncMeta } from "../db.js";
import { cascadeTradeUpStatuses } from "../engine.js";
import { CSFLOAT_BASE, HIGH_VALUE_COLLECTIONS } from "./types.js";
import type { CSFloatListing, CSFloatResponse, SmartFetchSkin } from "./types.js";
import { isListingTooOld, findSkinId, saveReferencePrices, getValidConditions } from "./utils.js";

export async function fetchCSFloatListings(
  options: {
    skinName?: string;
    rarity?: string;
    minPrice?: number;
    maxPrice?: number;
    minFloat?: number;
    maxFloat?: number;
    sortBy?: string;
    limit?: number;
    page?: number;
    apiKey?: string;
  } = {}
) {
  const params = new URLSearchParams();
  if (options.skinName) params.set("market_hash_name", options.skinName);
  if (options.rarity) params.set("rarity", options.rarity);
  if (options.minPrice) params.set("min_price", String(options.minPrice));
  if (options.maxPrice) params.set("max_price", String(options.maxPrice));
  if (options.minFloat != null) params.set("min_float", String(options.minFloat));
  if (options.maxFloat != null) params.set("max_float", String(options.maxFloat));
  if (options.page) params.set("page", String(options.page));
  params.set("sort_by", options.sortBy ?? "lowest_price");
  params.set("limit", String(options.limit ?? 50));
  params.set("category", "1"); // weapon skins only
  params.set("type", "buy_now"); // exclude auctions

  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "application/json",
  };
  if (options.apiKey) {
    headers["Authorization"] = options.apiKey;
  }

  const url = `${CSFLOAT_BASE}/listings?${params}`;
  const res = await fetch(url, { headers });

  if (!res.ok) {
    const retryInfo = {
      remaining: res.headers.get("x-ratelimit-remaining"),
      reset: res.headers.get("x-ratelimit-reset"),
    };
    throw Object.assign(
      new Error(`CSFloat API error: ${res.status} ${res.statusText}`),
      { status: res.status, retryInfo }
    );
  }

  const data: CSFloatResponse = await res.json();
  return data.data;
}

export async function syncListingsForRarity(
  pool: pg.Pool,
  rarity: string,
  options: {
    minPrice?: number;
    maxPrice?: number;
    apiKey?: string;
    pages?: number;
    sortBy?: string;
  } = {}
) {
  // Map our rarity names to CSFloat's rarity filter values
  const rarityMap: Record<string, number> = {
    "Consumer Grade": 1,
    "Industrial Grade": 2,
    "Mil-Spec": 3,
    Restricted: 4,
    Classified: 5,
    Covert: 6,
  };

  const rarityNum = rarityMap[rarity];
  if (!rarityNum) {
    console.log(`  Skipping unknown rarity: ${rarity}`);
    return 0;
  }

  console.log(`Fetching CSFloat listings for ${rarity}...`);

  let totalInserted = 0;
  const pages = options.pages ?? 1;
  let minPrice = options.minPrice ?? 0; // sliding window for pagination
  const seenIds = new Set<string>();

  for (let page = 0; page < pages; page++) {
    try {
      let listings: CSFloatListing[];
      // Retry with exponential backoff on rate limit
      let retries = 0;
      while (true) {
        try {
          listings = await fetchCSFloatListings({
            rarity: String(rarityNum),
            maxPrice: options.maxPrice,
            minPrice: minPrice > 0 ? minPrice : undefined,
            sortBy: options.sortBy ?? "lowest_price",
            limit: 50,
            apiKey: options.apiKey,
          });
          break;
        } catch (err: any) {
          if (err.message?.includes("429") && retries < 1) {
            // Single retry with short wait — bail fast when rate limited
            const delay = 15000;
            console.log(`  Rate limited, waiting 15s...`);
            await new Promise((r) => setTimeout(r, delay));
            retries++;
          } else {
            throw err;
          }
        }
      }

      if (listings.length === 0) break;

      // Get max price from ALL items in response (for pagination)
      const maxPriceInBatch = Math.max(...listings.map((l) => l.price));

      // Insert listings in a transaction
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const listing of listings) {
          if (seenIds.has(listing.id)) continue;
          seenIds.add(listing.id);

          // Skip auctions — only use buy_now for reliable pricing
          if (listing.type !== "buy_now") continue;
          // Skip very old listings (seller listed months/years ago)
          if (isListingTooOld(listing.created_at)) continue;

          const skinId = await findSkinId(pool, listing.item.market_hash_name);
          if (!skinId) continue;

          const isStattrak = listing.item.market_hash_name
            .toLowerCase()
            .includes("stattrak");
          await client.query(`
            INSERT INTO listings (id, skin_id, price_cents, float_value, paint_seed, stattrak, created_at, source, listing_type, price_updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'csfloat', $8, NOW())
            ON CONFLICT (id) DO UPDATE SET
              skin_id = $2, price_cents = $3, float_value = $4, paint_seed = $5, stattrak = $6, created_at = $7, source = 'csfloat', listing_type = $8, price_updated_at = NOW()
          `, [
            listing.id,
            skinId,
            listing.price,
            listing.item.float_value,
            listing.item.paint_seed ?? null,
            isStattrak ? 1 : 0,
            listing.created_at,
            listing.type,
          ]);
          totalInserted++;
        }
        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }

      await saveReferencePrices(pool, listings);

      // Advance the price window for next page
      if (maxPriceInBatch > minPrice) {
        minPrice = maxPriceInBatch;
      } else {
        // All items at same price — bump by 1 cent to skip past them
        minPrice = maxPriceInBatch + 1;
      }

      if (listings.length < 50) break;

      // Rate limiting (CSFloat has strict rate limits)
      await new Promise((r) => setTimeout(r, 2500));
    } catch (err) {
      console.error(`  Error fetching page ${page}: ${err}`);
      break;
    }
  }

  console.log(`  Inserted ${totalInserted} listings for ${rarity}`);
  return totalInserted;
}

/**
 * Fetch listings for a rarity using a different sort to increase skin diversity.
 * The main rarity fetch uses lowest_price which only gets cheap skins.
 * This uses most_recent to get a random cross-section of skins.
 */
export async function syncListingsDiversified(
  pool: pg.Pool,
  rarity: string,
  options: { apiKey?: string; pages?: number } = {}
) {
  return syncListingsForRarity(pool, rarity, {
    ...options,
    sortBy: "most_recent",
    pages: options.pages ?? 10,
  });
}

/**
 * Fetch listings for a specific skin across all valid conditions.
 * Uses market_hash_name search: "AK-47 | Redline (Field-Tested)"
 * Returns number of API calls used and listings inserted.
 */
export async function syncListingsForSkin(
  pool: pg.Pool,
  skin: { id: string; name: string; min_float: number; max_float: number },
  options: { apiKey?: string; conditions?: string[]; maxFloat?: number } = {}
): Promise<{ apiCalls: number; inserted: number }> {
  const conditions = options.conditions ?? getValidConditions(skin.min_float, skin.max_float);

  let totalApiCalls = 0;
  let totalInserted = 0;

  for (const condition of conditions) {
    const marketHashName = `${skin.name} (${condition})`;
    totalApiCalls++;

    try {
      let listings: CSFloatListing[];
      let retries = 0;
      while (true) {
        try {
          listings = await fetchCSFloatListings({
            skinName: marketHashName,
            sortBy: "lowest_price",
            limit: 50,
            apiKey: options.apiKey,
            maxFloat: options.maxFloat,
          });
          break;
        } catch (err: any) {
          if (err.message?.includes("429") && retries < 1) {
            // Single retry with short wait — bail fast if rate limited
            const delay = 15000;
            console.log(`    Rate limited, waiting 15s...`);
            await new Promise((r) => setTimeout(r, delay));
            retries++;
            totalApiCalls++;
          } else {
            throw err;
          }
        }
      }

      if (listings.length === 0) continue;

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const listing of listings) {
          if (listing.type !== "buy_now") continue;
          if (isListingTooOld(listing.created_at)) continue;
          const isStattrak = listing.item.market_hash_name.toLowerCase().includes("stattrak");
          await client.query(`
            INSERT INTO listings (id, skin_id, price_cents, float_value, paint_seed, stattrak, created_at, source, listing_type, price_updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'csfloat', $8, NOW())
            ON CONFLICT (id) DO UPDATE SET
              skin_id = $2, price_cents = $3, float_value = $4, paint_seed = $5, stattrak = $6, created_at = $7, source = 'csfloat', listing_type = $8, price_updated_at = NOW()
          `, [
            listing.id,
            skin.id,
            listing.price,
            listing.item.float_value,
            listing.item.paint_seed ?? null,
            isStattrak ? 1 : 0,
            listing.created_at,
            listing.type,
          ]);
          totalInserted++;
        }
        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }
      await saveReferencePrices(pool, listings);

      // Rate limit pause between conditions
      await new Promise((r) => setTimeout(r, 1500));
    } catch (err: any) {
      console.log(`    Error fetching ${marketHashName}: ${err.message}`);
    }
  }

  return { apiCalls: totalApiCalls, inserted: totalInserted };
}

/**
 * Fetch listings for a rarity using price-range sweeps.
 * Covers different price brackets to get skins we'd miss with just lowest_price sort.
 */
export async function syncListingsByPriceRanges(
  pool: pg.Pool,
  rarity: string,
  options: { apiKey?: string; pagesPerRange?: number } = {}
): Promise<{ apiCalls: number; inserted: number }> {
  // Price ranges in cents — sweeps from cheap to expensive
  const ranges = [
    { min: 0, max: 500 },        // $0-5
    { min: 500, max: 1500 },     // $5-15
    { min: 1500, max: 5000 },    // $15-50
    { min: 5000, max: 15000 },   // $50-150
    { min: 15000, max: 50000 },  // $150-500
    { min: 50000, max: 0 },      // $500+
  ];

  let totalApiCalls = 0;
  let totalInserted = 0;
  const pagesPerRange = options.pagesPerRange ?? 3;

  for (const range of ranges) {
    try {
      const count = await syncListingsForRarity(pool, rarity, {
        apiKey: options.apiKey,
        pages: pagesPerRange,
        sortBy: "lowest_price",
        minPrice: range.min > 0 ? range.min : undefined,
        maxPrice: range.max > 0 ? range.max : undefined,
      });
      totalApiCalls += pagesPerRange;
      totalInserted += count;
    } catch (err: any) {
      console.log(`    Error in price range $${range.min/100}-$${range.max/100}: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }

  return { apiCalls: totalApiCalls, inserted: totalInserted };
}

/**
 * Fetch low-float Classified listings specifically for FN-targeting trade-ups.
 * Uses lowest_price sort on FN condition to get cheapest FN inputs.
 * Also fetches by most_recent to catch new low-float listings.
 */
export async function syncLowFloatClassifiedListings(
  pool: pg.Pool,
  options: {
    apiKey: string;
    maxCalls?: number;
    onProgress?: (msg: string) => void;
  }
): Promise<{ apiCalls: number; inserted: number }> {
  const maxCalls = options.maxCalls ?? 30;

  // Get Classified skins that CAN have FN (min_float < 0.07)
  const { rows: fnSkins } = await pool.query(`
    SELECT s.id, s.name, s.min_float, s.max_float,
           COUNT(CASE WHEN l.float_value < 0.07 THEN 1 END) as fn_listings
    FROM skins s
    LEFT JOIN listings l ON s.id = l.skin_id AND l.stattrak = 0
    WHERE s.rarity = 'Classified' AND s.stattrak = 0
      AND s.min_float < 0.07
    GROUP BY s.id, s.name, s.min_float, s.max_float
    ORDER BY fn_listings ASC, s.name
  `) as { rows: { id: string; name: string; min_float: number; max_float: number; fn_listings: string }[] };

  console.log(`  ${fnSkins.length} Classified skins can have FN, fetching low-float listings`);

  let totalApiCalls = 0;
  let totalInserted = 0;
  let consecutiveRateLimits = 0;

  for (const skin of fnSkins) {
    if (totalApiCalls >= maxCalls) break;
    if (consecutiveRateLimits >= 2) {
      console.log("  Bailing — consecutive rate limits");
      break;
    }

    const marketHashName = `${skin.name} (Factory New)`;
    totalApiCalls++;

    try {
      let listings: CSFloatListing[];
      let retries = 0;
      while (true) {
        try {
          listings = await fetchCSFloatListings({
            skinName: marketHashName,
            sortBy: "lowest_price",
            limit: 50,
            apiKey: options.apiKey,
          });
          consecutiveRateLimits = 0;
          break;
        } catch (err: any) {
          if (err.message?.includes("429") && retries < 1) {
            console.log(`    Rate limited, waiting 15s...`);
            await new Promise((r) => setTimeout(r, 15000));
            retries++;
            totalApiCalls++;
          } else if (err.message?.includes("429")) {
            consecutiveRateLimits++;
            throw err;
          } else {
            throw err;
          }
        }
      }

      if (listings.length === 0) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const listing of listings) {
          if (listing.type !== "buy_now") continue;
          if (isListingTooOld(listing.created_at)) continue;
          const isStattrak = listing.item.market_hash_name.toLowerCase().includes("stattrak");
          if (isStattrak) continue; // Only non-StatTrak for trade-ups
          await client.query(`
            INSERT INTO listings (id, skin_id, price_cents, float_value, paint_seed, stattrak, created_at, source, listing_type, price_updated_at)
            VALUES ($1, $2, $3, $4, $5, 0, $6, 'csfloat', $7, NOW())
            ON CONFLICT (id) DO UPDATE SET
              skin_id = $2, price_cents = $3, float_value = $4, paint_seed = $5, stattrak = 0, created_at = $6, source = 'csfloat', listing_type = $7, price_updated_at = NOW()
          `, [
            listing.id, skin.id, listing.price,
            listing.item.float_value, listing.item.paint_seed ?? null,
            listing.created_at, listing.type,
          ]);
          totalInserted++;
        }
        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }
      await saveReferencePrices(pool, listings);

      if (totalApiCalls % 10 === 0) {
        const msg = `Low-float classified: ${totalApiCalls}/${maxCalls} calls, ${totalInserted} FN listings`;
        options.onProgress?.(msg);
      }

      await new Promise((r) => setTimeout(r, 1500));
    } catch (err: any) {
      console.log(`    Error fetching ${marketHashName}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  const msg = `Low-float classified: ${totalApiCalls} calls, ${totalInserted} FN listings`;
  options.onProgress?.(msg);
  console.log(`  ${msg}`);

  return { apiCalls: totalApiCalls, inserted: totalInserted };
}

/**
 * Smart per-skin listing fetch for any rarity — zero waste.
 *
 * Prioritization:
 * 1. High-value collection skins (always fetch regardless of count)
 * 2. Skins with <10 listings (critical coverage gaps)
 * 3. FN-capable skins with <5 FN listings (for FN-targeting trade-ups)
 * 4. Skins with 50+ listings all >7 days old (stale refresh, 1 condition only)
 *
 * Skips skins fetched <6h ago (tracked via sync_meta).
 * Uses per-skin name fetches (syncListingsForSkin) instead of bulk sweeps.
 */
export async function syncSmartListingsForRarity(
  pool: pg.Pool,
  rarity: string,
  options: {
    apiKey: string;
    maxCalls?: number;
    onProgress?: (msg: string) => void;
  }
): Promise<{ apiCalls: number; inserted: number; skinsFetched: number; skipped: number }> {
  const maxCalls = options.maxCalls ?? 140;

  // Load last-fetched timestamps (keyed per rarity to avoid cross-contamination)
  const metaKey = rarity === "Classified" ? "skin_fetch_times" : `skin_fetch_times_${rarity.toLowerCase().replace(/[\s-]/g, "_")}`;
  const rawFetchTimes = await getSyncMeta(pool, metaKey);
  const fetchTimes: Record<string, number> = rawFetchTimes ? JSON.parse(rawFetchTimes) : {};
  const now = Date.now();
  const SKIP_WINDOW = 2 * 60 * 60 * 1000; // 2h — cycle through skins faster for coverage

  // Get all skins of this rarity with coverage stats
  const { rows: skins } = await pool.query(`
    SELECT s.id, s.name, s.min_float, s.max_float,
      COUNT(l.id) as listing_count,
      COUNT(CASE WHEN l.float_value < 0.07 THEN 1 END) as fn_count,
      COALESCE(MIN(EXTRACT(EPOCH FROM NOW() - l.created_at) / 86400.0), 999) as newest_age_days
    FROM skins s
    LEFT JOIN listings l ON s.id = l.skin_id AND l.stattrak = 0
    WHERE s.rarity = $1 AND s.stattrak = 0
    GROUP BY s.id, s.name, s.min_float, s.max_float
  `, [rarity]) as { rows: { id: string; name: string; min_float: number; max_float: number; listing_count: string; fn_count: string; newest_age_days: number }[] };

  // Get high-value collection skin IDs
  const highValueSkinIds = new Set<string>();
  const hvPh = HIGH_VALUE_COLLECTIONS.map((_, i) => `$${i + 2}`).join(",");
  const { rows: hvRows } = await pool.query(`
    SELECT DISTINCT sc.skin_id
    FROM skin_collections sc
    JOIN collections c ON sc.collection_id = c.id
    JOIN skins s ON sc.skin_id = s.id
    WHERE s.rarity = $1 AND s.stattrak = 0
      AND c.name IN (${hvPh})
  `, [rarity, ...HIGH_VALUE_COLLECTIONS]) as { rows: { skin_id: string }[] };
  for (const r of hvRows) highValueSkinIds.add(r.skin_id);

  // Build prioritized list
  const candidates: SmartFetchSkin[] = [];
  let skipped = 0;

  for (const skin of skins) {
    const listingCount = Number(skin.listing_count);
    const fnCount = Number(skin.fn_count);

    // Skip if fetched recently
    if (fetchTimes[skin.id] && (now - fetchTimes[skin.id]) < SKIP_WINDOW) {
      skipped++;
      continue;
    }

    const isHighValue = highValueSkinIds.has(skin.id);
    const canFN = skin.min_float < 0.07;

    // Calculate priority score (higher = fetch first)
    let priority = 0;

    if (isHighValue) {
      priority += 1000; // Always fetch high-value collection skins
    }

    if (listingCount < 3) {
      priority += 500; // Critical: almost no data
    } else if (listingCount < 10) {
      priority += 300; // Under-covered
    } else if (listingCount < 20) {
      priority += 100; // Moderate
    }

    if (canFN && fnCount < 5) {
      priority += 200; // FN-capable but few FN listings
    }

    // Stale refresh: lots of listings but all old
    if (listingCount >= 50 && skin.newest_age_days > 7) {
      priority += 50; // Low priority — just needs a refresh
    }

    // Skip well-covered skins that aren't high-value and aren't stale
    if (priority === 0 && listingCount >= 20) {
      skipped++;
      continue;
    }

    // Even skins with no explicit priority get a baseline if they have < 20 listings
    if (priority === 0) {
      priority = 10;
    }

    candidates.push({
      id: skin.id,
      name: skin.name,
      min_float: skin.min_float,
      max_float: skin.max_float,
      listing_count: listingCount,
      fn_count: fnCount,
      newest_age_days: skin.newest_age_days,
      is_high_value: isHighValue,
      priority,
    });
  }

  // Sort by priority descending
  candidates.sort((a, b) => b.priority - a.priority);

  console.log(`  Smart fetch (${rarity}): ${candidates.length} candidates, ${skipped} skipped (recent/well-covered), ${highValueSkinIds.size} high-value`);
  if (candidates.length > 0) {
    console.log(`  Top 5: ${candidates.slice(0, 5).map(s => `${s.name} (${s.listing_count} listings, p=${s.priority})`).join(", ")}`);
  }

  let totalApiCalls = 0;
  let totalInserted = 0;
  let skinsFetched = 0;
  let consecutiveRateLimits = 0;

  for (const skin of candidates) {
    if (totalApiCalls >= maxCalls) break;
    if (consecutiveRateLimits >= 2) {
      console.log("  Bailing — consecutive rate limits");
      break;
    }

    // For stale-but-well-covered skins, only fetch FN condition (1 call) to refresh
    const isStaleRefresh = skin.listing_count >= 50 && skin.newest_age_days > 7 && !skin.is_high_value;
    const conditions = isStaleRefresh
      ? (skin.min_float < 0.07 ? ["Factory New"] : ["Field-Tested"])
      : undefined; // undefined = all valid conditions

    const remainingBudget = maxCalls - totalApiCalls;
    const validConditions = getValidConditions(skin.min_float, skin.max_float);
    const callsNeeded = conditions ? conditions.length : validConditions.length;

    if (callsNeeded > remainingBudget) {
      // Not enough budget for all conditions — try just FN if applicable
      if (skin.min_float < 0.07 && remainingBudget >= 1) {
        // Fetch just FN
      } else {
        break;
      }
    }

    try {
      const result = await syncListingsForSkin(pool, skin, {
        apiKey: options.apiKey,
        conditions: conditions ?? (callsNeeded > remainingBudget && skin.min_float < 0.07 ? ["Factory New"] : undefined),
      });
      totalApiCalls += result.apiCalls;
      totalInserted += result.inserted;
      skinsFetched++;
      consecutiveRateLimits = 0;

      // Track fetch time
      fetchTimes[skin.id] = now;

      if (skinsFetched % 10 === 0) {
        const msg = `Smart fetch (${rarity}): ${skinsFetched} skins, ${totalApiCalls}/${maxCalls} calls, ${totalInserted} listings`;
        options.onProgress?.(msg);
        console.log(`  ${msg}`);
      }
    } catch (err: any) {
      if (err.message?.includes("429")) {
        consecutiveRateLimits++;
      }
      console.log(`    Error: ${skin.name}: ${err.message}`);
    }
  }

  // Persist fetch times
  try {
    await setSyncMeta(pool, metaKey, JSON.stringify(fetchTimes));
  } catch { /* metadata persistence is best-effort */ }

  const msg = `Smart fetch (${rarity}) done: ${skinsFetched} skins, ${totalApiCalls} calls, ${totalInserted} listings (${skipped} skipped)`;
  options.onProgress?.(msg);
  console.log(`  ${msg}`);

  return { apiCalls: totalApiCalls, inserted: totalInserted, skinsFetched, skipped };
}

/**
 * Smart prioritized listing fetch for knife trade-up inputs.
 * Instead of blanket rarity fetches, targets specific Covert skins
 * in collections that have the highest-value knife/glove outputs
 * but the fewest existing listings.
 *
 * Priority score = (output_pool_value / max_output_pool_value) * (1 / (1 + listing_count))
 * This ensures collections with expensive outputs AND sparse listings get fetched first.
 */
export async function syncPrioritizedKnifeInputs(
  pool: pg.Pool,
  options: {
    apiKey: string;
    maxCalls?: number;
    onProgress?: (msg: string) => void;
  }
): Promise<{ apiCalls: number; inserted: number; collectionsServed: number }> {
  const maxCalls = options.maxCalls ?? 100;

  // Step 1: Get all collections with Covert gun skins and their listing counts.
  const { rows: collectionStats } = await pool.query(`
    SELECT c.id as collection_id, c.name as collection_name,
           COUNT(DISTINCT s.id) as covert_skins,
           COUNT(l.id) as total_listings
    FROM collections c
    JOIN skin_collections sc ON c.id = sc.collection_id
    JOIN skins s ON sc.skin_id = s.id
    LEFT JOIN listings l ON s.id = l.skin_id AND l.stattrak = 0
    WHERE s.rarity = 'Covert' AND s.stattrak = 0
      AND s.weapon NOT LIKE '%Knife%' AND s.weapon NOT LIKE '%Bayonet%'
      AND s.weapon NOT LIKE '%Gloves%' AND s.weapon NOT LIKE '%Wraps%'
      AND s.weapon != 'Shadow Daggers'
      AND c.id != 'collection-set-community-37'
    GROUP BY c.id, c.name
    ORDER BY total_listings ASC
  `) as { rows: { collection_id: string; collection_name: string; covert_skins: string; total_listings: string }[] };

  // Step 2: Get output value estimates per collection from collection_scores
  const scoreMap = new Map<string, number>();
  const { rows: scores } = await pool.query(
    "SELECT collection_id, max_profit_cents FROM collection_scores"
  ) as { rows: { collection_id: string; max_profit_cents: number }[] };
  for (const s of scores) scoreMap.set(s.collection_id, s.max_profit_cents);

  // Step 3: Compute priority scores.
  const prioritized = collectionStats.map(c => ({
    ...c,
    total_listings_num: Number(c.total_listings),
    priority: (1 / (1 + Number(c.total_listings))) * (1 + Math.max(0, scoreMap.get(c.collection_id) ?? 500) / 100),
  }));
  prioritized.sort((a, b) => b.priority - a.priority);

  console.log(`  Prioritized ${prioritized.length} collections for knife input fetch`);
  if (prioritized.length > 0) {
    console.log(`  Top 5: ${prioritized.slice(0, 5).map(c => `${c.collection_name} (${c.total_listings_num} listings, priority ${c.priority.toFixed(2)})`).join(", ")}`);
  }

  // Step 4: Fetch listings for each collection's Covert skins, highest priority first
  let totalApiCalls = 0;
  let totalInserted = 0;
  let collectionsServed = 0;
  let consecutiveRateLimits = 0;

  for (const col of prioritized) {
    if (totalApiCalls >= maxCalls) break;
    if (consecutiveRateLimits >= 2) {
      console.log("  Bailing — consecutive rate limits");
      break;
    }

    // Get individual Covert skins in this collection
    const { rows: colSkins } = await pool.query(`
      SELECT s.id, s.name, s.min_float, s.max_float
      FROM skins s
      JOIN skin_collections sc ON s.id = sc.skin_id
      WHERE sc.collection_id = $1 AND s.rarity = 'Covert' AND s.stattrak = 0
        AND s.weapon NOT LIKE '%Knife%' AND s.weapon NOT LIKE '%Bayonet%'
        AND s.weapon NOT LIKE '%Gloves%' AND s.weapon NOT LIKE '%Wraps%'
        AND s.weapon != 'Shadow Daggers'
    `, [col.collection_id]) as { rows: { id: string; name: string; min_float: number; max_float: number }[] };

    if (colSkins.length === 0) continue;

    let colInserted = 0;
    for (const skin of colSkins) {
      if (totalApiCalls >= maxCalls) break;
      if (consecutiveRateLimits >= 2) break;

      try {
        const result = await syncListingsForSkin(pool, skin, {
          apiKey: options.apiKey,
        });
        totalApiCalls += result.apiCalls;
        colInserted += result.inserted;
        totalInserted += result.inserted;

        if (result.apiCalls > 0) consecutiveRateLimits = 0;
      } catch (err: any) {
        if (err.message?.includes("429")) {
          consecutiveRateLimits++;
        }
        console.log(`    Error fetching ${skin.name}: ${err.message}`);
      }
    }

    if (colInserted > 0) {
      console.log(`    ${col.collection_name}: +${colInserted} listings`);
    }
    collectionsServed++;

    if (totalApiCalls % 20 === 0) {
      options.onProgress?.(`Priority fetch: ${totalApiCalls}/${maxCalls} calls, ${totalInserted} listings, ${collectionsServed} collections`);
    }
  }

  const msg = `Priority fetch done: ${totalApiCalls} calls, ${totalInserted} listings, ${collectionsServed} collections`;
  options.onProgress?.(msg);
  console.log(`  ${msg}`);

  return { apiCalls: totalApiCalls, inserted: totalInserted, collectionsServed };
}

/**
 * Fetch Covert listings for output skins that appear in top profitable trade-ups.
 * This gives us better output pricing data (lowest listing) for the skins that matter most.
 */
export async function syncCovertOutputListings(
  pool: pg.Pool,
  options: {
    apiKey: string;
    maxCalls?: number;
    onProgress?: (msg: string) => void;
  }
): Promise<{ apiCalls: number; inserted: number }> {
  // Priority 1: Output skins from profitable trade-ups (extract from outcomes_json)
  const { rows: profitableOutputs } = await pool.query(`
    SELECT je->>'skin_name' as skin_name, COUNT(*) as appearances
    FROM trade_ups t, json_array_elements(t.outcomes_json::json) je
    WHERE t.profit_cents > 0 AND t.outcomes_json IS NOT NULL
    GROUP BY je->>'skin_name'
    ORDER BY appearances DESC
    LIMIT 15
  `) as { rows: { skin_name: string; appearances: string }[] };

  // Priority 2: Knife/glove skins with fewest listings (coverage gaps — worst first)
  const { rows: uncoveredOutputs } = await pool.query(`
    SELECT s.name as skin_name, COUNT(l.id) as appearances
    FROM skins s
    LEFT JOIN listings l ON s.id = l.skin_id AND l.stattrak = 0
    WHERE s.name LIKE '★%' AND s.stattrak = 0
    GROUP BY s.id, s.name
    ORDER BY appearances ASC
    LIMIT 50
  `) as { rows: { skin_name: string; appearances: string }[] };

  // Merge: profitable outputs first, then uncovered
  const seen = new Set<string>();
  const topOutputs: { skin_name: string; appearances: number }[] = [];
  for (const o of profitableOutputs) {
    if (!seen.has(o.skin_name)) { seen.add(o.skin_name); topOutputs.push({ skin_name: o.skin_name, appearances: Number(o.appearances) }); }
  }
  for (const o of uncoveredOutputs) {
    if (!seen.has(o.skin_name)) { seen.add(o.skin_name); topOutputs.push({ skin_name: o.skin_name, appearances: Number(o.appearances) }); }
  }

  if (topOutputs.length === 0) return { apiCalls: 0, inserted: 0 };

  let totalApiCalls = 0;
  let totalInserted = 0;
  let consecutiveRateLimits = 0;
  const maxCalls = options.maxCalls ?? 60;

  for (const output of topOutputs) {
    if (totalApiCalls >= maxCalls) break;
    if (consecutiveRateLimits >= 2) {
      console.log("  Bailing — 2 consecutive rate limits");
      break;
    }

    // Find the skin ID for this output (Covert knives or Extraordinary gloves)
    const { rows: skinRows } = await pool.query(
      "SELECT id, name, min_float, max_float FROM skins WHERE name = $1 AND stattrak = 0 LIMIT 1",
      [output.skin_name]
    );
    const skin = skinRows[0] as { id: string; name: string; min_float: number; max_float: number } | undefined;
    if (!skin) continue;

    // Check how many recent listings we already have
    const { rows: recentRows } = await pool.query(
      "SELECT COUNT(*) as c FROM listings WHERE skin_id = $1 AND EXTRACT(EPOCH FROM NOW() - created_at) / 86400.0 < 3",
      [skin.id]
    );
    if (Number(recentRows[0].c) >= 10) continue; // Already have fresh data

    // Fetch by market_hash_name for each valid condition
    const conditions = getValidConditions(skin.min_float, skin.max_float);
    for (const condition of conditions) {
      if (totalApiCalls >= maxCalls) break;
      if (consecutiveRateLimits >= 2) break;

      const marketHashName = `${skin.name} (${condition})`;
      totalApiCalls++;

      try {
        let listings: CSFloatListing[];
        let retries = 0;
        let wasRateLimited = false;
        while (true) {
          try {
            listings = await fetchCSFloatListings({
              skinName: marketHashName,
              sortBy: "lowest_price",
              limit: 50,
              apiKey: options.apiKey,
            });
            if (!wasRateLimited) consecutiveRateLimits = 0;
            break;
          } catch (err: any) {
            if (err.message?.includes("429") && retries < 1) {
              wasRateLimited = true;
              consecutiveRateLimits++;
              const resetTs = err.retryInfo?.reset ? parseInt(err.retryInfo.reset) : 0;
              let delay: number;
              if (resetTs > 0) {
                delay = Math.min(Math.max(0, resetTs * 1000 - Date.now()) + 2000, 120000);
              } else {
                delay = 30000;
              }
              await new Promise((r) => setTimeout(r, delay));
              retries++;
              totalApiCalls++;
            } else {
              throw err;
            }
          }
        }

        if (listings.length > 0) {
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            for (const listing of listings) {
              if (listing.type !== "buy_now") continue;
              if (isListingTooOld(listing.created_at)) continue;
              const isStattrak = listing.item.market_hash_name.toLowerCase().includes("stattrak");
              await client.query(`
                INSERT INTO listings (id, skin_id, price_cents, float_value, paint_seed, stattrak, created_at, source, listing_type, price_updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, 'csfloat', $8, NOW())
                ON CONFLICT (id) DO UPDATE SET
                  skin_id = $2, price_cents = $3, float_value = $4, paint_seed = $5, stattrak = $6, created_at = $7, source = 'csfloat', listing_type = $8, price_updated_at = NOW()
              `, [
                listing.id,
                skin.id,
                listing.price,
                listing.item.float_value,
                listing.item.paint_seed ?? null,
                isStattrak ? 1 : 0,
                listing.created_at,
                listing.type,
              ]);
              totalInserted++;
            }
            await client.query('COMMIT');
          } catch (txErr) {
            await client.query('ROLLBACK');
            throw txErr;
          } finally {
            client.release();
          }
          await saveReferencePrices(pool, listings);
        }

        await new Promise((r) => setTimeout(r, 2000));
      } catch (err: any) {
        if (err.message?.includes("429")) {
          consecutiveRateLimits++;
        }
      }
    }

    if (totalApiCalls % 10 === 0) {
      options.onProgress?.(`Covert outputs: ${totalApiCalls}/${maxCalls} calls, ${totalInserted} listings`);
    }
  }

  return { apiCalls: totalApiCalls, inserted: totalInserted };
}

/**
 * Verify that listings used in top profitable trade-ups still exist on CSFloat.
 * Instead of checking each listing individually (expensive), re-fetches the skin's
 * cheapest listings per condition and removes our stored listings that no longer appear.
 *
 * Each skin+condition = 1 API call. We batch by skin to check all conditions at once.
 */
export async function verifyTopTradeUpListings(
  pool: pg.Pool,
  options: {
    apiKey: string;
    topN?: number;
    maxCalls?: number;
    onProgress?: (msg: string) => void;
  }
): Promise<{ apiCalls: number; removed: number; verified: number }> {
  const topN = options.topN ?? 100;
  const maxCalls = options.maxCalls ?? 80;

  // Get unique listing IDs from top profitable trade-ups
  const { rows: inputListings } = await pool.query(`
    SELECT DISTINCT i.listing_id, i.skin_name, l.skin_id, l.float_value
    FROM trade_up_inputs i
    JOIN trade_ups t ON i.trade_up_id = t.id
    JOIN listings l ON i.listing_id = l.id
    WHERE t.profit_cents > 0
    ORDER BY t.profit_cents DESC
    LIMIT $1
  `, [topN * 10]) as { rows: { listing_id: string; skin_name: string; skin_id: string; float_value: number }[] };

  // Group by skin_name to batch API calls
  const bySkin = new Map<string, { skin_id: string; listing_ids: Set<string> }>();
  for (const row of inputListings) {
    let entry = bySkin.get(row.skin_name);
    if (!entry) {
      entry = { skin_id: row.skin_id, listing_ids: new Set() };
      bySkin.set(row.skin_name, entry);
    }
    entry.listing_ids.add(row.listing_id);
  }

  let apiCalls = 0;
  let totalRemoved = 0;
  let totalVerified = 0;

  for (const [skinName, { skin_id, listing_ids }] of bySkin) {
    if (apiCalls >= maxCalls) break;

    // Fetch current cheapest listings for this skin
    try {
      const currentListings = await fetchCSFloatListings({
        skinName: skinName,
        sortBy: "lowest_price",
        limit: 50,
        apiKey: options.apiKey,
      });
      apiCalls++;

      const currentIds = new Set(currentListings.map(l => l.id));

      // Also update/insert current listings while we're at it
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const listing of currentListings) {
          if (listing.type !== "buy_now") continue;
          if (isListingTooOld(listing.created_at)) continue;
          const resolvedSkinId = await findSkinId(pool, listing.item.market_hash_name);
          if (!resolvedSkinId) continue;
          const isStattrak = listing.item.market_hash_name.toLowerCase().includes("stattrak");
          await client.query(`
            INSERT INTO listings (id, skin_id, price_cents, float_value, paint_seed, stattrak, created_at, source, listing_type)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'csfloat', $8)
            ON CONFLICT (id) DO UPDATE SET
              skin_id = $2, price_cents = $3, float_value = $4, paint_seed = $5, stattrak = $6, created_at = $7, source = 'csfloat', listing_type = $8
          `, [
            listing.id,
            resolvedSkinId,
            listing.price,
            listing.item.float_value,
            listing.item.paint_seed ?? null,
            isStattrak ? 1 : 0,
            listing.created_at,
            listing.type,
          ]);
        }
        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }
      await saveReferencePrices(pool, currentListings);

      // Remove our stored listings that didn't appear in the fresh fetch
      let skinRemoved = 0;
      const deletedIds: string[] = [];
      for (const listingId of listing_ids) {
        if (!currentIds.has(listingId)) {
          await pool.query("DELETE FROM listings WHERE id = $1", [listingId]);
          deletedIds.push(listingId);
          skinRemoved++;
        }
      }
      if (deletedIds.length > 0) {
        await cascadeTradeUpStatuses(pool, deletedIds);
      }
      totalRemoved += skinRemoved;
      totalVerified += listing_ids.size - skinRemoved;

      if (skinRemoved > 0) {
        console.log(`    ${skinName}: ${skinRemoved} sold/removed, ${listing_ids.size - skinRemoved} still live`);
      }

      await new Promise(r => setTimeout(r, 2000));
    } catch (err: any) {
      if (err.status === 429 || err.message?.includes("429")) {
        console.log(`    Rate limited during verification, stopping`);
        break;
      }
    }

    if (apiCalls % 10 === 0) {
      options.onProgress?.(`Verifying: ${apiCalls}/${maxCalls} calls, ${totalRemoved} removed`);
    }
  }

  return { apiCalls, removed: totalRemoved, verified: totalVerified };
}
