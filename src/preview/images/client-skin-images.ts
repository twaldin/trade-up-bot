import { indexByMykelSkins, resolveSkinImageUrl } from "../../../shared/skin-image.js";
import { readJsonIfJson } from "../../../shared/http-json.js";

/** Same ByMykel catalog the preview server uses. Client-only fallback when the API is HTML. */
export const BYMYKEL_SKINS_URL =
  "https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/skins.json";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

let cachedCatalog: Map<string, string> | null = null;

export function resetClientSkinCatalog(): void {
  cachedCatalog = null;
}

async function loadClientCatalog(fetchImpl: FetchLike): Promise<Map<string, string>> {
  if (cachedCatalog) return cachedCatalog;
  try {
    const res = await fetchImpl(BYMYKEL_SKINS_URL);
    const rows = await readJsonIfJson<{ name?: string; image?: string | null }[]>(res);
    cachedCatalog = indexByMykelSkins(Array.isArray(rows) ? rows : []);
    return cachedCatalog;
  } catch {
    return cachedCatalog ?? new Map();
  }
}

/** Stored `/api/skin-images` first; if that route is HTML/missing, ByMykel/Steam. Never throws. */
export async function lookupPreviewSkinImages(
  names: string[],
  fetchImpl: FetchLike = fetch,
): Promise<Map<string, string | null>> {
  const images = new Map<string, string | null>();
  if (names.length === 0) return images;

  try {
    const res = await fetchImpl(`/api/skin-images?names=${encodeURIComponent(names.join("||"))}`, {
      credentials: "include",
    });
    const data = await readJsonIfJson<{ images?: Record<string, string | null> }>(res);
    if (data?.images) {
      for (const name of names) {
        images.set(name, resolveSkinImageUrl(name, data.images[name], new Map()));
      }
    }
  } catch {
    /* SPA HTML or network — fall through to catalog */
  }

  const missing = names.filter(name => !images.get(name));
  if (missing.length === 0) return images;

  const catalog = await loadClientCatalog(fetchImpl);
  for (const name of missing) {
    images.set(name, resolveSkinImageUrl(name, images.get(name), catalog));
  }
  return images;
}
