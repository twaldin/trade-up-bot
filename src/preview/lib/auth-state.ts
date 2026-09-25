import { hasProAccess } from "./billing.js";

/** `/api/auth/me` user as the kit pages read it. `undefined` = still loading, `null` = logged out. */
export const AUTH_ME_TIMEOUT_MS = 8_000;

export interface PricingSession {
  tier: string;
  lifetime?: boolean;
  steam_id?: string;
}

/** Logged-out (`null`) when auth/me fails, is anonymous, or does not answer within the timeout. */
export async function fetchPricingSession(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = AUTH_ME_TIMEOUT_MS,
): Promise<PricingSession | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl("/api/auth/me", { credentials: "include", signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json() as { steam_id?: string; tier?: string; lifetime?: boolean } | null;
    if (!data?.steam_id) return null;
    return { tier: data.tier ?? "free", lifetime: data.lifetime, steam_id: data.steam_id };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface AuthUser {
  steam_id: string;
  tier: string;
  is_admin?: boolean;
  lifetime?: boolean;
}

export function authUserFrom<T extends { steam_id?: unknown }>(data: T | null | undefined): (T & AuthUser) | null {
  if (!data || typeof data.steam_id !== "string" || data.steam_id === "") return null;
  return data as T & AuthUser;
}

export type ShareActionPanel = "pending" | "sign-in" | "pro" | "upgrade";

export function shareActionPanel(user: AuthUser | null | undefined): ShareActionPanel {
  if (user === undefined) return "pending";
  if (user === null) return "sign-in";
  if (hasProAccess(user) || user.tier === "admin" || !!user.is_admin) return "pro";
  return "upgrade";
}
