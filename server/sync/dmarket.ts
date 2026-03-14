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

import Database from "better-sqlite3";
import nacl from "tweetnacl";

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
  db: Database.Database,
  skinName: string,
  options: { maxListings?: number } = {}
): Promise<number> {
  const maxListings = options.maxListings ?? 100;

  // Resolve skin_id from name
  const skin = db.prepare(
    "SELECT id FROM skins WHERE name = ? AND stattrak = 0 LIMIT 1"
  ).get(skinName) as { id: string } | undefined;
  if (!skin) return 0;

  const { items } = await fetchDMarketListings(skinName, { limit: maxListings });
  if (items.length === 0) return 0;

  // Also look up the StatTrak variant for this skin
  const stSkin = db.prepare(
    "SELECT id FROM skins WHERE name = ? AND stattrak = 1 LIMIT 1"
  ).get(`StatTrak™ ${skinName}`) as { id: string } | undefined;

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO listings (id, skin_id, price_cents, float_value, paint_seed, stattrak, created_at, source, listing_type, phase)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), 'dmarket', 'buy_now', ?)
  `);

  let count = 0;
  const insertAll = db.transaction(() => {
    for (const item of items) {
      if (!item.extra?.floatValue && item.extra?.floatValue !== 0) continue;
      const priceCents = parseInt(item.price?.USD ?? "0", 10);
      if (priceCents <= 0) continue;

      // Skip Souvenir items — can't be used in trade-ups, different pricing
      const isSouvenir = item.title.includes("Souvenir") || item.extra?.category === "souvenir";
      if (isSouvenir) continue;

      // DMarket indicates StatTrak via title prefix AND extra.category
      const isStatTrak = item.title.includes("StatTrak") || item.extra?.category === "stattrak™";
      if (isStatTrak) {
        // Store StatTrak item against ST skin ID (if it exists)
        if (!stSkin) continue;
        upsert.run(
          `dmarket:${item.itemId}`,
          stSkin.id,
          priceCents,
          item.extra.floatValue,
          item.extra.paintSeed ?? null,
          1,
          item.extra.phase ?? null
        );
      } else {
        upsert.run(
          `dmarket:${item.itemId}`,
          skin.id,
          priceCents,
          item.extra.floatValue,
          item.extra.paintSeed ?? null,
          0,
          item.extra.phase ?? null
        );
      }
      count++;
    }
  });
  insertAll();

  return count;
}

/**
 * Sync DMarket listings for all skins of a given rarity.
 * Iterates through skins, fetching listings for each.
 */
export async function syncDMarketListingsForRarity(
  db: Database.Database,
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
  const allSkins = db.prepare(`
    SELECT s.name, COUNT(l.id) as listing_count
    FROM skins s
    LEFT JOIN listings l ON s.id = l.skin_id AND l.source = 'dmarket' AND l.listing_type = 'buy_now'
    WHERE s.rarity = ? AND s.stattrak = 0
    GROUP BY s.id
    ORDER BY listing_count ASC
    LIMIT ?
  `).all(rarity, maxSkins * 2) as { name: string; listing_count: number }[];

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
      const count = await syncDMarketListingsForSkin(db, skin.name, { maxListings });
      listingsInserted += count;
      skinsChecked++;
      options.onProgress?.(`DMarket: ${skin.name} → ${count} listings (${skinsChecked}/${sorted.length})`);
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
  db: Database.Database,
  options: {
    maxChecks?: number;
    onProgress?: (msg: string) => void;
  } = {}
): Promise<{ checked: number; removed: number }> {
  const maxChecks = options.maxChecks ?? 20;

  // Get skin names that have DMarket listings, oldest-checked first
  const skins = db.prepare(`
    SELECT DISTINCT s.name, MIN(COALESCE(l.staleness_checked_at, '2000-01-01')) as oldest_check
    FROM listings l
    JOIN skins s ON l.skin_id = s.id
    WHERE l.source = 'dmarket'
    GROUP BY s.name
    ORDER BY oldest_check ASC
    LIMIT ?
  `).all(maxChecks) as { name: string }[];

  let checked = 0;
  let removed = 0;

  for (const skin of skins) {
    try {
      const { items } = await fetchDMarketListings(skin.name, { limit: 100 });
      const activeIds = new Set(items.map(i => `dmarket:${i.itemId}`));

      // Get our stored DMarket listings for this skin
      const stored = db.prepare(`
        SELECT l.id FROM listings l
        JOIN skins s ON l.skin_id = s.id
        WHERE s.name = ? AND l.source = 'dmarket'
      `).all(skin.name) as { id: string }[];

      const toRemove = stored.filter(s => !activeIds.has(s.id));
      if (toRemove.length > 0) {
        const del = db.prepare("DELETE FROM listings WHERE id = ?");
        for (const r of toRemove) del.run(r.id);
        removed += toRemove.length;
      }

      // Also insert any new listings we didn't have
      const skinRow = db.prepare("SELECT id FROM skins WHERE name = ? AND stattrak = 0 LIMIT 1").get(skin.name) as { id: string } | undefined;
      const stSkinRow = db.prepare("SELECT id FROM skins WHERE name = ? AND stattrak = 1 LIMIT 1").get(`StatTrak™ ${skin.name}`) as { id: string } | undefined;
      if (skinRow || stSkinRow) {
        const upsert = db.prepare(`
          INSERT OR REPLACE INTO listings (id, skin_id, price_cents, float_value, paint_seed, stattrak, created_at, source, listing_type, phase, staleness_checked_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'), 'dmarket', 'buy_now', ?, datetime('now'))
        `);
        for (const item of items) {
          if (!item.extra?.floatValue && item.extra?.floatValue !== 0) continue;
          const priceCents = parseInt(item.price?.USD ?? "0", 10);
          if (priceCents <= 0) continue;
          const isSouvenir = item.title.includes("Souvenir") || item.extra?.category === "souvenir";
          if (isSouvenir) continue;
          const isStatTrak = item.title.includes("StatTrak") || item.extra?.category === "stattrak™";
          const targetSkin = isStatTrak ? stSkinRow : skinRow;
          if (!targetSkin) continue;
          upsert.run(
            `dmarket:${item.itemId}`,
            targetSkin.id,
            priceCents,
            item.extra.floatValue,
            item.extra.paintSeed ?? null,
            isStatTrak ? 1 : 0,
            item.extra.phase ?? null
          );
        }
      }

      // Mark all this skin's DMarket listings as checked
      db.prepare(`
        UPDATE listings SET staleness_checked_at = datetime('now')
        WHERE id IN (SELECT l.id FROM listings l JOIN skins s ON l.skin_id = s.id WHERE s.name = ? AND l.source = 'dmarket')
      `).run(skin.name);

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
