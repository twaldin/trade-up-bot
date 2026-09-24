export type TierUser = { tier?: string; lifetime?: boolean } | null | undefined;

/**
 * Tier the gates should use. `users.lifetime` is set by the lifetime webhook
 * after the checkout price is verified, and it can land before `users.tier`.
 */
export function getEffectiveTier(user: TierUser): string {
  if (user?.lifetime) return "pro";
  return user?.tier || "free";
}

/** Pro subscribers and lifetime buyers. Lifetime is checked because the tier column can lag the webhook. */
export function hasProAccess(user: TierUser): boolean {
  return getEffectiveTier(user) === "pro";
}
