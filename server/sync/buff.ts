/**
 * Buff.market API integration — listing fetch and sale history.
 *
 * Auth: Browser session cookie (read from Redis at runtime).
 * Rate limit: ~15 req/min safe (4s between requests).
 * Prices: USD strings, converted to integer cents.
 *
 * Note: buff.market uses its own goods_id per skin+condition.
 * Mapping loaded from data/cs2-marketplace-ids.json at startup.
 */

const BUFF_API = "https://api.buff.market/api";
const MIN_INTERVAL_MS = 4000; // ~15 req/min

let _lastCallMs = 0;

// ---------- Types ----------

export interface BuffListing {
  id: string;            // e.g. "M1136838760"
  priceCents: number;
  goodsId: number;
  floatValue: number;
  paintSeed: number;
  paintIndex: number;
  stattrak: boolean;
  souvenir: boolean;
  createdAt: number;     // unix timestamp
  marketHashName: string;
}

export interface BuffSale {
  id: string;
  priceCents: number;
  goodsId: number;
  floatValue: number;
  paintSeed: number;
  transactTime: number;  // unix timestamp
  marketHashName: string;
}

export interface BuffPageResult<T> {
  items: T[];
  totalPages: number;
  totalCount: number;
}

// ---------- Rate-limited fetch ----------

async function rateLimitedFetch(url: string, cookie: string): Promise<Response> {
  const now = Date.now();
  const wait = Math.max(0, MIN_INTERVAL_MS - (now - _lastCallMs));
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  _lastCallMs = Date.now();
  return fetch(url, {
    headers: {
      Cookie: cookie,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept: "application/json",
    },
  });
}

// ---------- Response parsing ----------

interface BuffApiResponse {
  code: string;
  data?: {
    items?: any[];
    goods_infos?: Record<string, any>;
    page_num?: number;
    page_size?: number;
    total_count?: number;
    total_page?: number;
  };
  msg?: string;
  error?: string;
}

function parseResponse(json: BuffApiResponse): { ok: boolean; data: BuffApiResponse["data"]; loginRequired: boolean } {
  if (json.code === "OK" && json.data) {
    return { ok: true, data: json.data, loginRequired: false };
  }
  const loginRequired = json.code === "Login Required"
    || json.code === "Captcha Validate Required"
    || json.error?.includes("login")
    || json.code !== "OK";
  return { ok: false, data: undefined, loginRequired };
}

function usdStringToCents(price: string): number {
  const n = parseFloat(price);
  if (isNaN(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

// ---------- Listing fetch ----------

export async function fetchBuffListings(
  goodsId: number,
  page: number,
  cookie: string,
): Promise<BuffPageResult<BuffListing>> {
  const params = new URLSearchParams({
    game: "csgo",
    goods_id: String(goodsId),
    page_num: String(page),
    sort_by: "price.asc",
    _: String(Date.now()),
  });

  const res = await rateLimitedFetch(`${BUFF_API}/market/goods/sell_order?${params}`, cookie);
  if (res.status === 429) throw new Error("Buff 429 rate limited");
  if (!res.ok) throw new Error(`Buff API ${res.status}`);

  const json: BuffApiResponse = await res.json();
  const { ok, data, loginRequired } = parseResponse(json);
  if (loginRequired) throw new Error("Buff login required");
  if (!ok || !data) return { items: [], totalPages: 0, totalCount: 0 };

  const goodsInfos = data.goods_infos ?? {};
  const items: BuffListing[] = [];

  for (const item of data.items ?? []) {
    const priceCents = usdStringToCents(item.price);
    if (priceCents <= 0) continue;

    const assetInfo = item.asset_info;
    if (!assetInfo?.paintwear) continue;
    const floatValue = parseFloat(assetInfo.paintwear);
    if (isNaN(floatValue) || floatValue < 0) continue;

    const goodsInfo = goodsInfos[String(item.goods_id)] ?? {};
    const hashName = goodsInfo.market_hash_name ?? "";
    const isStatTrak = hashName.startsWith("StatTrak™ ");
    const isSouvenir = hashName.startsWith("Souvenir ");

    items.push({
      id: String(item.id),
      priceCents,
      goodsId: item.goods_id,
      floatValue,
      paintSeed: assetInfo.info?.paintseed ?? 0,
      paintIndex: assetInfo.info?.paintindex ?? 0,
      stattrak: isStatTrak,
      souvenir: isSouvenir,
      createdAt: item.created_at ?? 0,
      marketHashName: hashName,
    });
  }

  return {
    items,
    totalPages: data.total_page ?? 0,
    totalCount: data.total_count ?? 0,
  };
}

// ---------- Sale history fetch ----------

export async function fetchBuffSales(
  goodsId: number,
  page: number,
  cookie: string,
): Promise<BuffPageResult<BuffSale>> {
  const params = new URLSearchParams({
    game: "csgo",
    goods_id: String(goodsId),
    page_num: String(page),
    page_size: "10",
  });

  const res = await rateLimitedFetch(`${BUFF_API}/market/goods/bill_order?${params}`, cookie);
  if (res.status === 429) throw new Error("Buff 429 rate limited");
  if (!res.ok) throw new Error(`Buff API ${res.status}`);

  const json: BuffApiResponse = await res.json();
  const { ok, data, loginRequired } = parseResponse(json);
  if (loginRequired) throw new Error("Buff login required");
  if (!ok || !data) return { items: [], totalPages: 0, totalCount: 0 };

  const items: BuffSale[] = [];

  for (const item of data.items ?? []) {
    const priceCents = usdStringToCents(item.price);
    if (priceCents <= 0) continue;

    const floatValue = item.asset_info?.paintwear
      ? parseFloat(item.asset_info.paintwear)
      : NaN;

    const goodsInfo = (data as any).goods_infos?.[String(item.goods_id)] ?? {};
    const hashName = goodsInfo.market_hash_name ?? "";

    // Sale ID from buff is a per-page sequential index (0, 1, 2...) — not globally unique.
    // Compose a unique ID from goods_id + transact_time + price to avoid cross-skin dedup.
    const txTime = item.transact_time ?? item.created_at ?? 0;
    const saleId = `buff:${item.goods_id}:${txTime}:${priceCents}`;

    items.push({
      id: saleId,
      priceCents,
      goodsId: item.goods_id,
      floatValue: isNaN(floatValue) ? -1 : floatValue,
      paintSeed: item.asset_info?.info?.paintseed ?? 0,
      transactTime: txTime,
      marketHashName: hashName,
    });
  }

  return {
    items,
    totalPages: data.total_page ?? 0,
    totalCount: data.total_count ?? 0,
  };
}
