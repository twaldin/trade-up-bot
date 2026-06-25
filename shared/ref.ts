// Referral attribution helpers — pure, shared by client (capture/append) and server (persist).
// A ref code is a short opaque creator/campaign token. Anything that doesn't match the
// pattern is rejected so a hostile ?ref can't poison the column or an auth URL.

export const REF_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Return the ref string if it is a valid code, else null. Accepts unknown (req.query is loosely typed). */
export function sanitizeRef(raw: unknown): string | null {
  return typeof raw === "string" && REF_PATTERN.test(raw) ? raw : null;
}

/** Build a Steam auth URL with an optional post-login return path and ref code. */
export function steamAuthUrl(returnTo?: string, ref?: string | null): string {
  const params = new URLSearchParams();
  if (returnTo) params.set("return", returnTo);
  const cleanRef = sanitizeRef(ref);
  if (cleanRef) params.set("ref", cleanRef);
  const qs = params.toString();
  return qs ? `/auth/steam?${qs}` : "/auth/steam";
}
