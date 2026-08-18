/** Cached name → Steam / stored image_url. Never fetches ByMykel JSON. */

export const BYMYKEL_URL_RE = /bymykel|CSGO-API/i;

export type FaceMap = Map<string, string>;

export function createFaceCache(): FaceMap {
  return new Map();
}

export function rememberFaces(cache: FaceMap, entries: Record<string, string | null | undefined>): FaceMap {
  for (const [name, url] of Object.entries(entries)) {
    if (!name || !url) continue;
    if (BYMYKEL_URL_RE.test(url)) continue;
    cache.set(name, url);
  }
  return cache;
}

export function faceFor(cache: FaceMap, name: string): string | null {
  return cache.get(name) ?? null;
}

export function isBlockedCatalogUrl(url: string): boolean {
  return BYMYKEL_URL_RE.test(url);
}

/** HTML 404s (faces CDN returning an error page) must not fail the list. */
export function listSurvivesFaceError(status: number, contentType: string | null): boolean {
  const html = (contentType ?? "").toLowerCase().includes("text/html");
  if (status === 404) return true;
  if (html && status >= 400) return true;
  return status < 400;
}

export function facesRequestUrl(names: string[]): string {
  const unique = [...new Set(names.filter(Boolean))].sort();
  return `/api/preview/faces?names=${encodeURIComponent(unique.join("||"))}`;
}

export async function loadFaces(
  names: string[],
  cache: FaceMap,
  fetchFn: typeof fetch = fetch,
): Promise<FaceMap> {
  const missing = names.filter((name) => name && !cache.has(name));
  if (missing.length === 0) return cache;

  try {
    const res = await fetchFn(facesRequestUrl(missing), { credentials: "include" });
    if (res.status === 404) return cache;
    const type = res.headers.get("content-type") ?? "";
    if (!listSurvivesFaceError(res.status, type)) return cache;
    if (!res.ok) return cache;
    if (type.includes("text/html")) return cache;
    const data = (await res.json()) as { faces?: Record<string, string | null> };
    if (data.faces) rememberFaces(cache, data.faces);
  } catch {
    // Missing preview faces route or network — list still renders.
  }
  return cache;
}

export async function hydrateOutcomesIfNeeded<T extends { id: number; outcomes: unknown[] }>(
  tradeUp: T,
  fetchFn: typeof fetch = fetch,
): Promise<T> {
  if (tradeUp.outcomes.length > 0) return tradeUp;
  try {
    const res = await fetchFn(`/api/trade-up/${tradeUp.id}/outcomes`, { credentials: "include" });
    if (!res.ok) return tradeUp;
    const data = (await res.json()) as { outcomes?: T["outcomes"] };
    if (!data.outcomes) return tradeUp;
    return { ...tradeUp, outcomes: data.outcomes };
  } catch {
    return tradeUp;
  }
}
