import Database from "better-sqlite3";
import { initDb, setSyncMeta } from "./db.js";
import { RARITY_ORDER } from "../shared/types.js";

const COLLECTIONS_URL = "https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/collections.json";
const SKINS_URL = "https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/skins_not_grouped.json";

// ByMykel API types
interface RawCollection {
  id: string;
  name: string;
  image: string;
  contains: { id: string; name: string; rarity: { name: string } }[];
}

interface RawSkin {
  id: string;
  skin_id: string; // Base skin ID without wear suffix
  name: string; // Includes condition, e.g., "AK-47 | Redline (Field-Tested)"
  weapon?: { name: string };
  min_float: number | null;
  max_float: number | null;
  rarity: { name: string };
  stattrak: boolean;
  souvenir: boolean;
  image: string | null;
  market_hash_name?: string;
  wear?: { name: string };
}

// Normalize rarity names from ByMykel to our standard names
function normalizeRarity(raw: string): string {
  const map: Record<string, string> = {
    "Consumer Grade": "Consumer Grade",
    "Industrial Grade": "Industrial Grade",
    "Mil-Spec Grade": "Mil-Spec",
    "Mil-Spec": "Mil-Spec",
    Restricted: "Restricted",
    Classified: "Classified",
    Covert: "Covert",
    Extraordinary: "Extraordinary",
    Contraband: "Contraband",
  };
  return map[raw] ?? raw;
}

