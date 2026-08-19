/**
 * Shared infinite-scroll gating for the console board and skins index.
 *
 * The Express per-IP limiter (`server/index.ts`) answers 429 with
 * "Too many requests, please try again later." A sentinel that stays on
 * screen used to tight-loop that. Callers must: refuse loadMore while a
 * request is in flight, stop when a page comes back short, and back off
 * exponentially on 429 instead of retrying immediately.
 */

export const RATE_LIMIT_MESSAGE = "Too many requests, please try again later.";
export const SLOW_DOWN_COPY = "Slow down — try again in a moment.";

const BACKOFF_MS = 2_000;
const BACKOFF_CAP_MS = 32_000;

export class RateLimitError extends Error {
  readonly status = 429;
  constructor(message = RATE_LIMIT_MESSAGE) {
    super(message);
    this.name = "RateLimitError";
  }
}

export function isRateLimitError(err: unknown): boolean {
  if (err instanceof RateLimitError) return true;
  if (!(err instanceof Error)) return false;
  return err.name === "RateLimitError" || /too many requests/i.test(err.message);
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

export function backoffMs(attempt: number): number {
  const exp = Math.max(0, Math.min(attempt, 4));
  return Math.min(BACKOFF_CAP_MS, BACKOFF_MS * 2 ** exp);
}

export function applyRateLimit(attempt: number, now: number): { attempt: number; backoffUntil: number } {
  return { attempt: attempt + 1, backoffUntil: now + backoffMs(attempt) };
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

type JsonResponse = {
  status: number;
  ok: boolean;
  json: () => Promise<unknown>;
};

export async function readPagedJson<T>(res: JsonResponse): Promise<T> {
  const body = await res.json().catch(() => null);
  if (isRateLimited(res.status, body)) {
    throw new RateLimitError(messageFrom(body));
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return body as T;
}
