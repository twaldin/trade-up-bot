/**
 * Collection skin counts for the kit index + detail.
 *
 * `/api/collections`.skin_count is weapon skins only. The detail rail loads
 * `/api/skin-data?rarity=all&collection=…`, which already merges knife/glove
 * finishes. Index and detail both format that same set — never the weapon-only
 * index total dressed up as "N skins".
 */

export type CollectionSkinTally = {
  weapons: number;
  knives: number;
  gloves: number;
  total: number;
};

export type CollectionSkinCounts = {
  weapons: number;
  knives: number | null;
  gloves: number | null;
};

const GLOVE_RE = /\bgloves?\b|\bhand wraps?\b/i;

function isStar(name: string): boolean {
  return name.startsWith("★");
}

function isGlove(name: string, weapon?: string): boolean {
  return GLOVE_RE.test(`${weapon ?? ""} ${name}`);
}

/** Split a collection's skin-data rows the same way the detail rail already does. */
export function tallyCollectionSkins(skins: Array<{ name: string; weapon?: string }>): CollectionSkinTally {
  let weapons = 0;
  let knives = 0;
  let gloves = 0;
  for (const skin of skins) {
    if (!isStar(skin.name)) {
      weapons += 1;
      continue;
    }
    if (isGlove(skin.name, skin.weapon)) gloves += 1;
    else knives += 1;
  }
  return { weapons, knives, gloves, total: weapons + knives + gloves };
}

export function collectionSkinTotal(counts: CollectionSkinCounts): number {
  return counts.weapons + (counts.knives ?? 0) + (counts.gloves ?? 0);
}

function rareLabel(count: number | null, singular: string, plural: string): string | null {
  if (count === null) return plural;
  if (count <= 0) return null;
  if (count === 1) return `1 ${singular}`;
  return `${count} ${plural}`;
}

/** Shared copy for the index card, index table, and detail header. */
export function formatCollectionSkinCopy(counts: CollectionSkinCounts): string {
  const knifePart = rareLabel(counts.knives, "knife", "knives");
  const glovePart = rareLabel(counts.gloves, "glove", "gloves");
  const hasRare = knifePart !== null || glovePart !== null;
  const weaponPart = hasRare
    ? (counts.weapons === 1 ? "1 weapon skin" : `${counts.weapons} weapon skins`)
    : (counts.weapons === 1 ? "1 skin" : `${counts.weapons} skins`);
  return [weaponPart, knifePart, glovePart].filter((part): part is string => part !== null).join(" · ");
}

export function countsFromCollectionRow(
  row: { skin_count: number; has_knives: boolean; has_gloves: boolean },
  tally: CollectionSkinTally | null,
): CollectionSkinCounts {
  if (tally) {
    return { weapons: tally.weapons, knives: tally.knives, gloves: tally.gloves };
  }
  return {
    weapons: row.skin_count,
    knives: row.has_knives ? null : 0,
    gloves: row.has_gloves ? null : 0,
  };
}
