/**
 * BitSkins API integration — listing search, sale history, skin catalog.
 *
 * Auth: API key via x-apikey header.
 * Rate limit: ~2 RPS (500ms between requests, conservative).
 * Prices: Integer cents (USD) natively.
 * All requests are POST with JSON body (except catalog/insell which are GET).
 */

const BITSKINS_API = "https://api.bitskins.com";
const MIN_INTERVAL_MS = 500; // ~2 RPS

let _lastCallMs = 0;

// ---------- Types ----------

export interface BitskinsCatalogEntry {
  id: number;
  name: string;
  class_id: string;
  suggested_price: number;
}

export interface BitskinsListing {
  id: string;
  priceCents: number;
  skinId: number;
  assetId: string;
  stattrak: boolean;
  marketHashName: string;
  suggestedPrice: number;
  discount: number;
}

export interface BitskinsSale {
  priceCents: number;
  floatValue: number;
  transactTime: number; // unix seconds
  skinId: number;
  marketHashName: string;
}

export interface SearchResult {
  listings: BitskinsListing[];
  total: number;
}

// ---------- Skin name helpers ----------

/** Strip condition suffix from market_hash_name.
 *  "AK-47 | Redline (Field-Tested)" → "AK-47 | Redline" */
export function stripCondition(marketHashName: string): string {
  return marketHashName
    .replace(/\s*\((?:Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)\s*$/, "")
    .trim();
}

/** Extract condition from market_hash_name.
 *  "AK-47 | Redline (Field-Tested)" → "Field-Tested" */
export function extractCondition(marketHashName: string): string | null {
  const match = marketHashName.match(/\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)\s*$/);
  return match ? match[1] : null;
}

/** Check if a skin name is a vanilla knife (★ Name without |) */
export function isVanillaKnife(name: string): boolean {
  return name.startsWith("★") && !name.includes("|");
}

// ---------- Sale ID composition ----------

/** Compose a unique sale ID from skin_id + timestamp + price.
 *  BitSkins sale history doesn't have unique per-sale IDs. */
export function composeSaleId(skinId: number, timestamp: number, priceCents: number): string {
  return `bitskins:${skinId}:${timestamp}:${priceCents}`;
}

// ---------- Response parsing ----------

/** Parse skin catalog array into a Map<name, skinId> */
export function parseSkinCatalog(catalog: BitskinsCatalogEntry[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const entry of catalog) {
    map.set(entry.name, entry.id);
  }
  return map;
}

/** Parse search response into typed listings */
export function parseSearchResponse(raw: {
  counter: { total: number; filtered: number };
  list: any[];
}): SearchResult {
  const listings: BitskinsListing[] = [];
  for (const item of raw.list ?? []) {
    listings.push({
      id: String(item.id),
      priceCents: item.price,
      skinId: item.skin_id,
      assetId: String(item.asset_id ?? ""),
      stattrak: item.ss === 1,
      marketHashName: item.name ?? "",
      suggestedPrice: item.suggested_price ?? 0,
      discount: item.discount ?? 0,
    });
  }
  return { listings, total: raw.counter?.total ?? 0 };
}

/** Parse sale history response into typed sales.
 *  Handles BitSkins API typos: "created_ad" for "created_at", "fload_value" for "float_value" */
export function parseSaleHistory(raw: any[]): BitskinsSale[] {
  const sales: BitskinsSale[] = [];
  for (const item of raw ?? []) {
    const dateStr = item.created_at ?? item.created_ad ?? "";
    const floatVal = item.float_value ?? item.fload_value ?? -1;
    const timestamp = dateStr ? Math.floor(new Date(dateStr).getTime() / 1000) : 0;

    sales.push({
      priceCents: item.price ?? 0,
      floatValue: typeof floatVal === "number" ? floatVal : parseFloat(floatVal) || -1,
      transactTime: timestamp,
      skinId: item.skin_id ?? 0,
      marketHashName: item.name ?? "",
    });
  }
  return sales;
}

// ---------- Rate-limited fetch ----------

async function rateLimitedFetch(url: string, apiKey: string, options: RequestInit = {}): Promise<Response> {
  const now = Date.now();
  const wait = Math.max(0, MIN_INTERVAL_MS - (now - _lastCallMs));
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  _lastCallMs = Date.now();
  return fetch(url, {
    ...options,
    headers: {
      "x-apikey": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.headers ?? {}),
    },
  });
}

// ---------- API functions ----------

/** Fetch the full skin catalog. Called once at startup. */
export async function fetchSkinCatalog(apiKey: string): Promise<BitskinsCatalogEntry[]> {
  const res = await rateLimitedFetch(`${BITSKINS_API}/market/skin/730`, apiKey);
  if (!res.ok) throw new Error(`BitSkins catalog ${res.status}`);
  return await res.json();
}

/** Search listings for a skin_id (paginated, sorted by price ASC). */
export async function searchListings(
  skinId: number,
  apiKey: string,
  options: { limit?: number; offset?: number } = {},
): Promise<SearchResult> {
  const body = {
    limit: options.limit ?? 50,
    offset: options.offset ?? 0,
    order: [{ field: "price", order: "ASC" }],
    where: { skin_id: [skinId] },
  };
  const res = await rateLimitedFetch(`${BITSKINS_API}/market/search/730`, apiKey, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (res.status === 429) throw new Error("BitSkins 429 rate limited");
  if (!res.ok) throw new Error(`BitSkins search ${res.status}`);
  const raw = await res.json();
  return parseSearchResponse(raw);
}

/** Fetch sale history for a skin_id (has float_value per sale). */
export async function fetchSaleHistory(
  skinId: number,
  apiKey: string,
  limit: number = 50,
): Promise<BitskinsSale[]> {
  const body = { app_id: 730, skin_id: skinId, limit };
  const res = await rateLimitedFetch(`${BITSKINS_API}/market/pricing/list`, apiKey, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (res.status === 429) throw new Error("BitSkins 429 rate limited");
  if (!res.ok) throw new Error(`BitSkins pricing ${res.status}`);
  const raw = await res.json();
  return parseSaleHistory(Array.isArray(raw) ? raw : raw.list ?? raw.data ?? []);
}

/** Fetch in-sell summary (all skins with min/max/avg price + quantity). */
export async function fetchInSellSummary(apiKey: string): Promise<{ skin_id: number; name: string; price_min: number; price_max: number; quantity: number }[]> {
  const res = await rateLimitedFetch(`${BITSKINS_API}/market/insell/730`, apiKey);
  if (!res.ok) throw new Error(`BitSkins insell ${res.status}`);
  return await res.json();
}
