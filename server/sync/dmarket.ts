/**
 * DMarket marketplace integration — listing fetch, staleness check, and buy API.
 *
 * Auth: Ed25519 signing via tweetnacl.
 * Rate limit: 2 RPS for market search, 6 RPS cumulative for other endpoints.
 * Game ID: "a8db" for CS2.
 * Buyer fee: 2.5% (applied at evaluation time, not stored in listing price).
 *
 * Listing IDs stored as "dmarket:<itemId>" to avoid collision with CSFloat UUIDs.
 */

import pg from "pg";
import nacl from "tweetnacl";
import { deleteListings } from "../engine.js";

const DMARKET_API = "https://api.dmarket.com";
const GAME_ID = "a8db"; // CS2

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

function signRequest(method: string, path: string, body: string = ""): {
  "X-Api-Key": string;
  "X-Request-Sign": string;
  "X-Sign-Date": string;
} {
  const publicKey = process.env.DMARKET_PUBLIC_KEY;
  const secretKey = process.env.DMARKET_SECRET_KEY;
  if (!publicKey || !secretKey) throw new Error("Missing DMARKET_PUBLIC_KEY or DMARKET_SECRET_KEY");

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const stringToSign = method + path + body + timestamp;
  const secretBytes = hexToBytes(secretKey);
  const signature = nacl.sign.detached(
    new TextEncoder().encode(stringToSign),
    secretBytes
  );

  return {
    "X-Api-Key": publicKey,
    "X-Request-Sign": `dmar ed25519 ${bytesToHex(signature)}`,
    "X-Sign-Date": timestamp,
  };
}

let _lastCallMs = 0;
const MIN_INTERVAL_MS = 550; // 2 RPS = 500ms, add 50ms buffer

async function rateLimitedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const now = Date.now();
  const wait = Math.max(0, MIN_INTERVAL_MS - (now - _lastCallMs));
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  _lastCallMs = Date.now();
  return fetch(url, options);
}

interface DMarketItem {
  itemId: string;
  title: string;
  price: { USD: string };
  extra: {
    floatValue: number;
    exterior: string;
    paintSeed: number;
    phase?: string;
    inspectInGame?: string;
    category?: string;
    categoryPath?: string;
    name?: string;
  };
  slug?: string;
  createdAt?: number;
  inMarket?: boolean;
}

interface DMarketSearchResponse {
  objects: DMarketItem[];
  total?: { items?: string };
  cursor?: string;
}

/**
 * Search DMarket for listings of a specific skin.
 * Returns up to `limit` listings sorted by price ascending.
 */
