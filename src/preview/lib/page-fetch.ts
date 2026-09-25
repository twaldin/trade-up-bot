/**
 * Shared infinite-scroll gating for the console board and skins index.
 *
 * The Express per-IP limiters (`server/rate-limits.ts`) answer 429 with a
 * Retry-After header. A sentinel that stays on screen used to tight-loop that.
 * Callers must: refuse loadMore while a request is in flight, stop when the
 * list is exhausted, and wait out a 429 instead of retrying immediately.
 *
 * Browse GETs go through `fetchBrowseJson`, which coalesces identical requests,
 * keeps a short in-memory cache (and the last good copy when a refetch is
 * throttled), and holds every browse request until the server's Retry-After
 * once any of them is throttled — one 429 must not become a burst of them.
 */

export const RATE_LIMIT_MESSAGE = "Too many requests, please try again later.";
export const SLOW_DOWN_COPY = "Too many requests right now. Retrying shortly.";

/** List and detail 429 copy. A known Retry-After names the wait. */
export function rateLimitCopy(retryAfterMs: number | null | undefined): string {
  if (retryAfterMs == null || !Number.isFinite(retryAfterMs)) return SLOW_DOWN_COPY;
  const seconds = Math.max(0, Math.ceil(retryAfterMs / 1000));
  return `Too many requests right now. Retrying in ${seconds}s.`;
}

const BACKOFF_MS = 2_000;
const BACKOFF_CAP_MS = 32_000;
const MIN_WAIT_MS = 1_000;
const JITTER_FRACTION = 0.2;
const JITTER_CAP_MS = 3_000;

export class RateLimitError extends Error {
  readonly status = 429;
  readonly retryAfterMs: number | null;
  constructor(message = RATE_LIMIT_MESSAGE, retryAfterMs: number | null = null) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

export function isRateLimitError(err: unknown): boolean {
  if (err instanceof RateLimitError) return true;
  if (!(err instanceof Error)) return false;
  return err.name === "RateLimitError" || /too many requests/i.test(err.message);
}

export function retryAfterOf(err: unknown): number | null {
  return err instanceof RateLimitError ? err.retryAfterMs : null;
}

export function isAbortError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "name" in err && err.name === "AbortError";
}

export function isRateLimitBody(body: unknown): boolean {
  if (!body || typeof body !== "object" || !("message" in body)) return false;
  const message = body.message;
  return typeof message === "string" && /too many requests/i.test(message);
}

export function isRateLimited(status: number, body: unknown): boolean {
  return status === 429 || isRateLimitBody(body);
}

function messageFrom(body: unknown): string {
  if (body && typeof body === "object" && "message" in body && typeof body.message === "string") {
    return body.message;
  }
  return RATE_LIMIT_MESSAGE;
}

/** Retry-After is delta-seconds or an HTTP date; anything else is ignored. */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds >= 0 ? Math.round(seconds * 1000) : null;
  const at = Date.parse(value);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - now);
}

export function backoffMs(attempt: number): number {
  const exp = Math.max(0, Math.min(attempt, 4));
  return Math.min(BACKOFF_CAP_MS, BACKOFF_MS * 2 ** exp);
}

/**
 * The server's Retry-After wins when it sent one; exponential backoff is only
 * the fallback. Jitter keeps several tabs behind one IP from waking together.
 */
export function rateLimitWaitMs(attempt: number, retryAfterMs: number | null, random?: () => number): number {
  const base = Math.max(MIN_WAIT_MS, retryAfterMs ?? backoffMs(attempt));
  if (!random) return base;
  return base + Math.floor(random() * Math.min(base * JITTER_FRACTION, JITTER_CAP_MS));
}

export function applyRateLimit(
  attempt: number,
  now: number,
  options: { retryAfterMs?: number | null; random?: () => number } = {},
): { attempt: number; backoffUntil: number } {
  return { attempt: attempt + 1, backoffUntil: now + rateLimitWaitMs(attempt, options.retryAfterMs ?? null, options.random) };
}

export function canLoadMore(gate: {
  inFlight: boolean;
  exhausted: boolean;
  backoffUntil: number;
  now: number;
}): boolean {
  if (gate.inFlight || gate.exhausted) return false;
  if (gate.backoffUntil > gate.now) return false;
  return true;
}

/** Empty or short pages mean there is nothing left to ask for. */
export function pageIsShort(received: number, pageSize: number): boolean {
  return received < pageSize;
}

/** Full pages can still be the last one: stop once the pages asked for cover the API total. */
export function reachedTotal(page: number, pageSize: number, total: number | undefined): boolean {
  return typeof total === "number" && Number.isFinite(total) && page * pageSize >= total;
}

/**
 * The trade-ups API drops rows claimed by other users after paging, so a
 * short page is not the end when the server reports how many there are.
 */
export function isExhausted(page: { received: number; pageSize: number; page: number; total?: number }): boolean {
  if (page.received === 0) return true;
  if (typeof page.total === "number" && Number.isFinite(page.total)) return page.page * page.pageSize >= page.total;
  return pageIsShort(page.received, page.pageSize);
}

export interface PageCursor {
  key: string;
  page: number;
  exhausted: boolean;
  /** Bumped to re-request the same page after a 429, instead of skipping it. */
  retry: number;
}

export function startCursor(key: string): PageCursor {
  return { key, page: 1, exhausted: false, retry: 0 };
}

/** A new filter key is a new list: page 1, synchronously, with no stale page in between. */
export function cursorFor(cursor: PageCursor, key: string): PageCursor {
  return cursor.key === key ? cursor : startCursor(key);
}