export async function syncSkinData(db: Database.Database) {
  console.log("Fetching collections...");
  const collectionsRes = await fetch(COLLECTIONS_URL);
  const collections: RawCollection[] = await collectionsRes.json();
  console.log(`  Got ${collections.length} collections`);

  console.log("Fetching skins...");
  const skinsRes = await fetch(SKINS_URL);
  const skins: RawSkin[] = await skinsRes.json();
  console.log(`  Got ${skins.length} skin entries (with wear variants)`);

  // Insert collections
  const insertCollection = db.prepare(
    "INSERT OR REPLACE INTO collections (id, name, image_url) VALUES (?, ?, ?)"
  );
  const insertCollections = db.transaction((cols: RawCollection[]) => {
    for (const c of cols) {
      insertCollection.run(c.id, c.name, c.image ?? null);
    }
  });
  insertCollections(collections);
  console.log(`  Inserted ${collections.length} collections`);

  // Deduplicate skins by skin_id (each skin has multiple entries per wear)
  const skinMap = new Map<string, RawSkin>();
  for (const s of skins) {
    if (!skinMap.has(s.skin_id)) {
      skinMap.set(s.skin_id, s);
    }
  }
  console.log(`  ${skinMap.size} unique skins after dedup`);

  // Insert skins
  const insertSkin = db.prepare(`
    INSERT OR REPLACE INTO skins (id, name, weapon, min_float, max_float, rarity, stattrak, souvenir, image_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let skinCount = 0;
  const insertSkins = db.transaction(() => {
    for (const [skinId, s] of skinMap) {
      const weapon = s.weapon?.name ?? s.name.split(" | ")[0] ?? "Unknown";
      const rarity = normalizeRarity(s.rarity.name);

      // Skip skins without a known rarity tier (agents, stickers, etc.)
      if (!(rarity in RARITY_ORDER) && rarity !== "Contraband") continue;

      // Strip condition from name: "AK-47 | Redline (Field-Tested)" -> "AK-47 | Redline"
      const baseName = s.name.replace(/\s*\([^)]+\)\s*$/, "").trim();

      insertSkin.run(
        skinId,
        baseName,
        weapon,
        s.min_float ?? 0.0,
        s.max_float ?? 1.0,
        rarity,
        s.stattrak ? 1 : 0,
        s.souvenir ? 1 : 0,
        s.image ?? null
      );
      skinCount++;
    }
  });
  insertSkins();
  console.log(`  Inserted ${skinCount} skins`);

  // Build skin_collections from collections.json "contains" array
  const insertSkinCollection = db.prepare(
    "INSERT OR IGNORE INTO skin_collections (skin_id, collection_id) VALUES (?, ?)"
  );

  let linkCount = 0;
  const insertLinks = db.transaction(() => {
    for (const col of collections) {
      if (!col.contains) continue;
      for (const item of col.contains) {
        // The contains array uses the base skin_id (e.g., "skin-bc677a3996cc")
        // Check if this skin exists in our DB
        const exists = db.prepare("SELECT 1 FROM skins WHERE id = ?").get(item.id);
        if (exists) {
          insertSkinCollection.run(item.id, col.id);
          linkCount++;
        }
      }
    }
  });
  insertLinks();
  console.log(`  Inserted ${linkCount} collection links`);

  setSyncMeta(db, "last_skin_sync", new Date().toISOString());
}

// CSFloat listing fetcher
const CSFLOAT_BASE = "https://csfloat.com/api/v1";

interface CSFloatListing {
  id: string;
  type: string; // "buy_now" or "auction"
  price: number; // cents
  item: {
    market_hash_name: string;
    float_value: number;
    paint_seed: number;
    stickers?: unknown[];
  };
  reference?: {
    base_price: number; // CSFloat's estimated market price in cents
    predicted_price: number;
    float_factor: number;
    quantity: number;
    last_updated: string;
  };
  created_at: string;
}

interface CSFloatResponse {
  data: CSFloatListing[];
}

export async function fetchCSFloatListings(
  options: {
    skinName?: string;
    rarity?: string;
    minPrice?: number;
    maxPrice?: number;
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

// Resolve a CSFloat listing's skin to our DB skin ID
function findSkinId(
  db: Database.Database,
  marketHashName: string
): string | null {
  // market_hash_name is like "AK-47 | Redline (Field-Tested)" or "StatTrak™ AK-47 | Redline (Field-Tested)"
  // Our skin name is like "AK-47 | Redline" or "StatTrak™ AK-47 | Redline"
  const baseName = marketHashName.replace(/\s*\([^)]+\)\s*$/, "").trim();
  const row = db
    .prepare("SELECT id FROM skins WHERE name = ? LIMIT 1")
    .get(baseName) as { id: string } | undefined;

  if (row) return row.id;

  // Try stripping the star prefix for knives/gloves
  const noStar = baseName.replace(/^★\s*/, "").trim();
  if (noStar !== baseName) {
    const row2 = db
      .prepare("SELECT id FROM skins WHERE name = ? LIMIT 1")
      .get(noStar) as { id: string } | undefined;
    return row2?.id ?? null;
  }

  return null;
}

// Extract and save CSFloat reference prices from listing responses
// These come free with every listing API call — CSFloat's own market estimates
function saveReferencePrice(db: Database.Database, listing: CSFloatListing) {
  if (!listing.reference?.base_price || listing.reference.base_price <= 0) return;

  const condMatch = listing.item.market_hash_name.match(
    /\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)$/
  );
  if (!condMatch) return;

  const condition = condMatch[1];
  const skinName = listing.item.market_hash_name.replace(/\s*\([^)]+\)\s*$/, "").trim();
  const priceCents = listing.reference.base_price;
  const qty = listing.reference.quantity ?? 0;

  db.prepare(`
    INSERT OR REPLACE INTO price_data (skin_name, condition, avg_price_cents, median_price_cents, min_price_cents, volume, source, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'csfloat_ref', datetime('now'))
  `).run(skinName, condition, priceCents, priceCents, priceCents, qty);
}

function saveReferencePrices(db: Database.Database, listings: CSFloatListing[]) {
  // Only save one reference per skin+condition (they're all the same within a condition)
  const seen = new Set<string>();
  for (const listing of listings) {
    if (!listing.reference?.base_price) continue;
    const key = listing.item.market_hash_name;
    if (seen.has(key)) continue;
    seen.add(key);
    saveReferencePrice(db, listing);
  }
}

export async function syncListingsForRarity(
  db: Database.Database,
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

  const insertListing = db.prepare(`
    INSERT OR REPLACE INTO listings (id, skin_id, price_cents, float_value, paint_seed, stattrak, created_at, source, listing_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'csfloat', ?)
  `);

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

      const insertBatch = db.transaction((batch: CSFloatListing[]) => {
        for (const listing of batch) {
          if (seenIds.has(listing.id)) continue;
          seenIds.add(listing.id);

          // Skip auctions — only use buy_now for reliable pricing
          if (listing.type !== "buy_now") continue;

          const skinId = findSkinId(db, listing.item.market_hash_name);
          if (!skinId) continue;

          const isStattrak = listing.item.market_hash_name
            .toLowerCase()
            .includes("stattrak");
          insertListing.run(
            listing.id,
            skinId,
            listing.price,
            listing.item.float_value,
            listing.item.paint_seed ?? null,
            isStattrak ? 1 : 0,
            listing.created_at,
            listing.type
          );
          totalInserted++;
        }
      });

      insertBatch(listings);
      saveReferencePrices(db, listings);

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
  db: Database.Database,
  rarity: string,
  options: { apiKey?: string; pages?: number } = {}
) {
  return syncListingsForRarity(db, rarity, {
    ...options,
    sortBy: "most_recent",
    pages: options.pages ?? 10,
  });
}

// ─── Targeted Per-Skin Fetching ──────────────────────────────────────────────

const CONDITIONS_LIST = [
  { name: "Factory New", min: 0.0, max: 0.07 },
  { name: "Minimal Wear", min: 0.07, max: 0.15 },
  { name: "Field-Tested", min: 0.15, max: 0.38 },
  { name: "Well-Worn", min: 0.38, max: 0.45 },
  { name: "Battle-Scarred", min: 0.45, max: 1.0 },
];

/**
 * Determine which conditions are valid for a skin based on its float range.
 */
export function getValidConditions(
  minFloat: number,
  maxFloat: number
): string[] {
  return CONDITIONS_LIST
    .filter((c) => minFloat < c.max && maxFloat > c.min)
    .map((c) => c.name);
}

interface SkinCoverageInfo {
  id: string;
  name: string;
  rarity: string;
  min_float: number;
  max_float: number;
  listing_count: number;
  condition_count: number;
}

/**
 * Find skins that need more listing coverage.
 * Returns skins with fewer than `minListings` total listings or fewer than
 * `minConditions` conditions covered, prioritized by least coverage.
 */
export function getSkinsNeedingCoverage(
  db: Database.Database,
  rarity: string,
  options: { minListings?: number; minConditions?: number; limit?: number } = {}
): SkinCoverageInfo[] {
  const minListings = options.minListings ?? 5;
  const minConditions = options.minConditions ?? 3;
  const limit = options.limit ?? 100;

  return db.prepare(`
    SELECT
      s.id, s.name, s.rarity, s.min_float, s.max_float,
      COUNT(l.id) as listing_count,
      COUNT(DISTINCT CASE
        WHEN l.float_value < 0.07 THEN 'FN'
        WHEN l.float_value < 0.15 THEN 'MW'
        WHEN l.float_value < 0.38 THEN 'FT'
        WHEN l.float_value < 0.45 THEN 'WW'
        ELSE 'BS'
      END) as condition_count
    FROM skins s
    LEFT JOIN listings l ON s.id = l.skin_id
    WHERE s.rarity = ? AND s.stattrak = 0
    GROUP BY s.id
    HAVING listing_count < ? OR condition_count < ?
    ORDER BY listing_count ASC, condition_count ASC
    LIMIT ?
  `).all(rarity, minListings, minConditions, limit) as SkinCoverageInfo[];
}

/**
 * Fetch listings for a specific skin across all valid conditions.
 * Uses market_hash_name search: "AK-47 | Redline (Field-Tested)"
 * Returns number of API calls used and listings inserted.
 */
export async function syncListingsForSkin(
  db: Database.Database,
  skin: { id: string; name: string; min_float: number; max_float: number },
  options: { apiKey?: string; conditions?: string[] } = {}
): Promise<{ apiCalls: number; inserted: number }> {
  const conditions = options.conditions ?? getValidConditions(skin.min_float, skin.max_float);

  const insertListing = db.prepare(`
    INSERT OR REPLACE INTO listings (id, skin_id, price_cents, float_value, paint_seed, stattrak, created_at, source, listing_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'csfloat', ?)
  `);

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

      const insertBatch = db.transaction((batch: CSFloatListing[]) => {
        for (const listing of batch) {
          if (listing.type !== "buy_now") continue;
          const isStattrak = listing.item.market_hash_name.toLowerCase().includes("stattrak");
          insertListing.run(
            listing.id,
            skin.id,
            listing.price,
            listing.item.float_value,
            listing.item.paint_seed ?? null,
            isStattrak ? 1 : 0,
            listing.created_at,
            listing.type
          );
          totalInserted++;
        }
      });
      insertBatch(listings);
      saveReferencePrices(db, listings);

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
  db: Database.Database,
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
      const count = await syncListingsForRarity(db, rarity, {
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

// ─── CSFloat Sale History ────────────────────────────────────────────────────

interface CSFloatSaleEntry {
  id: string;
  created_at: string;
  type: string;
  price: number;
  state: string;
  reference?: {
    base_price: number;
    predicted_price: number;
    float_factor: number;
    quantity: number;
    last_updated: string;
  };
  item: {
    asset_id: string;
    market_hash_name: string;
    float_value: number;
    paint_seed?: number;
    is_stattrak: boolean;
    rarity: number;
  };
}

/**
 * Fetch sale history for a specific skin+condition from CSFloat.
 * Endpoint: GET /api/v1/history/{market_hash_name}/sales
 * Returns ~40 recent sales. CF-cached so repeat calls are free.
 */
async function fetchSaleHistory(
  marketHashName: string,
  apiKey: string
): Promise<CSFloatSaleEntry[]> {
  const url = `${CSFLOAT_BASE}/history/${encodeURIComponent(marketHashName)}/sales`;
  const res = await fetch(url, {
    headers: {
      Authorization: apiKey,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    if (res.status === 429) {
      const reset = res.headers.get("x-ratelimit-reset");
      throw Object.assign(new Error(`CSFloat API error: 429`), {
        status: 429,
        retryInfo: { reset },
      });
    }
    throw new Error(`CSFloat history API error: ${res.status}`);
  }

  const data: CSFloatSaleEntry[] = await res.json();
  return data;
}

const CONDITION_FROM_FLOAT: { name: string; min: number; max: number }[] = [
  { name: "Factory New", min: 0.0, max: 0.07 },
  { name: "Minimal Wear", min: 0.07, max: 0.15 },
  { name: "Field-Tested", min: 0.15, max: 0.38 },
  { name: "Well-Worn", min: 0.38, max: 0.45 },
  { name: "Battle-Scarred", min: 0.45, max: 1.0 },
];

/**
 * Sync sale history for Covert skins (trade-up outputs).
 * Fetches recent sales from CSFloat for each skin+condition, stores in sale_history,
 * and updates price_data with median sale prices (source='csfloat_sales').
 */
export async function syncSaleHistory(
  db: Database.Database,
  options: {
    apiKey: string;
    onProgress?: (msg: string) => void;
    maxCalls?: number;
  }
): Promise<{ fetched: number; sales: number; pricesUpdated: number }> {
  // Get all Covert skins that are actual trade-up outputs
  const skins = db.prepare(`
    SELECT DISTINCT s.name, s.min_float, s.max_float
    FROM skins s
    JOIN skin_collections sc ON s.id = sc.skin_id
    WHERE s.rarity = 'Covert' AND s.stattrak = 0
      AND sc.collection_id IN (
        SELECT DISTINCT sc2.collection_id
        FROM skins s2
        JOIN skin_collections sc2 ON s2.id = sc2.skin_id
        WHERE s2.rarity = 'Classified'
      )
    ORDER BY s.name
  `).all() as { name: string; min_float: number; max_float: number }[];

  // Build list of skin+condition pairs
  const pairs: { skinName: string; condition: string; marketHashName: string }[] = [];
  for (const skin of skins) {
    for (const cond of CONDITION_FROM_FLOAT) {
      if (skin.min_float >= cond.max || skin.max_float <= cond.min) continue;
      pairs.push({
        skinName: skin.name,
        condition: cond.name,
        marketHashName: `${skin.name} (${cond.name})`,
      });
    }
  }

  // Check which pairs already have recent sale history (less than 6h old)
  const recentlyFetched = new Set<string>();
  const recentRows = db.prepare(`
    SELECT DISTINCT skin_name, condition FROM sale_history
    WHERE sold_at > datetime('now', '-6 hours') AND source = 'csfloat'
  `).all() as { skin_name: string; condition: string }[];
  for (const r of recentRows) recentlyFetched.add(`${r.skin_name}:${r.condition}`);

  const toFetch = pairs.filter(
    (p) => !recentlyFetched.has(`${p.skinName}:${p.condition}`)
  );

  const maxCalls = options.maxCalls ?? toFetch.length;
  const limited = toFetch.slice(0, maxCalls);

  console.log(
    `  Sale history: ${pairs.length} total pairs, ${recentlyFetched.size} recent, ${limited.length} to fetch`
  );

  const insertSale = db.prepare(`
    INSERT OR IGNORE INTO sale_history (id, skin_name, condition, price_cents, float_value, sold_at, source)
    VALUES (?, ?, ?, ?, ?, ?, 'csfloat')
  `);

  const insertPrice = db.prepare(`
    INSERT OR REPLACE INTO price_data (skin_name, condition, avg_price_cents, median_price_cents, min_price_cents, volume, source, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'csfloat_sales', datetime('now'))
  `);

  let totalFetched = 0;
  let totalSales = 0;
  let pricesUpdated = 0;

  let consecutiveRateLimits = 0;

  for (const pair of limited) {
    if (consecutiveRateLimits >= 2) {
      console.log(`  Bailing out — hit ${consecutiveRateLimits} consecutive rate limits, API quota likely exhausted`);
      break;
    }

    try {
      let sales: CSFloatSaleEntry[];
      let retries = 0;
      while (true) {
        try {
          sales = await fetchSaleHistory(pair.marketHashName, options.apiKey);
          consecutiveRateLimits = 0; // Reset on success
          break;
        } catch (err: any) {
          if (err.status === 429 && retries < 1) {
            const delay = 15000;
            console.log(`    Rate limited, waiting 15s...`);
            await new Promise((r) => setTimeout(r, delay));
            retries++;
          } else if (err.status === 429) {
            consecutiveRateLimits++;
            throw err;
          } else {
            throw err;
          }
        }
      }

      totalFetched++;

      if (sales.length === 0) {
        // Throttle between requests
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }

      // Store individual sales
      const storeSales = db.transaction(() => {
        for (const sale of sales) {
          if (sale.state !== "sold") continue;
          if (sale.item.is_stattrak) continue;

          const condition = pair.condition;
          insertSale.run(
            sale.id,
            pair.skinName,
            condition,
            sale.price,
            sale.item.float_value,
            sale.created_at
          );
          totalSales++;
        }
      });
      storeSales();

      // Also save reference price if available (comes free with history)
      if (sales[0]?.reference?.base_price) {
        db.prepare(`
          INSERT OR REPLACE INTO price_data (skin_name, condition, avg_price_cents, median_price_cents, min_price_cents, volume, source, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'csfloat_ref', datetime('now'))
        `).run(
          pair.skinName,
          pair.condition,
          sales[0].reference.base_price,
          sales[0].reference.base_price,
          sales[0].reference.base_price,
          sales[0].reference.quantity ?? 0
        );
      }

      // Calculate median sale price and store in price_data
      const validPrices = sales
        .filter((s) => s.state === "sold" && !s.item.is_stattrak)
        .map((s) => s.price)
        .sort((a, b) => a - b);

      if (validPrices.length >= 2) {
        const median =
          validPrices.length % 2 === 0
            ? Math.round(
                (validPrices[validPrices.length / 2 - 1] +
                  validPrices[validPrices.length / 2]) /
                  2
              )
            : validPrices[Math.floor(validPrices.length / 2)];
        const avg = Math.round(
          validPrices.reduce((s, p) => s + p, 0) / validPrices.length
        );
        const min = validPrices[0];

        insertPrice.run(
          pair.skinName,
          pair.condition,
          avg,
          median,
          min,
          validPrices.length
        );
        pricesUpdated++;
      }

      if (totalFetched % 25 === 0) {
        const msg = `Sale history: ${totalFetched}/${limited.length} fetched, ${totalSales} sales, ${pricesUpdated} prices`;
        options.onProgress?.(msg);
        console.log(`  ${msg}`);
      }

      // Throttle between requests (CF caches responses, but be respectful)
      await new Promise((r) => setTimeout(r, 1500));
    } catch (err: any) {
      console.log(`    Error fetching ${pair.marketHashName}: ${err.message}`);
      // Don't let one error stop everything
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  const finalMsg = `Sale history complete: ${totalFetched} fetched, ${totalSales} sales stored, ${pricesUpdated} prices updated`;
  options.onProgress?.(finalMsg);
  console.log(`  ${finalMsg}`);

  return { fetched: totalFetched, sales: totalSales, pricesUpdated };
}

/**
 * Sync sale history for Classified skins (trade-up inputs for classified→covert).
 * These need accurate pricing so we know the true cost of each trade-up.
 * Prioritizes skins WITHOUT csfloat_sales data first.
 */
export async function syncClassifiedSaleHistory(
  db: Database.Database,
  options: {
    apiKey: string;
    onProgress?: (msg: string) => void;
    maxCalls?: number;
  }
): Promise<{ fetched: number; sales: number; pricesUpdated: number }> {
  // Get all Classified skins that are trade-up inputs
  const skins = db.prepare(`
    SELECT DISTINCT s.name, s.min_float, s.max_float
    FROM skins s
    WHERE s.rarity = 'Classified' AND s.stattrak = 0
    ORDER BY s.name
  `).all() as { name: string; min_float: number; max_float: number }[];

  // Build list of skin+condition pairs
  const pairs: { skinName: string; condition: string; marketHashName: string }[] = [];
  for (const skin of skins) {
    for (const cond of CONDITION_FROM_FLOAT) {
      if (skin.min_float >= cond.max || skin.max_float <= cond.min) continue;
      pairs.push({
        skinName: skin.name,
        condition: cond.name,
        marketHashName: `${skin.name} (${cond.name})`,
      });
    }
  }

  // Skip recently fetched (6h window)
  const recentlyFetched = new Set<string>();
  const recentRows = db.prepare(`
    SELECT DISTINCT skin_name, condition FROM sale_history
    WHERE sold_at > datetime('now', '-6 hours') AND source = 'csfloat'
  `).all() as { skin_name: string; condition: string }[];
  for (const r of recentRows) recentlyFetched.add(`${r.skin_name}:${r.condition}`);

  // Check which pairs already have csfloat_sales data
  const hasSalesPrice = new Set<string>();
  const salesRows = db.prepare(`
    SELECT skin_name, condition FROM price_data WHERE source = 'csfloat_sales'
  `).all() as { skin_name: string; condition: string }[];
  for (const r of salesRows) hasSalesPrice.add(`${r.skin_name}:${r.condition}`);

  const toFetch = pairs.filter(
    (p) => !recentlyFetched.has(`${p.skinName}:${p.condition}`)
  );

  // Prioritize: skins WITHOUT csfloat_sales data first
  toFetch.sort((a, b) => {
    const aHas = hasSalesPrice.has(`${a.skinName}:${a.condition}`) ? 1 : 0;
    const bHas = hasSalesPrice.has(`${b.skinName}:${b.condition}`) ? 1 : 0;
    return aHas - bHas;
  });

  const maxCalls = options.maxCalls ?? toFetch.length;
  const limited = toFetch.slice(0, maxCalls);

  console.log(
    `  Classified sale history: ${pairs.length} total pairs, ${recentlyFetched.size} recent, ${hasSalesPrice.size} with sales data, ${limited.length} to fetch`
  );

  const insertSale = db.prepare(`
    INSERT OR IGNORE INTO sale_history (id, skin_name, condition, price_cents, float_value, sold_at, source)
    VALUES (?, ?, ?, ?, ?, ?, 'csfloat')
  `);

  const insertPrice = db.prepare(`
    INSERT OR REPLACE INTO price_data (skin_name, condition, avg_price_cents, median_price_cents, min_price_cents, volume, source, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'csfloat_sales', datetime('now'))
  `);

  let totalFetched = 0;
  let totalSales = 0;
  let pricesUpdated = 0;
  let consecutiveRateLimits = 0;

  for (const pair of limited) {
    if (consecutiveRateLimits >= 2) {
      console.log(`  Bailing — ${consecutiveRateLimits} consecutive rate limits`);
      break;
    }

    try {
      let sales: CSFloatSaleEntry[];
      let retries = 0;
      while (true) {
        try {
          sales = await fetchSaleHistory(pair.marketHashName, options.apiKey);
          consecutiveRateLimits = 0;
          break;
        } catch (err: any) {
          if (err.status === 429 && retries < 1) {
            console.log(`    Rate limited, waiting 15s...`);
            await new Promise((r) => setTimeout(r, 15000));
            retries++;
          } else if (err.status === 429) {
            consecutiveRateLimits++;
            throw err;
          } else {
            throw err;
          }
        }
      }

      totalFetched++;

      if (sales.length === 0) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }

      // Store individual sales
      const storeSales = db.transaction(() => {
        for (const sale of sales) {
          if (sale.state !== "sold") continue;
          if (sale.item.is_stattrak) continue;
          insertSale.run(
            sale.id, pair.skinName, pair.condition,
            sale.price, sale.item.float_value, sale.created_at
          );
          totalSales++;
        }
      });
      storeSales();

      // Save reference price if available
      if (sales[0]?.reference?.base_price) {
        db.prepare(`
          INSERT OR REPLACE INTO price_data (skin_name, condition, avg_price_cents, median_price_cents, min_price_cents, volume, source, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'csfloat_ref', datetime('now'))
        `).run(
          pair.skinName, pair.condition,
          sales[0].reference.base_price, sales[0].reference.base_price, sales[0].reference.base_price,
          sales[0].reference.quantity ?? 0
        );
      }

      // Calculate median sale price
      const validPrices = sales
        .filter(s => s.state === "sold" && !s.item.is_stattrak)
        .map(s => s.price)
        .sort((a, b) => a - b);

      if (validPrices.length >= 2) {
        const median = validPrices.length % 2 === 0
          ? Math.round((validPrices[validPrices.length / 2 - 1] + validPrices[validPrices.length / 2]) / 2)
          : validPrices[Math.floor(validPrices.length / 2)];
        const avg = Math.round(validPrices.reduce((s, p) => s + p, 0) / validPrices.length);
        const min = validPrices[0];

        insertPrice.run(pair.skinName, pair.condition, avg, median, min, validPrices.length);
        pricesUpdated++;
      }

      if (totalFetched % 10 === 0) {
        const msg = `Classified sales: ${totalFetched}/${limited.length}, ${totalSales} sales, ${pricesUpdated} prices`;
        options.onProgress?.(msg);
        console.log(`  ${msg}`);
      }

      await new Promise((r) => setTimeout(r, 1500));
    } catch (err: any) {
      console.log(`    Error fetching ${pair.marketHashName}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  const finalMsg = `Classified sale history: ${totalFetched} fetched, ${totalSales} sales, ${pricesUpdated} prices`;
  options.onProgress?.(finalMsg);
  console.log(`  ${finalMsg}`);

  return { fetched: totalFetched, sales: totalSales, pricesUpdated };
}

/**
 * Fetch low-float Classified listings specifically for FN-targeting trade-ups.
 * Uses lowest_price sort on FN condition to get cheapest FN inputs.
 * Also fetches by most_recent to catch new low-float listings.
 */
export async function syncLowFloatClassifiedListings(
  db: Database.Database,
  options: {
    apiKey: string;
    maxCalls?: number;
    onProgress?: (msg: string) => void;
  }
): Promise<{ apiCalls: number; inserted: number }> {
  const maxCalls = options.maxCalls ?? 30;

  // Get Classified skins that CAN have FN (min_float < 0.07)
  const fnSkins = db.prepare(`
    SELECT s.id, s.name, s.min_float, s.max_float,
           COUNT(CASE WHEN l.float_value < 0.07 THEN 1 END) as fn_listings
    FROM skins s
    LEFT JOIN listings l ON s.id = l.skin_id AND l.stattrak = 0
    WHERE s.rarity = 'Classified' AND s.stattrak = 0
      AND s.min_float < 0.07
    GROUP BY s.id
    ORDER BY fn_listings ASC, s.name
  `).all() as { id: string; name: string; min_float: number; max_float: number; fn_listings: number }[];

  console.log(`  ${fnSkins.length} Classified skins can have FN, fetching low-float listings`);

  const insertListing = db.prepare(`
    INSERT OR REPLACE INTO listings (id, skin_id, price_cents, float_value, paint_seed, stattrak, created_at, source, listing_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'csfloat', ?)
  `);

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

      const insertBatch = db.transaction((batch: CSFloatListing[]) => {
        for (const listing of batch) {
          if (listing.type !== "buy_now") continue;
          const isStattrak = listing.item.market_hash_name.toLowerCase().includes("stattrak");
          if (isStattrak) continue; // Only non-StatTrak for trade-ups
          insertListing.run(
            listing.id, skin.id, listing.price,
            listing.item.float_value, listing.item.paint_seed ?? null,
            0, listing.created_at, listing.type
          );
          totalInserted++;
        }
      });
      insertBatch(listings);
      saveReferencePrices(db, listings);

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

// ─── Smart Per-Skin Classified Fetching ──────────────────────────────────────

// High-value single-Covert collections — their Classified inputs are always worth fetching
const HIGH_VALUE_COLLECTIONS = [
  "The Cobblestone Collection",     // → AWP Dragon Lore
  "The St. Marc Collection",       // → AK-47 Wild Lotus
  "The Norse Collection",          // → AWP Gungnir
  "The Rising Sun Collection",     // → AUG Akihabara Accept
  "The Gods and Monsters Collection", // → AWP Medusa
  "The Havoc Collection",          // → AK-47 X-Ray
  "The Anubis Collection",         // → M4A4 Eye of Horus
];

interface SmartFetchSkin {
  id: string;
  name: string;
  min_float: number;
  max_float: number;
  listing_count: number;
  fn_count: number;
  newest_age_days: number;
  is_high_value: boolean;
  priority: number;
}

/**
 * Smart per-skin classified listing fetch — zero waste.
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
export async function syncSmartClassifiedListings(
  db: Database.Database,
  options: {
    apiKey: string;
    maxCalls?: number;
    onProgress?: (msg: string) => void;
  }
): Promise<{ apiCalls: number; inserted: number; skinsFetched: number; skipped: number }> {
  const maxCalls = options.maxCalls ?? 140;

  // Load last-fetched timestamps
  const { getSyncMeta } = await import("./db.js");
  const rawFetchTimes = getSyncMeta(db, "skin_fetch_times");
  const fetchTimes: Record<string, number> = rawFetchTimes ? JSON.parse(rawFetchTimes) : {};
  const now = Date.now();
  const SIX_HOURS = 6 * 60 * 60 * 1000;

  // Get all Classified skins with coverage stats
  const skins = db.prepare(`
    SELECT s.id, s.name, s.min_float, s.max_float,
      COUNT(l.id) as listing_count,
      COUNT(CASE WHEN l.float_value < 0.07 THEN 1 END) as fn_count,
      COALESCE(MIN(julianday('now') - julianday(l.created_at)), 999) as newest_age_days
    FROM skins s
    LEFT JOIN listings l ON s.id = l.skin_id AND l.stattrak = 0
    WHERE s.rarity = 'Classified' AND s.stattrak = 0
    GROUP BY s.id
  `).all() as { id: string; name: string; min_float: number; max_float: number; listing_count: number; fn_count: number; newest_age_days: number }[];

  // Get high-value collection skin IDs
  const highValueSkinIds = new Set<string>();
  const hvRows = db.prepare(`
    SELECT DISTINCT sc.skin_id
    FROM skin_collections sc
    JOIN collections c ON sc.collection_id = c.id
    JOIN skins s ON sc.skin_id = s.id
    WHERE s.rarity = 'Classified' AND s.stattrak = 0
      AND c.name IN (${HIGH_VALUE_COLLECTIONS.map(() => "?").join(",")})
  `).all(...HIGH_VALUE_COLLECTIONS) as { skin_id: string }[];
  for (const r of hvRows) highValueSkinIds.add(r.skin_id);

  // Build prioritized list
  const candidates: SmartFetchSkin[] = [];
  let skipped = 0;

  for (const skin of skins) {
    // Skip if fetched <6h ago
    if (fetchTimes[skin.id] && (now - fetchTimes[skin.id]) < SIX_HOURS) {
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

    if (skin.listing_count < 3) {
      priority += 500; // Critical: almost no data
    } else if (skin.listing_count < 10) {
      priority += 300; // Under-covered
    } else if (skin.listing_count < 20) {
      priority += 100; // Moderate
    }

    if (canFN && skin.fn_count < 5) {
      priority += 200; // FN-capable but few FN listings
    }

    // Stale refresh: lots of listings but all old
    if (skin.listing_count >= 50 && skin.newest_age_days > 7) {
      priority += 50; // Low priority — just needs a refresh
    }

    // Skip well-covered skins that aren't high-value and aren't stale
    if (priority === 0 && skin.listing_count >= 20) {
      skipped++;
      continue;
    }

    // Even skins with no explicit priority get a baseline if they have < 20 listings
    if (priority === 0) {
      priority = 10;
    }

    candidates.push({
      ...skin,
      is_high_value: isHighValue,
      priority,
    });
  }

  // Sort by priority descending
  candidates.sort((a, b) => b.priority - a.priority);

  console.log(`  Smart fetch: ${candidates.length} candidates, ${skipped} skipped (recent/well-covered), ${highValueSkinIds.size} high-value`);
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
      const result = await syncListingsForSkin(db, skin, {
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
        const msg = `Smart fetch: ${skinsFetched} skins, ${totalApiCalls}/${maxCalls} calls, ${totalInserted} listings`;
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
    const { setSyncMeta } = await import("./db.js");
    setSyncMeta(db, "skin_fetch_times", JSON.stringify(fetchTimes));
  } catch {}

  const msg = `Smart fetch done: ${skinsFetched} skins, ${totalApiCalls} calls, ${totalInserted} listings (${skipped} skipped)`;
  options.onProgress?.(msg);
  console.log(`  ${msg}`);

  return { apiCalls: totalApiCalls, inserted: totalInserted, skinsFetched, skipped };
}

// Fetch reference prices from Skinport (free, no auth)
export async function syncSkinportPrices(db: Database.Database) {
  console.log("Fetching Skinport prices...");

  const res = await fetch(
    "https://api.skinport.com/v1/items?app_id=730&currency=USD",
    { headers: { "Accept-Encoding": "br, gzip" } }
  );

  if (!res.ok) {
    throw new Error(`Skinport API error: ${res.status}`);
  }

  const items: {
    market_hash_name: string;
    suggested_price: number;
    min_price: number | null;
    max_price: number | null;
    mean_price: number | null;
    median_price: number | null;
    quantity: number;
  }[] = await res.json();

  console.log(`  Got ${items.length} items from Skinport`);

  const insertPrice = db.prepare(`
    INSERT OR REPLACE INTO price_data (skin_name, condition, avg_price_cents, median_price_cents, min_price_cents, volume, source, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'skinport', datetime('now'))
  `);

  let count = 0;
  const insertPrices = db.transaction(() => {
    for (const item of items) {
      // Parse condition from market_hash_name
      const condMatch = item.market_hash_name.match(
        /\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)/
      );
      if (!condMatch) continue;

      const condition = condMatch[1];
      const avgCents = Math.round((item.mean_price ?? item.suggested_price ?? 0) * 100);
      const medianCents = Math.round((item.median_price ?? avgCents) * 100);
      const minCents = Math.round((item.min_price ?? 0) * 100);

      // Strip condition from name to get base skin name
      const skinName = item.market_hash_name
        .replace(/\s*\([^)]+\)\s*$/, "")
        .trim();

      insertPrice.run(
        skinName,
        condition,
        avgCents,
        medianCents,
        minCents,
        item.quantity,
      );
      count++;
    }
  });
  insertPrices();

  console.log(`  Inserted ${count} price entries`);
  setSyncMeta(db, "last_price_sync", new Date().toISOString());
}

// ─── Stale Listing Purge ──────────────────────────────────────────────────────

/**
 * Delete listings older than maxAgeDays. Old listings are likely sold/delisted
 * and produce false profitable trade-ups that can't actually be executed.
 */
export function purgeStaleListings(
  db: Database.Database,
  maxAgeDays: number = 14
): { deleted: number } {
  const result = db.prepare(`
    DELETE FROM listings
    WHERE julianday('now') - julianday(created_at) > ?
  `).run(maxAgeDays);
  return { deleted: result.changes };
}

/**
 * Verify that listings used in top profitable trade-ups still exist on CSFloat.
 * Instead of checking each listing individually (expensive), re-fetches the skin's
 * cheapest listings per condition and removes our stored listings that no longer appear.
 *
 * Each skin+condition = 1 API call. We batch by skin to check all conditions at once.
 */
export async function verifyTopTradeUpListings(
  db: Database.Database,
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
  const inputListings = db.prepare(`
    SELECT DISTINCT i.listing_id, i.skin_name, l.skin_id, l.float_value
    FROM trade_up_inputs i
    JOIN trade_ups t ON i.trade_up_id = t.id
    JOIN listings l ON i.listing_id = l.id
    WHERE t.profit_cents > 0
    ORDER BY t.profit_cents DESC
    LIMIT ?
  `).all(topN * 10) as { listing_id: string; skin_name: string; skin_id: string; float_value: number }[];

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
      const insertListing = db.prepare(`
        INSERT OR REPLACE INTO listings (id, skin_id, price_cents, float_value, paint_seed, stattrak, created_at, source, listing_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'csfloat', ?)
      `);
      const insertBatch = db.transaction(() => {
        for (const listing of currentListings) {
          if (listing.type !== "buy_now") continue;
          const resolvedSkinId = findSkinId(db, listing.item.market_hash_name);
          if (!resolvedSkinId) continue;
          const isStattrak = listing.item.market_hash_name.toLowerCase().includes("stattrak");
          insertListing.run(
            listing.id,
            resolvedSkinId,
            listing.price,
            listing.item.float_value,
            listing.item.paint_seed ?? null,
            isStattrak ? 1 : 0,
            listing.created_at,
            listing.type
          );
        }
      });
      insertBatch();
      saveReferencePrices(db, currentListings);

      // Remove our stored listings that didn't appear in the fresh fetch
      let skinRemoved = 0;
      for (const listingId of listing_ids) {
        if (!currentIds.has(listingId)) {
          db.prepare("DELETE FROM listings WHERE id = ?").run(listingId);
          skinRemoved++;
        }
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

// ─── Priority Covert Output Listing Fetch ─────────────────────────────────────

/**
 * Fetch Covert listings for output skins that appear in top profitable trade-ups.
 * This gives us better output pricing data (lowest listing) for the skins that matter most.
 */
export async function syncCovertOutputListings(
  db: Database.Database,
  options: {
    apiKey: string;
    maxCalls?: number;
    onProgress?: (msg: string) => void;
  }
): Promise<{ apiCalls: number; inserted: number }> {
  // Find Covert output skins from top profitable trade-ups, ranked by appearance count
  const topOutputs = db.prepare(`
    SELECT o.skin_name, COUNT(*) as appearances
    FROM trade_up_outcomes o
    JOIN trade_ups t ON o.trade_up_id = t.id
    WHERE t.profit_cents > 0
    GROUP BY o.skin_name
    ORDER BY appearances DESC
    LIMIT 30
  `).all() as { skin_name: string; appearances: number }[];

  if (topOutputs.length === 0) return { apiCalls: 0, inserted: 0 };

  const insertListing = db.prepare(`
    INSERT OR REPLACE INTO listings (id, skin_id, price_cents, float_value, paint_seed, stattrak, created_at, source, listing_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'csfloat', ?)
  `);

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

    // Find the skin ID for this Covert output
    const skin = db.prepare(`
      SELECT id, name, min_float, max_float FROM skins
      WHERE name = ? AND rarity = 'Covert' AND stattrak = 0
      LIMIT 1
    `).get(output.skin_name) as { id: string; name: string; min_float: number; max_float: number } | undefined;
    if (!skin) continue;

    // Check how many recent listings we already have
    const recentCount = (db.prepare(`
      SELECT COUNT(*) as c FROM listings
      WHERE skin_id = ? AND julianday('now') - julianday(created_at) < 3
    `).get(skin.id) as { c: number }).c;
    if (recentCount >= 10) continue; // Already have fresh data

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
          const insertBatch = db.transaction((batch: CSFloatListing[]) => {
            for (const listing of batch) {
              if (listing.type !== "buy_now") continue;
              const isStattrak = listing.item.market_hash_name.toLowerCase().includes("stattrak");
              insertListing.run(
                listing.id,
                skin.id,
                listing.price,
                listing.item.float_value,
                listing.item.paint_seed ?? null,
                isStattrak ? 1 : 0,
                listing.created_at,
                listing.type
              );
              totalInserted++;
            }
          });
          insertBatch(listings);
          saveReferencePrices(db, listings);
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
 * Smart prioritized listing fetch for knife trade-up inputs.
 * Instead of blanket rarity fetches, targets specific Covert skins
 * in collections that have the highest-value knife/glove outputs
 * but the fewest existing listings.
 *
 * Priority score = (output_pool_value / max_output_pool_value) * (1 / (1 + listing_count))
 * This ensures collections with expensive outputs AND sparse listings get fetched first.
 */
export async function syncPrioritizedKnifeInputs(
  db: Database.Database,
  options: {
    apiKey: string;
    maxCalls?: number;
    onProgress?: (msg: string) => void;
  }
): Promise<{ apiCalls: number; inserted: number; collectionsServed: number }> {
  const maxCalls = options.maxCalls ?? 100;

  // Step 1: Get all collections with Covert gun skins and their listing counts.
  // We exclude knives/gloves/etc since those are outputs, not inputs.
  const collectionStats = db.prepare(`
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
    GROUP BY c.id
    ORDER BY total_listings ASC
  `).all() as {
    collection_id: string;
    collection_name: string;
    covert_skins: number;
    total_listings: number;
  }[];

  // Step 2: Get output value estimates per collection from collection_scores
  const scoreMap = new Map<string, number>();
  const scores = db.prepare(`
    SELECT collection_id, max_profit_cents FROM collection_scores
  `).all() as { collection_id: string; max_profit_cents: number }[];
  for (const s of scores) scoreMap.set(s.collection_id, s.max_profit_cents);

  // Step 3: Compute priority scores.
  // Collections with fewer listings get higher priority.
  // Collections with higher profit potential get higher priority.
  // New collections (no score yet) get a baseline priority to encourage exploration.
  const prioritized = collectionStats.map(c => ({
    ...c,
    priority: (1 / (1 + c.total_listings)) * (1 + Math.max(0, scoreMap.get(c.collection_id) ?? 500) / 100),
  }));
  prioritized.sort((a, b) => b.priority - a.priority);

  console.log(`  Prioritized ${prioritized.length} collections for knife input fetch`);
  if (prioritized.length > 0) {
    console.log(`  Top 5: ${prioritized.slice(0, 5).map(c => `${c.collection_name} (${c.total_listings} listings, priority ${c.priority.toFixed(2)})`).join(", ")}`);
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
    const skins = db.prepare(`
      SELECT s.id, s.name, s.min_float, s.max_float
      FROM skins s
      JOIN skin_collections sc ON s.id = sc.skin_id
      WHERE sc.collection_id = ? AND s.rarity = 'Covert' AND s.stattrak = 0
        AND s.weapon NOT LIKE '%Knife%' AND s.weapon NOT LIKE '%Bayonet%'
        AND s.weapon NOT LIKE '%Gloves%' AND s.weapon NOT LIKE '%Wraps%'
        AND s.weapon != 'Shadow Daggers'
    `).all(col.collection_id) as { id: string; name: string; min_float: number; max_float: number }[];

    if (skins.length === 0) continue;

    let colInserted = 0;
    for (const skin of skins) {
      if (totalApiCalls >= maxCalls) break;
      if (consecutiveRateLimits >= 2) break;

      try {
        const result = await syncListingsForSkin(db, skin, {
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
 * Fetch sale history for knife and glove skins from CSFloat.
 * These are trade-up outputs that need accurate pricing.
 */
export async function syncKnifeGloveSaleHistory(
  db: Database.Database,
  options: {
    apiKey: string;
    maxCalls?: number;
    onProgress?: (msg: string) => void;
  }
): Promise<{ fetched: number; sales: number; pricesUpdated: number }> {
  // Get knife/glove skins that we need prices for
  const skins = db.prepare(`
    SELECT DISTINCT s.name, s.min_float, s.max_float
    FROM skins s
    WHERE s.stattrak = 0
      AND (s.weapon LIKE '%Knife%' OR s.weapon LIKE '%Bayonet%'
        OR s.weapon LIKE '%Gloves%' OR s.weapon LIKE '%Wraps%'
        OR s.weapon = 'Shadow Daggers')
    ORDER BY s.name
  `).all() as { name: string; min_float: number; max_float: number }[];

  // Build skin+condition pairs
  const condBounds = [
    { name: "Factory New", min: 0.0, max: 0.07 },
    { name: "Minimal Wear", min: 0.07, max: 0.15 },
    { name: "Field-Tested", min: 0.15, max: 0.38 },
    { name: "Well-Worn", min: 0.38, max: 0.45 },
    { name: "Battle-Scarred", min: 0.45, max: 1.0 },
  ];

  const pairs: { skinName: string; condition: string; marketHashName: string }[] = [];
  for (const skin of skins) {
    for (const cond of condBounds) {
      if (skin.min_float >= cond.max || skin.max_float <= cond.min) continue;
      pairs.push({
        skinName: skin.name,
        condition: cond.name,
        marketHashName: `${skin.name} (${cond.name})`,
      });
    }
  }

  // Skip recently fetched
  const recentlyFetched = new Set<string>();
  const recentRows = db.prepare(`
    SELECT DISTINCT skin_name, condition FROM sale_history
    WHERE sold_at > datetime('now', '-12 hours') AND source = 'csfloat'
  `).all() as { skin_name: string; condition: string }[];
  for (const r of recentRows) recentlyFetched.add(`${r.skin_name}:${r.condition}`);

  // Also check which skins already have good price data from skinport/csfloat_ref
  const hasPrice = new Set<string>();
  const priceRows = db.prepare(`
    SELECT skin_name, condition FROM price_data
    WHERE (source = 'skinport' OR source = 'csfloat_ref') AND median_price_cents > 0
  `).all() as { skin_name: string; condition: string }[];
  for (const r of priceRows) hasPrice.add(`${r.skin_name}:${r.condition}`);

  // Prioritize: skins WITHOUT any price data first, then those with only ref/skinport data
  const toFetch = pairs.filter(
    p => !recentlyFetched.has(`${p.skinName}:${p.condition}`)
  );
  toFetch.sort((a, b) => {
    const aHas = hasPrice.has(`${a.skinName}:${a.condition}`) ? 1 : 0;
    const bHas = hasPrice.has(`${b.skinName}:${b.condition}`) ? 1 : 0;
    return aHas - bHas; // no-price first
  });

  const maxCalls = options.maxCalls ?? toFetch.length;
  const limited = toFetch.slice(0, maxCalls);

  console.log(`  Knife/glove sale history: ${pairs.length} total pairs, ${recentlyFetched.size} recent, ${limited.length} to fetch`);

  const insertSale = db.prepare(`
    INSERT OR IGNORE INTO sale_history (id, skin_name, condition, price_cents, float_value, sold_at, source)
    VALUES (?, ?, ?, ?, ?, ?, 'csfloat')
  `);

  const insertPrice = db.prepare(`
    INSERT OR REPLACE INTO price_data (skin_name, condition, avg_price_cents, median_price_cents, min_price_cents, volume, source, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'csfloat_sales', datetime('now'))
  `);

  let totalFetched = 0;
  let totalSales = 0;
  let pricesUpdated = 0;
  let consecutiveRateLimits = 0;

  for (const pair of limited) {
    if (consecutiveRateLimits >= 2) {
      console.log(`  Bailing — ${consecutiveRateLimits} consecutive rate limits`);
      break;
    }

    try {
      let sales: CSFloatSaleEntry[];
      let retries = 0;
      while (true) {
        try {
          sales = await fetchSaleHistory(pair.marketHashName, options.apiKey);
          consecutiveRateLimits = 0;
          break;
        } catch (err: any) {
          if (err.status === 429 && retries < 1) {
            const delay = 30000;
            console.log(`    Rate limited, waiting 30s...`);
            await new Promise((r) => setTimeout(r, delay));
            retries++;
          } else if (err.status === 429) {
            consecutiveRateLimits++;
            throw err;
          } else {
            throw err;
          }
        }
      }

      totalFetched++;

      if (sales.length === 0) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }

      // Store individual sales
      const storeSales = db.transaction(() => {
        for (const sale of sales) {
          if (sale.state !== "sold") continue;
          if (sale.item.is_stattrak) continue;
          insertSale.run(
            sale.id, pair.skinName, pair.condition,
            sale.price, sale.item.float_value, sale.created_at
          );
          totalSales++;
        }
      });
      storeSales();

      // Save reference price if available
      if (sales[0]?.reference?.base_price) {
        db.prepare(`
          INSERT OR REPLACE INTO price_data (skin_name, condition, avg_price_cents, median_price_cents, min_price_cents, volume, source, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'csfloat_ref', datetime('now'))
        `).run(
          pair.skinName, pair.condition,
          sales[0].reference.base_price, sales[0].reference.base_price, sales[0].reference.base_price,
          sales[0].reference.quantity ?? 0
        );
      }

      // Calculate and store median sale price
      const validPrices = sales
        .filter(s => s.state === "sold" && !s.item.is_stattrak)
        .map(s => s.price)
        .sort((a, b) => a - b);

      if (validPrices.length >= 2) {
        const median = validPrices.length % 2 === 0
          ? Math.round((validPrices[validPrices.length / 2 - 1] + validPrices[validPrices.length / 2]) / 2)
          : validPrices[Math.floor(validPrices.length / 2)];
        const avg = Math.round(validPrices.reduce((s, p) => s + p, 0) / validPrices.length);
        const min = validPrices[0];

        insertPrice.run(pair.skinName, pair.condition, avg, median, min, validPrices.length);
        pricesUpdated++;
      }

      if (totalFetched % 25 === 0) {
        const msg = `Knife/glove sales: ${totalFetched}/${limited.length}, ${totalSales} sales, ${pricesUpdated} prices`;
        options.onProgress?.(msg);
        console.log(`  ${msg}`);
      }

      await new Promise((r) => setTimeout(r, 1500));
    } catch (err: any) {
      console.log(`    Error: ${pair.marketHashName}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  const msg = `Knife/glove sale history: ${totalFetched} fetched, ${totalSales} sales, ${pricesUpdated} prices`;
  options.onProgress?.(msg);
  console.log(`  ${msg}`);

  return { fetched: totalFetched, sales: totalSales, pricesUpdated };
}

// Fetch reference prices from Steam Community Market (free, per-condition)
// Rate limited to ~20 req/min, so this batches with delays
export async function syncSteamMarketPrices(db: Database.Database, options?: {
  onProgress?: (msg: string) => void;
  rarities?: string[];
}) {
  console.log("Fetching Steam Community Market prices...");

  // Default to all tradeable rarities
  const targetRarities = options?.rarities ?? ['Consumer Grade', 'Industrial Grade', 'Mil-Spec', 'Restricted', 'Classified', 'Covert'];
  const skins = db.prepare(`
    SELECT DISTINCT s.name, s.min_float, s.max_float
    FROM skins s
    WHERE s.stattrak = 0
      AND s.rarity IN (${targetRarities.map(() => '?').join(',')})
  `).all(...targetRarities) as { name: string; min_float: number; max_float: number }[];

  const conditions = [
    { name: "Factory New", min: 0.0, max: 0.07 },
    { name: "Minimal Wear", min: 0.07, max: 0.15 },
    { name: "Field-Tested", min: 0.15, max: 0.38 },
    { name: "Well-Worn", min: 0.38, max: 0.45 },
    { name: "Battle-Scarred", min: 0.45, max: 1.0 },
  ];

  // Check which skin+condition pairs already have recent Steam prices (less than 24h old)
  const existingSteam = new Set<string>();
  const existingRows = db.prepare(`
    SELECT skin_name, condition FROM price_data
    WHERE source = 'steam' AND updated_at > datetime('now', '-24 hours')
  `).all() as { skin_name: string; condition: string }[];
  for (const r of existingRows) existingSteam.add(`${r.skin_name}:${r.condition}`);

  // Build list of (skin, condition) pairs to fetch
  const toFetch: { skinName: string; condition: string }[] = [];
  for (const skin of skins) {
    for (const cond of conditions) {
      if (skin.min_float >= cond.max || skin.max_float <= cond.min) continue;
      if (existingSteam.has(`${skin.name}:${cond.name}`)) continue;
      toFetch.push({ skinName: skin.name, condition: cond.name });
    }
  }

  console.log(`  ${toFetch.length} skin+condition pairs to fetch`);

  const insertPrice = db.prepare(`
    INSERT OR REPLACE INTO price_data (skin_name, condition, avg_price_cents, median_price_cents, min_price_cents, volume, source, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'steam', datetime('now'))
  `);

  let fetched = 0;
  let inserted = 0;
  let errors = 0;
  let rateLimitHits = 0;
  let consecutiveRateLimits = 0;
  const BATCH_SIZE = 5; // Small parallel batches
  const BASE_DELAY_MS = 3000; // ~20 req/min to stay under Steam's limit

  for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
    const batch = toFetch.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(async ({ skinName, condition }) => {
        const marketName = encodeURIComponent(`${skinName} (${condition})`);
        const url = `https://steamcommunity.com/market/priceoverview/?appid=730&currency=1&market_hash_name=${marketName}`;
        const res = await fetch(url);
        if (!res.ok) {
          if (res.status === 429) return { rateLimited: true } as any;
          return null;
        }
        const data = await res.json() as {
          success: boolean;
          lowest_price?: string;
          median_price?: string;
          volume?: string;
        };
        if (!data.success) return null;
        return { skinName, condition, data };
      })
    );

    let batchRateLimited = false;
    for (const result of results) {
      fetched++;
      if (result.status !== "fulfilled" || !result.value) { errors++; continue; }
      if (result.value.rateLimited) { rateLimitHits++; batchRateLimited = true; continue; }
      const { skinName, condition, data } = result.value;
      const parseDollars = (s?: string) => {
        if (!s) return 0;
        const num = parseFloat(s.replace(/[^0-9.]/g, ""));
        return isNaN(num) ? 0 : Math.round(num * 100);
      };
      const lowestCents = parseDollars(data.lowest_price);
      const medianCents = parseDollars(data.median_price);
      const volume = parseInt(data.volume ?? "0") || 0;
      if (lowestCents > 0 || medianCents > 0) {
        // avg_price = median sale, median_price = median sale, min_price = lowest listing
        // Don't fall back listing price into median — they mean very different things
        insertPrice.run(skinName, condition, medianCents, medianCents, lowestCents, volume);
        inserted++;
      }
    }

    if (fetched % 100 === 0 || batchRateLimited) {
      const progress = `Steam prices: ${fetched}/${toFetch.length} (${inserted} saved, ${errors} err, ${rateLimitHits} rate-limited)`;
      options?.onProgress?.(progress);
      console.log(`  ${progress}`);
    }

    // Back off on rate limits, otherwise use base delay
    if (batchRateLimited) {
      consecutiveRateLimits++;
      if (consecutiveRateLimits >= 3) {
        console.log(`  Bailing out — ${consecutiveRateLimits} consecutive rate-limited batches`);
        break;
      }
      await new Promise(r => setTimeout(r, 60000)); // 60s backoff
    } else {
      consecutiveRateLimits = 0;
      await new Promise(r => setTimeout(r, BASE_DELAY_MS));
    }
  }

  console.log(`  Steam Market sync complete: ${inserted} prices saved, ${errors} errors out of ${fetched} fetched`);
  setSyncMeta(db, "last_steam_price_sync", new Date().toISOString());
  return { inserted, errors, fetched };
}

// Full sync: skins + prices
export async function fullSync(db: Database.Database) {
  await syncSkinData(db);
  await syncSkinportPrices(db);
  console.log("\nSync complete!");
}

// Run standalone
if (process.argv[1]?.endsWith("sync.ts") || process.argv[1]?.endsWith("sync.js")) {
  const db = initDb();
  fullSync(db)
    .then(() => {
      console.log("Done!");
      process.exit(0);
    })
    .catch((err) => {
      console.error("Sync failed:", err);
      process.exit(1);
    });
}
