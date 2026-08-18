/** Shared skin-image helpers. Usable from server and frontend. */

export function isUsableImageUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

const WEAR_SUFFIX = /\s*\((?:Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)\s*$/i;

/** Strip wear + StatTrak/Souvenir prefixes so a catalog keyed by base name still hits. */
export function normalizeSkinLookupName(name: string): string {
  return name
    .replace(WEAR_SUFFIX, "")
    .replace(/^StatTrak™\s+/i, "")
    .replace(/^Souvenir\s+/i, "")
    .trim();
}

export function indexByMykelSkins(rows: { name?: string; image?: string | null }[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    if (!row.name || !isUsableImageUrl(row.image)) continue;
    const exact = row.name.trim();
    const normalized = normalizeSkinLookupName(exact);
    if (!map.has(exact)) map.set(exact, row.image);
    if (!map.has(normalized)) map.set(normalized, row.image);
  }
  return map;
}

/** Stored URL first, then ByMykel/Steam catalog. Never invents a name. */
export function resolveSkinImageUrl(
  name: string,
  stored: string | null | undefined,
  catalog: Map<string, string>,
): string | null {
  if (isUsableImageUrl(stored)) return stored;
  const exact = catalog.get(name);
  if (isUsableImageUrl(exact)) return exact;
  const normalized = catalog.get(normalizeSkinLookupName(name));
  if (isUsableImageUrl(normalized)) return normalized;
  return null;
}
