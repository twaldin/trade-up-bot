// Server-side tracker config. Read per call (not at module load) so .env loading order
// never matters, and each tracker needs both its id and its secret to switch on.
import { isValidGa4MeasurementId, isValidMetaPixelId } from "../../shared/tracking.js";
import { hashExternalId } from "./hash.js";

export type TrackingEnv = Readonly<Record<string, string | undefined>>;

export interface Ga4MpConfig {
  measurementId: string;
  apiSecret: string;
  debug: boolean;
}

export interface MetaCapiConfig {
  pixelId: string;
  accessToken: string;
  testEventCode: string | null;
  /** SHA-256 external ids excluded from Meta server events. */
  optOutExternalIds: ReadonlySet<string>;
}

export interface ServerTrackingConfig {
  ga4Mp: Ga4MpConfig | null;
  metaCapi: MetaCapiConfig | null;
}

function read(env: TrackingEnv, key: string): string | null {
  const value = env[key]?.trim();
  return value ? value : null;
}

export interface CapiOptOutParse {
  ids: ReadonlySet<string>;
  ignored: readonly string[];
}

function optOutTokenToHash(token: string): string | null {
  if (/^\d{17}$/.test(token)) return hashExternalId(token);
  const lower = token.toLowerCase();
  if (/^[0-9a-f]{64}$/.test(lower)) return lower;
  return null;
}

/** Hashes and 17-digit SteamID64s. Separators are comma, semicolon, space, tab, or newline. */
export function parseCapiOptOutExternalIds(raw: string | undefined): CapiOptOutParse {
  const ids = new Set<string>();
  const ignored: string[] = [];
  if (!raw) return { ids, ignored };
  for (const part of raw.split(/[,;\s]+/)) {
    const token = part.trim();
    if (!token) continue;
    const hash = optOutTokenToHash(token);
    if (hash) ids.add(hash);
    else ignored.push(token);
  }
  return { ids, ignored };
}

export function capiOptOutExternalIds(raw: string | undefined): ReadonlySet<string> {
  return parseCapiOptOutExternalIds(raw).ids;
}

/** First 8 visible characters plus the entry length. Never the rest of the value. */
export function capiOptOutIgnoredEcho(entry: string): string {
  const visible = entry.replace(/[\u0000-\u001f\u007f]/g, "");
  return `${visible.slice(0, 8)} (len=${entry.length})`;
}

/** One warning per ignored entry. Call once at process start, not on each request. */
export function logCapiOptOutIgnored(env: TrackingEnv = process.env, log: (message: string) => void = console.warn): void {
  for (const entry of parseCapiOptOutExternalIds(env.META_CAPI_OPTOUT_EXTERNAL_IDS).ignored) {
    try { log(`[tracking] META_CAPI_OPTOUT_EXTERNAL_IDS ignored unparseable entry: ${capiOptOutIgnoredEcho(entry)}`); } catch { /* ignore */ }
  }
}

export function isMetaCapiOptedOut(externalIdHash: string | null | undefined, ids: ReadonlySet<string>): boolean {
  if (!externalIdHash) return false;
  return ids.has(externalIdHash.trim().toLowerCase());
}

export function serverTrackingConfig(env: TrackingEnv = process.env): ServerTrackingConfig {
  const measurementId = read(env, "GA4_MEASUREMENT_ID");
  const apiSecret = read(env, "GA4_API_SECRET");
  const pixelId = read(env, "META_PIXEL_ID");
  const accessToken = read(env, "META_CAPI_TOKEN");
  return {
    ga4Mp: isValidGa4MeasurementId(measurementId) && apiSecret
      ? { measurementId, apiSecret, debug: read(env, "GA4_DEBUG_MODE") === "1" }
      : null,
    metaCapi: isValidMetaPixelId(pixelId) && accessToken
      ? {
          pixelId,
          accessToken,
          testEventCode: read(env, "META_TEST_EVENT_CODE"),
          optOutExternalIds: capiOptOutExternalIds(env.META_CAPI_OPTOUT_EXTERNAL_IDS),
        }
      : null,
  };
}

export function serverTrackingEnabled(config: ServerTrackingConfig): boolean {
  return config.ga4Mp !== null || config.metaCapi !== null;
}
