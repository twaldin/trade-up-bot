/**
 * Board fetch for GET /api/trade-ups.
 *
 * nginx / express-rate-limit often answer 429 with a ~42-byte body and no
 * `trade_ups`. The board must not treat that as an empty filter result.
 */

import type { TradeUp } from "../../shared/types.js";

export const RATE_LIMIT_MESSAGE = "Too many requests, please try again later.";
export const EMPTY_FILTER_COPY = "No trade-ups match these filters.";
export const RATE_LIMIT_COPY = "Slow down — try again in a moment.";
export const LOAD_ERROR_COPY = "Couldn't load trade-ups. Retry.";

const BACKOFF_MS = 2_000;
const BACKOFF_CAP_MS = 32_000;
const DEFAULT_MAX_ATTEMPTS = 5;

export type BoardLoadKind = "ok" | "rate_limited" | "error";

export type BoardEmptyKind =
  | "none"
  | "empty_filter"
  | "rate_limited"
  | "error"
  | "calculating"
  | "fetching";

export interface LimitInfo {
  remaining: number;
  total: number;
  resetIn: number | null;
}

export interface TradeUpsOkPayload {
  trade_ups: TradeUp[];
  total: number;
  total_profitable: number;
  tier?: string;
  signed_in?: boolean;
  claim_limit?: LimitInfo;
  verify_limit?: LimitInfo;
}

export type BoardFetchResult =
  | { kind: "ok"; payload: TradeUpsOkPayload }
  | { kind: "rate_limited" }
  | { kind: "error"; message?: string };

export interface BoardSnapshot {
  tradeUps: TradeUp[];
  total: number;
  totalProfitable: number;
  loadKind: BoardLoadKind;
}

export interface HttpLike {
  status: number;
  ok: boolean;
  body: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isRateLimitBody(body: unknown): boolean {
  if (typeof body === "string") return /too many requests/i.test(body);
  if (!isRecord(body) || !("message" in body)) return false;
  return typeof body.message === "string" && /too many requests/i.test(body.message);
}

export function isRateLimited(status: number, body: unknown): boolean {
  return status === 429 || isRateLimitBody(body);
}

function isLimitInfo(value: unknown): value is LimitInfo {
  if (!isRecord(value)) return false;
  return typeof value.remaining === "number"
    && typeof value.total === "number"
    && (value.resetIn === null || typeof value.resetIn === "number");
}

function isTradeUpList(value: unknown): value is TradeUp[] {
  return Array.isArray(value);
}

function readOkPayload(body: unknown): TradeUpsOkPayload | null {
  if (!isRecord(body)) return null;
  if (!isTradeUpList(body.trade_ups)) return null;
  const total = typeof body.total === "number" ? body.total : body.trade_ups.length;
  const total_profitable = typeof body.total_profitable === "number" ? body.total_profitable : 0;
  const payload: TradeUpsOkPayload = {
    trade_ups: body.trade_ups,
    total,
    total_profitable,
  };
  if (typeof body.tier === "string") payload.tier = body.tier;
  if (typeof body.signed_in === "boolean") payload.signed_in = body.signed_in;
  if (isLimitInfo(body.claim_limit)) payload.claim_limit = body.claim_limit;
  if (isLimitInfo(body.verify_limit)) payload.verify_limit = body.verify_limit;
  return payload;
}

export function parseTradeUpsResponse(status: number, ok: boolean, body: unknown): BoardFetchResult {
  if (isRateLimited(status, body)) return { kind: "rate_limited" };
  if (!ok) return { kind: "error", message: `HTTP ${status}` };
  const payload = readOkPayload(body);
  if (!payload) return { kind: "error", message: "Invalid response" };
  return { kind: "ok", payload };
}

export async function readTradeUpsResponse(res: {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}): Promise<BoardFetchResult> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return parseTradeUpsResponse(res.status, res.ok, body);
}

export function applyBoardFetch(prev: BoardSnapshot, result: BoardFetchResult): BoardSnapshot {
  if (result.kind === "ok") {
    return {
      tradeUps: result.payload.trade_ups,
      total: result.payload.total,
      totalProfitable: result.payload.total_profitable,
      loadKind: "ok",
    };
  }
  return {
    ...prev,
    loadKind: result.kind,
  };
}

export function boardEmptyKind(opts: {
  loading: boolean;
  tradeUps: readonly unknown[];
  loadKind: BoardLoadKind;
  daemonPhase?: string;
}): BoardEmptyKind {
  if (opts.tradeUps.length === 0 && (opts.loadKind === "rate_limited" || opts.loadKind === "error")) {
    return opts.loadKind;
  }
  if (opts.loading) return "none";
  if (opts.tradeUps.length > 0) return "none";
  if (opts.daemonPhase === "calculating") return "calculating";
  if (opts.daemonPhase === "fetching") return "fetching";
  return "empty_filter";
}

export function emptyStateCopy(kind: BoardEmptyKind): string | null {
  if (kind === "empty_filter") return EMPTY_FILTER_COPY;
  if (kind === "rate_limited") return RATE_LIMIT_COPY;
  if (kind === "error") return LOAD_ERROR_COPY;
  return null;
}

export const COLLECTION_EMPTY_COPY = "No trade-ups found involving this collection.";

/** CollectionViewer's notice: a throttle says so, even over last-good rows. */
export function collectionTradeUpsCopy(opts: { loading: boolean; snapshot: BoardSnapshot }): string | null {
  const { loading, snapshot } = opts;
  if (snapshot.loadKind === "rate_limited") return RATE_LIMIT_COPY;
  if (loading) return null;
  if (snapshot.loadKind === "error") return snapshot.tradeUps.length > 0 ? null : LOAD_ERROR_COPY;
  return snapshot.tradeUps.length === 0 ? COLLECTION_EMPTY_COPY : null;
}

export function backoffMs(attempt: number): number {
  const exp = Math.max(0, Math.min(attempt, 4));
  return Math.min(BACKOFF_CAP_MS, BACKOFF_MS * 2 ** exp);
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function runBoardFetchLoop(opts: {
  request: () => Promise<HttpLike>;
  sleep: (ms: number) => Promise<void>;
  signal?: AbortSignal;
  maxAttempts?: number;
  onResult: (result: BoardFetchResult, attempt: number) => void;
}): Promise<BoardFetchResult> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  let last: BoardFetchResult = { kind: "error", message: "No request" };
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (opts.signal?.aborted) {
      throw Object.assign(new Error("Aborted"), { name: "AbortError" });
    }
    const res = await opts.request();
    last = parseTradeUpsResponse(res.status, res.ok, res.body);
    opts.onResult(last, attempt);
    if (last.kind !== "rate_limited") return last;
    if (attempt >= maxAttempts - 1) return last;
    await opts.sleep(backoffMs(attempt));
  }
  return last;
}
