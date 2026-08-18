/**
 * Dreams & Nightmares (D&N) dedup/diversity for the /api/trade-ups list.
 *
 * Discovery already persists every high-score D&N clone (TradeUpStore only
 * caps per discovery run). The default board then sorts by trade_up_score and
 * a dislocation makes page 1 a wall of near-duplicate D&N contracts.
 *
 * This pass is API-surface only: keep top N per D&N collection-combo
 * signature (same bucketing idea as TradeUpStore) so other collections can
 * surface. Scores, discovery, and persisted rows are unchanged.
 *
 * Skip when the user asked for a specific collection or their own claims.
 */

/** Names that appear on trade_ups.collection_names for this collection. */
export const DN_COLLECTION_NAMES = [
  "The Dreams & Nightmares Collection",
  "Dreams & Nightmares",
] as const;

/** Top-N per D&N collection-combo signature. Matches TradeUpStore's default. */
export const DN_API_MAX_PER_SIGNATURE = 20;

export function isDreamsNightmaresCollection(name: string): boolean {
  return name === "The Dreams & Nightmares Collection" || name === "Dreams & Nightmares";
}

export function collectionComboHasDn(collectionNames: readonly string[]): boolean {
  return collectionNames.some(isDreamsNightmaresCollection);
}

export function shouldApplyDnDiversity(opts: {
  collection?: string;
  myClaims?: boolean;
  type?: string;
}): boolean {
  if (opts.myClaims) return false;
  if (opts.collection && opts.collection.trim().length > 0) return false;
  return true;
}

export function dnSignatureKey(collectionNames: readonly string[]): string {
  return [...collectionNames].sort().join("|");
}

export interface DnDiversityRow {
  id: number;
  collection_names: readonly string[];
  score: number;
}

/**
 * In-memory analog of the list SQL window: assume `rows` are already ordered
 * the same way the API sorts (score desc, then id desc). Non-D&N rows always
 * pass; each D&N signature keeps at most `maxPerSignature` rows.
 */
export function applyDnDiversity<T extends DnDiversityRow>(
  rows: readonly T[],
  maxPerSignature: number = DN_API_MAX_PER_SIGNATURE,
): T[] {
  const kept: T[] = [];
  const dnCounts = new Map<string, number>();
  for (const row of rows) {
    if (!collectionComboHasDn(row.collection_names)) {
      kept.push(row);
      continue;
    }
    const key = dnSignatureKey(row.collection_names);
    const n = dnCounts.get(key) ?? 0;
    if (n >= maxPerSignature) continue;
    dnCounts.set(key, n + 1);
    kept.push(row);
  }
  return kept;
}

/** Median score of a displayed top-N (used to document the accepted optical M1 hit). */
export function displayedTopMedianScore(rows: readonly { score: number }[]): number {
  if (rows.length === 0) return 0;
  const scores = rows.map((r) => r.score).sort((a, b) => a - b);
  const mid = Math.floor(scores.length / 2);
  if (scores.length % 2 === 0) {
    return (scores[mid - 1] + scores[mid]) / 2;
  }
  return scores[mid];
}

export function applyDnDiversityToListSql(args: {
  where: string;
  sortCol: string;
  sortOrder: "ASC" | "DESC";
  apply: boolean;
  startParamIndex: number;
}): {
  fromWhere: string;
  params: Array<string[] | number>;
  nextParamIndex: number;
} {
  if (!args.apply) {
    return {
      fromWhere: `FROM trade_ups t ${args.where}`,
      params: [],
      nextParamIndex: args.startParamIndex,
    };
  }

  const namesParam = args.startParamIndex;
  const capParam = args.startParamIndex + 1;
  // Rank only D&N rows that already match the request filters. Non-D&N rows
  // pass through; each D&N collection-combo keeps at most N.
  return {
    fromWhere: `FROM trade_ups t
      ${args.where}
      AND (
        NOT (t.collection_names && $${namesParam}::text[])
        OR t.id IN (
          SELECT ranked.id FROM (
            SELECT t.id,
              ROW_NUMBER() OVER (
                PARTITION BY t.collection_names
                ORDER BY ${args.sortCol} ${args.sortOrder} NULLS LAST, t.id DESC
              ) AS dn_sig_rank
            FROM trade_ups t
            ${args.where}
              AND t.collection_names && $${namesParam}::text[]
          ) ranked
          WHERE ranked.dn_sig_rank <= $${capParam}
        )
      )`,
    params: [[...DN_COLLECTION_NAMES], DN_API_MAX_PER_SIGNATURE],
    nextParamIndex: args.startParamIndex + 2,
  };
}
