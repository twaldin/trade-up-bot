/** Pro subscribers and lifetime buyers. Lifetime is checked because the tier column can lag the webhook. */
export function hasProAccess(user: { tier: string; lifetime?: boolean } | null | undefined): boolean {
  return !!user && (user.tier === "pro" || !!user.lifetime);
}
