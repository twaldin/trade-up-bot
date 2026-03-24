/**
 * Convert a CS2 skin name to a URL-safe slug.
 * "★ Butterfly Knife | Lore" → "butterfly-knife-lore"
 * "AK-47 | Redline" → "ak-47-redline"
 */
export function toSlug(skinName: string): string {
  return skinName
    .replace(/^★\s*/, "")      // strip ★ prefix
    .replace(/\s*\|\s*/g, " ") // replace | separator with space
    .replace(/[^a-zA-Z0-9\s-]/g, "") // strip special chars, keep hyphens
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")      // spaces → hyphens
    .replace(/-{2,}/g, "-")    // collapse multiple hyphens
    .replace(/^-|-$/g, "");    // trim leading/trailing hyphens
}

/**
 * Look up a skin by slug. Needs DB access — implemented in server/routes/data.ts.
 * This stub exists so the module can be imported from shared code.
 */
export function fromSlug(_slug: string): string | null {
  return null;
}
