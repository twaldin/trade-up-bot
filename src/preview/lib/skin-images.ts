/** Cached name → Steam / stored image_url. Never fetches ByMykel JSON. */

import { toSlug } from "../../../shared/slugs.js";

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

/**
 * Every market hash name contains " | ", so a render key cannot join on it.
 * NUL cannot appear in a skin name, which makes the round trip lossless.
 */
const FACE_KEY_SEP = "\u0000";

/** Bound on the og:image fallback when the batch faces endpoint is missing. */
export const FACE_SCRAPE_LIMIT = 48;

/** Faces never hold the board: the whole lookup is abandoned after this. */
export const FACE_TIMEOUT_MS = 2000;

export function faceCacheKey(names: string[]): string {
  return [...new Set(names.filter(Boolean))].sort().join(FACE_KEY_SEP);
}

export function namesFromCacheKey(key: string): string[] {
  return key.split(FACE_KEY_SEP).filter(Boolean);
}

export function facesRequestUrl(names: string[]): string {
  return `/api/preview/faces?names=${encodeURIComponent(namesFromCacheKey(faceCacheKey(names)).join("||"))}`;
}

function extractStoredImage(html: string): string | null {
  const og = html.match(/property="og:image"\s+content="([^"]+)"/) ?? html.match(/content="([^"]+)"\s+property="og:image"/);
  const url = og?.[1] ?? null;
  if (!url || isBlockedCatalogUrl(url)) return null;
  return url;
}

/**
 * Dev-only mirror of the live skin page, read for its og:image when the host
 * predates `/api/preview/faces`. It cannot point at `/skins/:slug` any more —
 * that path is the console itself now, and would return the app shell.
 */
export function skinPagePath(name: string): string {
  return `/__face/${toSlug(name)}`;
}

/**
 * Faces are decoration, so the whole lookup runs under one deadline: a host
 * without /api/preview/faces falls back to scraping skin pages, and a hung
 * scrape must never outlive the board's patience. Whatever reached the cache
 * before the deadline is kept; the rest render as placeholders.
 */
export async function loadFaces(
  names: string[],
  cache: FaceMap,
  fetchFn: typeof fetch = fetch,
  timeoutMs: number = FACE_TIMEOUT_MS,
): Promise<FaceMap> {
  const missing = namesFromCacheKey(faceCacheKey(names)).filter((name) => !cache.has(name));
  if (missing.length === 0) return cache;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    void fillFaces(missing, cache, fetchFn).then(
      () => { clearTimeout(timer); resolve(); },
      () => { clearTimeout(timer); resolve(); },
    );
  });
  return cache;
}

async function fillFaces(missing: string[], cache: FaceMap, fetchFn: typeof fetch): Promise<void> {
  let facesMissing = false;
  try {
    const res = await fetchFn(facesRequestUrl(missing), { credentials: "include" });
    const type = res.headers.get("content-type") ?? "";
    if (res.status === 404 || type.includes("text/html")) {
      facesMissing = true;
    } else if (res.ok && !type.includes("text/html")) {
      const data = (await res.json()) as { faces?: Record<string, string | null> };
      if (data.faces) rememberFaces(cache, data.faces);
    }
  } catch {
    facesMissing = true;
  }

  const stillMissing = missing.filter((name) => !cache.has(name));
  if (facesMissing && stillMissing.length > 0) {
    // Degraded path for hosts that predate /api/preview/faces: scrape og:image
    // one page at a time, bounded so a grid view cannot fan out unbounded.
    await Promise.all(stillMissing.slice(0, FACE_SCRAPE_LIMIT).map(async (name) => {
      try {
        const res = await fetchFn(skinPagePath(name), { credentials: "include" });
        const type = res.headers.get("content-type") ?? "";
        if (!listSurvivesFaceError(res.status, type)) return;
        if (res.status === 404) return;
        if (!type.includes("text/html")) return;
        const url = extractStoredImage(await res.text());
        if (url) rememberFaces(cache, { [name]: url });
      } catch {
        // HTML 404 / network — keep the list.
      }
    }));
  }
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
