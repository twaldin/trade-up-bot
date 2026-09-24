// Meta CAPI customer-information hashing: normalize (trim + lowercase), then SHA-256 hex.
import { createHash } from "node:crypto";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalized(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const out = value.trim().toLowerCase();
  return out ? out : null;
}

export function hashEmail(email: unknown): string | null {
  const value = normalized(email);
  return value ? sha256Hex(value) : null;
}

export function hashExternalId(id: unknown): string | null {
  const value = normalized(id);
  return value ? sha256Hex(value) : null;
}

export function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
