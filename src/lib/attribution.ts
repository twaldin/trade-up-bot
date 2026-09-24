// Ad attribution persistence. The landing URL's UTM params, gclid, and fbclid are stored on
// arrival and survive in-app navigation and later untagged visits; a new tagged landing
// (a fresh ad click) replaces the whole touch. Off entirely while no tracker is configured.
import {
  ATTRIBUTION_URL_PARAMS,
  cleanAttributionValue,
  fbcFromFbclid,
  sanitizeAttribution,
  type Attribution,
} from "../../shared/tracking.js";
import { clientTracking } from "./tracking-config.js";

const STORAGE_KEY = "tub_attribution";
// Matches the gclid / fbclid attribution windows.
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

export function attributionFromSearch(search: string, nowMs: number): Attribution | null {
  const params = new URLSearchParams(search);
  const touch: Attribution = {};
  for (const key of ATTRIBUTION_URL_PARAMS) {
    const value = cleanAttributionValue(params.get(key));
    if (value) touch[key] = value;
  }
  if (Object.keys(touch).length === 0) return null;
  if (touch.fbclid) touch.fbc = fbcFromFbclid(touch.fbclid, nowMs);
  return touch;
}

/** Call on every page load; only a tagged landing writes. */
export function captureAttributionFromUrl(nowMs: number = Date.now()): void {
  if (typeof window === "undefined" || !clientTracking().enabled) return;
  const touch = attributionFromSearch(window.location.search, nowMs);
  if (!touch) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ touch, captured_at: nowMs }));
  } catch {
    // Storage blocked — attribution is best-effort.
  }
}

export function storedAttribution(nowMs: number = Date.now()): Attribution {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const capturedAt: unknown = Reflect.get(parsed, "captured_at");
    if (typeof capturedAt !== "number" || nowMs - capturedAt > MAX_AGE_MS) return {};
    return sanitizeAttribution(Reflect.get(parsed, "touch"));
  } catch {
    return {};
  }
}

export function cookieValue(cookies: string, name: string): string | null {
  for (const part of cookies.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

/** `_ga` = GA1.1.<client id> */
export function gaClientIdFromCookie(value: string | null): string | null {
  const match = value?.match(/^GA\d\.\d+\.(\d+\.\d+)$/);
  return match ? match[1] : null;
}

/** `_ga_<container>` = GS1.1.<session id>.… or GS2.1.s<session id>$… */
export function gaSessionIdFromCookie(value: string | null): string | null {
  const match = value?.match(/^GS1\.\d+\.(\d+)\./) ?? value?.match(/^GS2\.\d+\.s(\d+)/);
  return match ? match[1] : null;
}

/** Stored landing touch plus the Pixel/GA cookies, for checkout_start and the purchase. */
export function checkoutAttribution(nowMs: number = Date.now()): Attribution {
  const tracking = clientTracking();
  if (typeof window === "undefined" || !tracking.enabled) return {};
  const out: Attribution = { ...storedAttribution(nowMs) };
  const cookies = typeof document !== "undefined" ? document.cookie : "";
  const fbp = cookieValue(cookies, "_fbp");
  if (fbp) out.fbp = fbp;
  const fbc = cookieValue(cookies, "_fbc");
  if (fbc) out.fbc = fbc;
  const clientId = gaClientIdFromCookie(cookieValue(cookies, "_ga"));
  if (clientId) out.ga_client_id = clientId;
  if (tracking.ga4MeasurementId) {
    const sessionId = gaSessionIdFromCookie(cookieValue(cookies, `_ga_${tracking.ga4MeasurementId.slice(2)}`));
    if (sessionId) out.ga_session_id = sessionId;
  }
  return sanitizeAttribution(out);
}
