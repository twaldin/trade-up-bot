// Browser-side referral attribution. Captures ?ref on load, persists it, and builds
// Steam auth links that carry the stored ref so creator attribution reaches the server
// (the /auth/steam redirect otherwise drops the page's query string).
import { sanitizeRef, steamAuthUrl } from "../../shared/ref.js";

const REF_KEY = "tub_ref";

/** Read ?ref from the current URL and persist it (last-touch wins). Safe to call on every load. */
export function captureRefFromUrl(): void {
  if (typeof window === "undefined") return;
  const ref = sanitizeRef(new URLSearchParams(window.location.search).get("ref"));
  if (ref) {
    try {
      window.localStorage.setItem(REF_KEY, ref);
    } catch {
      // storage blocked (private mode / disabled) — attribution is best-effort
    }
  }
}

/** The persisted ref code, or null. */
export function getStoredRef(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sanitizeRef(window.localStorage.getItem(REF_KEY));
  } catch {
    return null;
  }
}

/** The ref present in the current URL, or null. */
function urlRef(): string | null {
  if (typeof window === "undefined") return null;
  return sanitizeRef(new URLSearchParams(window.location.search).get("ref"));
}

/**
 * Steam auth href carrying the ref so attribution survives the OpenID redirect.
 * Falls back to the live URL ref so a landing visit (/page?ref=x) is never stale even
 * before captureRefFromUrl() has persisted it.
 */
export function authHref(returnTo?: string): string {
  return steamAuthUrl(returnTo, getStoredRef() ?? urlRef());
}
