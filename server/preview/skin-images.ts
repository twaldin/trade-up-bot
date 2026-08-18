import { indexByMykelSkins, resolveSkinImageUrl } from "../../shared/skin-image.js";

/** Grouped ByMykel catalog — one row per base skin, `image` is a Steam CDN URL. */
export const BYMYKEL_SKINS_URL =
  "https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/skins.json";

const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;

let cachedCatalog: Map<string, string> | null = null;
let cachedAt = 0;

type FetchLike = (input: string) => Promise<Response>;

export async function loadBymykelCatalog(fetchImpl: FetchLike = fetch): Promise<Map<string, string>> {
  if (cachedCatalog && Date.now() - cachedAt < CATALOG_TTL_MS) return cachedCatalog;
  try {
    const res = await fetchImpl(BYMYKEL_SKINS_URL);
    if (!res.ok) return cachedCatalog ?? new Map();
    const rows = await res.json() as { name?: string; image?: string | null }[];
    cachedCatalog = indexByMykelSkins(Array.isArray(rows) ? rows : []);
    cachedAt = Date.now();
    return cachedCatalog;
  } catch {
    return cachedCatalog ?? new Map();
  }
}

/** Stored `skins.image_url` first, then ByMykel/Steam catalog. Never invents a name. */
export async function resolveSkinImageMap(
  names: string[],
  stored: Record<string, string | null>,
  fetchImpl: FetchLike = fetch,
): Promise<Record<string, string | null>> {
  const catalog = await loadBymykelCatalog(fetchImpl);
  const images: Record<string, string | null> = {};
  for (const name of names) {
    images[name] = resolveSkinImageUrl(name, stored[name], catalog);
  }
  return images;
}

/** Test helper — do not call from production routes. */
export function resetBymykelCatalogCache(): void {
  cachedCatalog = null;
  cachedAt = 0;
}
