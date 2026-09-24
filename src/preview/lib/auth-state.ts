import { hasProAccess } from "./billing.js";

/** `/api/auth/me` user as the kit pages read it. `undefined` = still loading, `null` = logged out. */
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