export async function fetchDMarketListings(
  skinName: string,
  options: { limit?: number; cursor?: string } = {}
): Promise<{ items: DMarketItem[]; cursor?: string }> {
  const limit = options.limit ?? 100;
  const params = new URLSearchParams({
    gameId: GAME_ID,
    title: skinName,
    limit: String(limit),
    orderBy: "price",
    orderDir: "asc",
    currency: "USD",
  });
  if (options.cursor) params.set("cursor", options.cursor);

  const path = `/exchange/v1/market/items?${params.toString()}`;
  const headers = signRequest("GET", path);

  const res = await rateLimitedFetch(`${DMARKET_API}${path}`, {
    headers: { ...headers, Accept: "application/json" },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 429) throw new Error("DMarket 429 rate limited");
    throw new Error(`DMarket API ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json() as DMarketSearchResponse;
  return { items: data.objects ?? [], cursor: data.cursor };
}

/**
 * Sync DMarket listings for a single skin into the DB.
 * Returns number of listings inserted/updated.
 */
export async function syncDMarketListingsForSkin(
  pool: pg.Pool,
  skinName: string,
  options: { maxListings?: number } = {}
): Promise<number> {
  const maxListings = options.maxListings ?? 100;

  // Resolve skin_id from name
  const { rows: skinRows } = await pool.query(
    "SELECT id FROM skins WHERE name = $1 AND stattrak = 0 LIMIT 1",
    [skinName]
  );
  const skin = skinRows[0] as { id: string } | undefined;
  if (!skin) return 0;

  const { items } = await fetchDMarketListings(skinName, { limit: maxListings });
  if (items.length === 0) return 0;

  // Also look up the StatTrak variant for this skin
  const { rows: stRows } = await pool.query(
    "SELECT id FROM skins WHERE name = $1 AND stattrak = 1 LIMIT 1",
    [`StatTrak™ ${skinName}`]
  );
  const stSkin = stRows[0] as { id: string } | undefined;

  let count = 0;
  // No wrapping transaction — each INSERT is its own implicit transaction.
  // This avoids holding a write lock that blocks the daemon's large transactions.
  for (const item of items) {
    if (!item.extra?.floatValue && item.extra?.floatValue !== 0) continue;
    const priceCents = parseInt(item.price?.USD ?? "0", 10);
    if (priceCents <= 0) continue;

    // Skip Souvenir items — can't be used in trade-ups, different pricing
    const isSouvenir = item.title.includes("Souvenir") || item.extra?.category === "souvenir";
    if (isSouvenir) continue;

    // Verify title matches requested skin — DMarket search is fuzzy and returns
    // partial matches (e.g. searching "Fade" also returns "Amber Fade").
    const cleanTitle = item.title
      .replace(/\s*\((?:Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)\s*$/, "")
      .replace(/^StatTrak™\s+/, "");
    if (cleanTitle !== skinName) continue;

    // DMarket indicates StatTrak via title prefix AND extra.category
    const isStatTrak = item.title.includes("StatTrak") || item.extra?.category === "stattrak™";
    if (isStatTrak) {
      // Store StatTrak item against ST skin ID (if it exists)
      if (!stSkin) continue;
      await pool.query(`
        INSERT INTO listings (id, skin_id, price_cents, float_value, paint_seed, stattrak, created_at, source, listing_type, phase, price_updated_at)
        VALUES ($1, $2, $3, $4, $5, 1, NOW(), 'dmarket', 'buy_now', $6, NOW())
        ON CONFLICT (id) DO UPDATE SET
          skin_id = $2, price_cents = $3, float_value = $4, paint_seed = $5, stattrak = 1, created_at = NOW(), source = 'dmarket', listing_type = 'buy_now', phase = $6, price_updated_at = NOW(), staleness_checked_at = NOW()
      `, [
        `dmarket:${item.itemId}`,
        stSkin.id,
        priceCents,
        item.extra.floatValue,
        item.extra.paintSeed ?? null,
        item.extra.phase ?? null,
      ]);
    } else {
      await pool.query(`
        INSERT INTO listings (id, skin_id, price_cents, float_value, paint_seed, stattrak, created_at, source, listing_type, phase, price_updated_at)
        VALUES ($1, $2, $3, $4, $5, 0, NOW(), 'dmarket', 'buy_now', $6, NOW())
        ON CONFLICT (id) DO UPDATE SET
          skin_id = $2, price_cents = $3, float_value = $4, paint_seed = $5, stattrak = 0, created_at = NOW(), source = 'dmarket', listing_type = 'buy_now', phase = $6, price_updated_at = NOW(), staleness_checked_at = NOW()
      `, [
        `dmarket:${item.itemId}`,
        skin.id,
        priceCents,
        item.extra.floatValue,
        item.extra.paintSeed ?? null,
        item.extra.phase ?? null,
      ]);
    }
    count++;
  }

  return count;
}

/**
 * Sync DMarket listings for all skins of a given rarity.
 * Iterates through skins, fetching listings for each.
 */
export async function syncDMarketListingsForRarity(
  pool: pg.Pool,
  rarity: string,
  options: {
    maxSkinsPerCall?: number;
    maxListingsPerSkin?: number;
    onProgress?: (msg: string) => void;
    prioritySkins?: string[];
  } = {}
): Promise<{ skinsChecked: number; listingsInserted: number }> {
  const maxSkins = options.maxSkinsPerCall ?? 50;
  const maxListings = options.maxListingsPerSkin ?? 100;

  // Get skins to fetch — priority skins first, then by least coverage
  const { rows: allSkins } = await pool.query(`
    SELECT s.name, COUNT(l.id) as listing_count
    FROM skins s
    LEFT JOIN listings l ON s.id = l.skin_id AND l.source = 'dmarket' AND l.listing_type = 'buy_now'
    WHERE s.rarity = $1 AND s.stattrak = 0
    GROUP BY s.id, s.name
    ORDER BY listing_count ASC
    LIMIT $2
  `, [rarity, maxSkins * 2]) as { rows: { name: string; listing_count: string }[] };

  // Put priority skins first
  const prioritySet = new Set(options.prioritySkins ?? []);
  const sorted = [
    ...allSkins.filter(s => prioritySet.has(s.name)),
    ...allSkins.filter(s => !prioritySet.has(s.name)),
  ].slice(0, maxSkins);

  let skinsChecked = 0;
  let listingsInserted = 0;

  for (const skin of sorted) {
    try {
      const count = await syncDMarketListingsForSkin(pool, skin.name, { maxListings });
      listingsInserted += count;
      skinsChecked++;
      options.onProgress?.(`DMarket: ${skin.name} -> ${count} listings (${skinsChecked}/${sorted.length})`);
    } catch (err) {
      if (err instanceof Error && err.message.includes("429")) {
        options.onProgress?.(`DMarket: rate limited after ${skinsChecked} skins`);
        break;
      }
      // Skip individual errors
    }
  }

  return { skinsChecked, listingsInserted };
}

/**
 * Check if DMarket listings are still active by re-querying by skin name.
 * Removes listings that no longer appear in search results.
 */
export async function checkDMarketStaleness(
  pool: pg.Pool,
  options: {
    maxChecks?: number;
    onProgress?: (msg: string) => void;
  } = {}
): Promise<{ checked: number; removed: number }> {
  const maxChecks = options.maxChecks ?? 20;

  // Get skin names that have DMarket listings, oldest-checked first
  const { rows: skinRows } = await pool.query(`
    SELECT DISTINCT s.name, MIN(COALESCE(l.staleness_checked_at, '2000-01-01'::timestamptz)) as oldest_check
    FROM listings l
    JOIN skins s ON l.skin_id = s.id
    WHERE l.source = 'dmarket'
    GROUP BY s.name
    ORDER BY oldest_check ASC
    LIMIT $1
  `, [maxChecks]) as { rows: { name: string }[] };

  let checked = 0;
  let removed = 0;

  for (const skinRow of skinRows) {
    try {
      const { items } = await fetchDMarketListings(skinRow.name, { limit: 100 });
      const activeIds = new Set(items.map(i => `dmarket:${i.itemId}`));

      // Get our stored DMarket listings for this skin
      const { rows: stored } = await pool.query(`
        SELECT l.id FROM listings l
        JOIN skins s ON l.skin_id = s.id
        WHERE s.name = $1 AND l.source = 'dmarket'
      `, [skinRow.name]) as { rows: { id: string }[] };

      const toRemove = stored.filter(s => !activeIds.has(s.id));
      if (toRemove.length > 0) {
        await deleteListings(pool, toRemove.map(r => r.id));
        removed += toRemove.length;
      }

      // Also insert any new listings we didn't have
      const { rows: skinIdRows } = await pool.query("SELECT id FROM skins WHERE name = $1 AND stattrak = 0 LIMIT 1", [skinRow.name]);
      const { rows: stSkinIdRows } = await pool.query("SELECT id FROM skins WHERE name = $1 AND stattrak = 1 LIMIT 1", [`StatTrak™ ${skinRow.name}`]);
      const skinId = skinIdRows[0] as { id: string } | undefined;
      const stSkinId = stSkinIdRows[0] as { id: string } | undefined;

      if (skinId || stSkinId) {
        for (const item of items) {
          if (!item.extra?.floatValue && item.extra?.floatValue !== 0) continue;
          const priceCents = parseInt(item.price?.USD ?? "0", 10);
          if (priceCents <= 0) continue;
          const isSouvenir = item.title.includes("Souvenir") || item.extra?.category === "souvenir";
          if (isSouvenir) continue;
          const isStatTrak = item.title.includes("StatTrak") || item.extra?.category === "stattrak™";
          const targetSkin = isStatTrak ? stSkinId : skinId;
          if (!targetSkin) continue;
          await pool.query(`
            INSERT INTO listings (id, skin_id, price_cents, float_value, paint_seed, stattrak, created_at, source, listing_type, phase, staleness_checked_at, price_updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, NOW(), 'dmarket', 'buy_now', $7, NOW(), NOW())
            ON CONFLICT (id) DO UPDATE SET
              skin_id = $2, price_cents = $3, float_value = $4, paint_seed = $5, stattrak = $6, created_at = NOW(), source = 'dmarket', listing_type = 'buy_now', phase = $7, staleness_checked_at = NOW(), price_updated_at = NOW()
          `, [
            `dmarket:${item.itemId}`,
            targetSkin.id,
            priceCents,
            item.extra.floatValue,
            item.extra.paintSeed ?? null,
            isStatTrak ? 1 : 0,
            item.extra.phase ?? null,
          ]);
        }
      }

      // Mark all this skin's DMarket listings as checked
      await pool.query(`
        UPDATE listings SET staleness_checked_at = NOW()
        WHERE id IN (SELECT l.id FROM listings l JOIN skins s ON l.skin_id = s.id WHERE s.name = $1 AND l.source = 'dmarket')
      `, [skinRow.name]);

      checked++;
    } catch (err) {
      if (err instanceof Error && err.message.includes("429")) break;
    }
  }

  return { checked, removed };
}

export interface DMarketBuyResult {
  success: boolean;
  offerId: string;
  operationId?: string;
  error?: string;
}

/**
 * Purchase a DMarket listing by offer ID.
 * @param itemId The DMarket itemId (without "dmarket:" prefix)
 * @param expectedPriceCents Price safeguard — won't buy if price changed
 */
export async function buyDMarketItem(
  itemId: string,
  expectedPriceCents: number
): Promise<DMarketBuyResult> {
  const body = JSON.stringify({
    Offers: [{
      OfferID: itemId,
      Price: { Amount: String(expectedPriceCents), Currency: "USD" },
      Type: "dmarket",
    }],
  });

  const path = "/exchange/v1/offers-buy";
  const headers = signRequest("POST", path, body);

  const res = await rateLimitedFetch(`${DMARKET_API}${path}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", Accept: "application/json" },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { success: false, offerId: itemId, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
  }

  const data = await res.json() as {
    UnboughtOffers?: { Reason?: string }[];
    Items?: { AssetID?: string }[];
  };
  if (data.UnboughtOffers && data.UnboughtOffers.length > 0) {
    return { success: false, offerId: itemId, error: data.UnboughtOffers[0]?.Reason ?? "Item unavailable" };
  }

  return {
    success: true,
    offerId: itemId,
    operationId: data.Items?.[0]?.AssetID,
  };
}


/** Check if DMarket API keys are configured */
export function isDMarketConfigured(): boolean {
  return !!(process.env.DMARKET_PUBLIC_KEY && process.env.DMARKET_SECRET_KEY);
}