type JsonResponse = {
  status: number;
  ok: boolean;
  json: () => Promise<unknown>;
  headers?: { get: (name: string) => string | null };
};

/**
 * Calculator evaluate. A 429 from production is plain text, so the status is
 * checked before any JSON parse.
 */
export async function readEvaluationBody(res: JsonResponse): Promise<
  { rateLimited: true; data: null } | { rateLimited: false; data: unknown }
> {
  if (res.status === 429) return { rateLimited: true, data: null };
  const data = await res.json().catch(() => null);
  return { rateLimited: false, data };
}

export async function readPagedJson<T>(res: JsonResponse): Promise<T> {
  const body = await res.json().catch(() => null);
  if (isRateLimited(res.status, body)) {
    throw new RateLimitError(messageFrom(body), parseRetryAfter(res.headers?.get("retry-after")));
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return body as T;
}

/* --------------------------------------------------------- browse fetches */

const DEFAULT_TTL_MS = 60_000;
/** A throttled or offline refetch falls back to a copy at most this old. */
const STALE_ON_ERROR_MS = 10 * 60_000;
const CACHE_CAP = 300;

let heldUntil = 0;
const cache = new Map<string, { at: number; data: unknown }>();
const inflight = new Map<string, { promise: Promise<unknown>; controller: AbortController; waiters: number }>();
const holdListeners = new Set<() => void>();

export function browseHeldUntil(): number {
  return heldUntil;
}

export function holdBrowse(until: number): void {
  if (until <= heldUntil) return;
  heldUntil = until;
  for (const listener of holdListeners) listener();
}

/** A page paused on another fetcher's 429 still has to say it is throttled. */
export function subscribeBrowseHold(listener: () => void): () => void {
  holdListeners.add(listener);
  return () => { holdListeners.delete(listener); };
}

export function resetBrowseFetchState(): void {
  heldUntil = 0;
  cache.clear();
  inflight.clear();
  holdListeners.clear();
}

function abortError(): Error {
  const err = new Error("Aborted");
  err.name = "AbortError";
  return err;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Resolves once no 429 hold is in force. Faces and paging both wait here. */
export async function waitForBrowseHold(signal?: AbortSignal, now: () => number = Date.now): Promise<void> {
  while (heldUntil > now()) {
    await sleep(heldUntil - now(), signal);
  }
  if (signal?.aborted) throw abortError();
}

export type BrowseErrorKind = "aborted" | "throttled" | "failed";

/** A throttle is not "no results": callers render it as a retrying state. */
export function browseErrorKind(err: unknown): BrowseErrorKind {
  if (isAbortError(err)) return "aborted";
  if (isRateLimitError(err)) return "throttled";
  return "failed";
}

/** How long a throttled caller should wait before asking again. */
export function retryDelayMs(now: number = Date.now()): number {
  return Math.max(MIN_WAIT_MS, heldUntil - now);
}

/** Record a 429 seen outside `fetchBrowseJson` (faces, hydration) so paging waits too. */
export function noteRateLimited(retryAfterMs: number | null, now: number = Date.now()): void {
  holdBrowse(now + rateLimitWaitMs(0, retryAfterMs, Math.random));
}

function remember(url: string, at: number, data: unknown): void {
  cache.delete(url);
  cache.set(url, { at, data });
  while (cache.size > CACHE_CAP) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function untilAborted<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
      (err: unknown) => { signal.removeEventListener("abort", onAbort); reject(err); },
    );
  });
}

/** Synchronous read of a fresh cached response, so a revisited page paints without a loading flash. */
export function peekBrowseJson<T>(url: string, ttlMs: number = DEFAULT_TTL_MS, now: number = Date.now()): T | null {
  const hit = cache.get(url);
  if (!hit || now - hit.at >= ttlMs) return null;
  return hit.data as T;
}

export interface BrowseFetchOptions {
  signal?: AbortSignal;
  ttlMs?: number;
  fetchFn?: typeof fetch;
  now?: () => number;
}

export async function fetchBrowseJson<T>(url: string, options: BrowseFetchOptions = {}): Promise<T> {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const fetchFn = options.fetchFn ?? fetch;
  const hit = cache.get(url);
  if (hit && now() - hit.at < ttlMs) return hit.data as T;

  let entry = inflight.get(url);
  if (!entry) {
    const controller = new AbortController();
    const promise = (async () => {
      await waitForBrowseHold(controller.signal, now);
      try {
        const res = await fetchFn(url, { credentials: "include", signal: controller.signal });
        const data = await readPagedJson<unknown>(res);
        remember(url, now(), data);
        return data;
      } catch (err) {
        if (err instanceof RateLimitError) noteRateLimited(err.retryAfterMs, now());
        const stale = cache.get(url);
        const recoverable = err instanceof RateLimitError || err instanceof TypeError;
        if (recoverable && stale && now() - stale.at < STALE_ON_ERROR_MS) return stale.data;
        throw err;
      }
    })();
    const created = { promise, controller, waiters: 0 };
    entry = created;
    inflight.set(url, created);
    const settle = () => { if (inflight.get(url) === created) inflight.delete(url); };
    promise.then(settle, settle);
  }

  const shared = entry;
  shared.waiters += 1;
  try {
    return (await untilAborted(shared.promise, options.signal)) as T;
  } finally {
    shared.waiters -= 1;
    if (shared.waiters === 0 && options.signal?.aborted) {
      if (inflight.get(url) === shared) inflight.delete(url);
      shared.controller.abort();
      shared.promise.catch(() => {});
    }
  }
}
