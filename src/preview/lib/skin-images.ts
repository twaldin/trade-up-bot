/** Cached name → Steam / stored image_url. Never fetches ByMykel JSON. */

import { toSlug } from "../../../shared/slugs.js";
import { parseRetryAfter, waitForBrowseHold } from "./page-fetch.js";

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

/**
 * `/api/preview/faces` keeps only the first 80 names it is sent and drops the
 * rest silently, so a grid is asked for in batches no larger than that.
 */
export const FACE_BATCH_SIZE = 80;

export function faceCacheKey(names: string[]): string {
  return [...new Set(names.filter(Boolean))].sort().join(FACE_KEY_SEP);
}

/** Like `faceCacheKey`, but keeps render order so the first screen is asked for first. */
export function faceOrderKey(names: string[]): string {
  return [...new Set(names.filter(Boolean))].join(FACE_KEY_SEP);
}

export function namesFromCacheKey(key: string): string[] {
  return key.split(FACE_KEY_SEP).filter(Boolean);
}

export function faceBatches(names: string[], size: number = FACE_BATCH_SIZE): string[][] {
  const ordered = namesFromCacheKey(faceOrderKey(names));
  const batches: string[][] = [];
  for (let i = 0; i < ordered.length; i += size) batches.push(ordered.slice(i, i + size));
  return batches;
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
  const missing = namesFromCacheKey(faceOrderKey(names)).filter((name) => !cache.has(name));
  if (missing.length === 0) return cache;
  const inflight = inflightFor(cache);
  const waits = new Set<Promise<void>>();
  const fresh: string[] = [];
  for (const name of missing) {
    const pending = inflight.get(name);
    if (pending) waits.add(pending);
    else fresh.push(name);
  }
  if (fresh.length > 0) {
    const job: Promise<void> = fillFaces(fresh, cache, fetchFn)
      .catch(() => {})
      .finally(() => {
        for (const name of fresh) if (inflight.get(name) === job) inflight.delete(name);
      });
    for (const name of fresh) inflight.set(name, job);
    waits.add(job);
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    void Promise.all(waits).then(() => { clearTimeout(timer); resolve(); });
  });
  return cache;
}

/**
 * A grid re-renders as each page lands; the new render must wait on the batch
 * the previous one already sent rather than ask for the same names again.
 */
const INFLIGHT = new WeakMap<FaceMap, Map<string, Promise<void>>>();

function inflightFor(cache: FaceMap): Map<string, Promise<void>> {
  let inflight = INFLIGHT.get(cache);
  if (!inflight) {
    inflight = new Map();
    INFLIGHT.set(cache, inflight);
  }
  return inflight;
}

/**
 * "missing" means the host has no faces route and the caller should scrape.
 * A 429 is not that: express-rate-limit's body is text/html, and scraping in
 * response would turn one throttled request into up to 48 more.
 */
type FaceBatchOutcome = "ok" | "missing" | "throttled";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

async function readFaceResponse(res: Response, cache: FaceMap): Promise<FaceBatchOutcome> {
  if (res.status === 429) return "throttled";
  const type = res.headers.get("content-type") ?? "";
  if (res.status === 404 || type.includes("text/html")) return "missing";
  if (res.ok) {
    const data = (await res.json()) as { faces?: Record<string, string | null> };
    if (data.faces) rememberFaces(cache, data.faces);
  }
  return "ok";
}

/**
 * One retry after Retry-After. A faces 429 does not take the shared browse
 * hold: that hold is what painted the list throttle notice for a decoration
 * request. Cards keep their placeholder until a face actually arrives.
 */
async function fillFaceBatch(batch: string[], cache: FaceMap, fetchFn: typeof fetch): Promise<FaceBatchOutcome> {
  try {
    await waitForBrowseHold();
    const url = facesRequestUrl(batch);
    let res = await fetchFn(url, { credentials: "include" });
    if (res.status === 429) {
      const wait = parseRetryAfter(res.headers.get("retry-after")) ?? 1000;
      await sleep(wait);
      res = await fetchFn(url, { credentials: "include" });
    }
    return await readFaceResponse(res, cache);
  } catch {
    return "missing";
  }
}

async function fillFaces(missing: string[], cache: FaceMap, fetchFn: typeof fetch): Promise<void> {
  const outcomes = await Promise.all(faceBatches(missing).map((batch) => fillFaceBatch(batch, cache, fetchFn)));
  const facesMissing = outcomes.includes("missing") && !outcomes.includes("throttled");

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
