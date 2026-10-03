// Values stashed by the head strip script in index.html. The URL no longer has
// auth, lid, eid, session_id, or upgraded by the time React runs, so this module
// does not rewrite history (that would send a second page view).
import { trackAuthReturn } from "./conversions.js";
import { loginEventIdFromSteamId } from "./registration-id.js";

export interface AuthReturnStash {
  auth?: string | null;
  lid?: string | null;
}

export interface AuthReturn {
  auth: "new" | "return";
  lid: string | null;
}

export interface CheckoutReturnStash {
  upgraded?: string | null;
  sessionId?: string | null;
}

export interface CheckoutReturn {
  upgraded: string;
  sessionId: string;
}

declare global {
  interface Window {
    __tubAuthReturn?: AuthReturnStash | null;
    __tubCheckoutReturn?: CheckoutReturnStash | null;
    __tubPageLocation?: string;
  }
}

export function parseAuthReturn(stash: AuthReturnStash | null | undefined): AuthReturn | null {
  if (!stash) return null;
  if (stash.auth !== "new" && stash.auth !== "return") return null;
  const lid = typeof stash.lid === "string" ? stash.lid : null;
  return { auth: stash.auth, lid };
}

function browserWindow(): Window | undefined {
  const scope = globalThis as typeof globalThis & { window?: Window };
  return scope.window;
}

function defaultRead(): AuthReturnStash | null | undefined {
  return browserWindow()?.__tubAuthReturn;
}

function defaultClear(): void {
  const current = browserWindow();
  if (current) current.__tubAuthReturn = null;
}

/** Read the head-script stash once. Does not consult location.search. */
export function consumeAuthReturn(
  read: () => AuthReturnStash | null | undefined = defaultRead,
  clear: () => void = defaultClear,
): AuthReturn | null {
  const parsed = parseAuthReturn(read());
  if (parsed) clear();
  return parsed;
}

function acceptedFlag(payload: unknown): boolean {
  if (typeof payload !== "object" || payload === null) return false;
  const record = payload as Record<string, unknown>;
  return record.accepted === true;
}

/** Ask the server to consume this issued nonce. A second call for the same lid is false. */
export async function acceptIssuedLoginNonce(lid: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const res = await fetchImpl("/api/auth/login-nonce", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lid }),
  });
  if (!res.ok) return false;
  return acceptedFlag(await res.json());
}

/**
 * Browser Login event id. Null unless this lid is the session's unused nonce
 * and the Steam ID hashes. A reused lid returns null, so no Login is sent.
 */
export async function resolveLoginEventId(
  steamId: string | null | undefined,
  lid: string | null,
  accept: (lid: string) => Promise<boolean> = acceptIssuedLoginNonce,
): Promise<string | null> {
  if (!steamId || !lid) return null;
  let accepted = false;
  try {
    accepted = await accept(lid);
  } catch {
    return null;
  }
  if (!accepted) return null;
  return loginEventIdFromSteamId(steamId, lid);
}

/**
 * Return sign-in. GA4 `login` always fires. The Pixel Login fires only when
 * `eventId` is the accepted nonce hash; a missing or reused lid leaves it null.
 */
export async function reportReturnLogin(
  loadMe: () => Promise<{ steam_id?: string } | null>,
  lid: string | null,
  accept?: (lid: string) => Promise<boolean>,
): Promise<void> {
  try {
    const me = await loadMe();
    const eventId = await resolveLoginEventId(me?.steam_id, lid, accept);
    trackAuthReturn("login", eventId);
  } catch {
    trackAuthReturn("login", null);
  }
}

export function parseCheckoutReturn(stash: CheckoutReturnStash | null | undefined): CheckoutReturn | null {
  if (!stash) return null;
  if (typeof stash.upgraded !== "string" || stash.upgraded.length === 0) return null;
  if (typeof stash.sessionId !== "string" || stash.sessionId.length === 0) return null;
  return { upgraded: stash.upgraded, sessionId: stash.sessionId };
}

function defaultCheckoutRead(): CheckoutReturnStash | null | undefined {
  return browserWindow()?.__tubCheckoutReturn;
}

function defaultCheckoutClear(): void {
  const current = browserWindow();
  if (current) current.__tubCheckoutReturn = null;
}

/** Read the checkout hand-off once. Does not consult location.search. */
export function consumeCheckoutReturn(
  read: () => CheckoutReturnStash | null | undefined = defaultCheckoutRead,
  clear: () => void = defaultCheckoutClear,
): CheckoutReturn | null {
  const raw = read();
  const parsed = parseCheckoutReturn(raw);
  if (raw) clear();
  return parsed;
}
