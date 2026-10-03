// Browser auth event ids. Same normalization as server hashExternalId:
// trim, lowercase, SHA-256 hex, prefixed with reg_ or login_.
import { isLoginNonce, loginEventId, registrationEventId } from "../../shared/tracking.js";

async function hashSteamId(steamId: string): Promise<string | null> {
  const value = steamId.trim().toLowerCase();
  if (!value || typeof crypto === "undefined" || !crypto.subtle) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function registrationEventIdFromSteamId(steamId: string): Promise<string | null> {
  const hex = await hashSteamId(steamId);
  return hex ? registrationEventId(hex) : null;
}

export async function loginEventIdFromSteamId(steamId: string, nonce: string): Promise<string | null> {
  if (!isLoginNonce(nonce)) return null;
  const hex = await hashSteamId(steamId);
  return hex ? loginEventId(hex, nonce) : null;
}
