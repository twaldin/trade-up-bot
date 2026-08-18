import { indexByMykelSkins, resolveSkinImageUrl } from "../../../shared/skin-image.js";
import { readJsonIfJson } from "../../../shared/http-json.js";

/** Compact name→Steam CDN map served by Vite, not the full ByMykel JSON. */
export const PREVIEW_SKIN_CDN_URL = "/preview-skin-cdn.json";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

let cachedCatalog: Map<string, string> | null = null;

export function resetClientSkinCatalog(): void {
  cachedCatalog = null;
}

async function loadStaticCatalog(fetchImpl: FetchLike): Promise<Map<string, string>> {
  if (cachedCatalog) return cachedCatalog;
  try {
    const res = await fetchImpl(PREVIEW_SKIN_CDN_URL);
    const rows = await readJsonIfJson<Record<string, string>>(res);
    cachedCatalog = indexByMykelSkins(
      rows ? Object.entries(rows).map(([name, image]) => ({ name, image })) : [],
    );
    return cachedCatalog;
  } catch {
    return cachedCatalog ?? new Map();
  }
}

/** Stored `/api/skin-images` first; if HTML/missing, the cached CDN map. Never fetches ByMykel. */
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
    /* SPA HTML or network — fall through to static map */
  }

  const missing = names.filter(name => !images.get(name));
  if (missing.length === 0) return images;

  const catalog = await loadStaticCatalog(fetchImpl);
  for (const name of missing) {
    images.set(name, resolveSkinImageUrl(name, images.get(name), catalog));
  }
  return images;
}
