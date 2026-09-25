// Browser CompleteRegistration event id. Same normalization as server hashExternalId:
// trim, lowercase, SHA-256 hex, prefixed with reg_.
import { registrationEventId } from "../../shared/tracking.js";

export async function registrationEventIdFromSteamId(steamId: string): Promise<string | null> {
  const value = steamId.trim().toLowerCase();
  if (!value || typeof crypto === "undefined" || !crypto.subtle) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return registrationEventId(hex);
}
