/**
 * API-surface collection-combo diversity for GET /api/trade-ups.
 *
 * TradeUpStore already keeps top N per collection-combo during a discovery
 * run, but that store is ephemeral. The DB accumulates hundreds of
 * near-identical rows (Check 131: ~132 Dreams & Nightmares classified→covert
 * contracts at the top of the board).
 *
 * This pass is read-side only: keep top N per `collection_names` combo so
 * one cluster cannot occupy the entire visible top. Scores, discovery, and
 * persisted rows are unchanged. Optical M1 of the displayed top-100 can
 * fall; that is accepted and is not a revert signal.
 *
 * Skip when the user asked for a specific collection or their own claims.
 */

/** Top-N per collection-combo. Matches TradeUpStore's default. */
export const API_MAX_PER_COLLECTION_COMBO = 20;

export function shouldApplyListDiversity(opts: {
  collection?: string;
  myClaims?: boolean;
  type?: string;
}): boolean {
  if (opts.myClaims) return false;
  if (opts.collection && opts.collection.trim().length > 0) return false;
  return true;
}

/** Same signature TradeUpStore uses: sorted collection names joined by "|". */
export function collectionComboKey(collectionNames: readonly string[]): string {
  return [...collectionNames].sort().join("|");
}

export interface ListDiversityRow {
  id: number;
  collection_names: readonly string[];
  score: number;
}

/**
 * In-memory analog of the list SQL window. `rows` must already be in the
 * API sort order (score desc, then id desc). Each collection-combo keeps
 * at most `maxPerCombo` rows.
 */
export function applyListDiversity<T extends ListDiversityRow>(
  rows: readonly T[],
  maxPerCombo: number = API_MAX_PER_COLLECTION_COMBO,
): T[] {
  const kept: T[] = [];
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = collectionComboKey(row.collection_names);
    const n = counts.get(key) ?? 0;
    if (n >= maxPerCombo) continue;
    counts.set(key, n + 1);
    kept.push(row);
  }
  return kept;
}

/** Median score of a displayed top-N (documents the accepted optical M1 hit). */
export function displayedTopMedianScore(rows: readonly { score: number }[]): number {
  if (rows.length === 0) return 0;
  const scores = rows.map((r) => r.score).sort((a, b) => a - b);
  const mid = Math.floor(scores.length / 2);
  if (scores.length % 2 === 0) {
    return (scores[mid - 1] + scores[mid]) / 2;
  }
  return scores[mid];
}

export function applyListDiversityToListSql(args: {
  where: string;
  sortCol: string;
  sortOrder: "ASC" | "DESC";
  apply: boolean;
  startParamIndex: number;
}): {
  fromWhere: string;
  params: number[];
  nextParamIndex: number;
} {
  if (!args.apply) {
    return {
      fromWhere: `FROM trade_ups t ${args.where}`,
      params: [],
      nextParamIndex: args.startParamIndex,
    };
  }

  const capParam = args.startParamIndex;
  return {
    fromWhere: `FROM (
      SELECT t.*,
        ROW_NUMBER() OVER (
          PARTITION BY t.collection_names
          ORDER BY ${args.sortCol} ${args.sortOrder} NULLS LAST, t.id DESC
        ) AS combo_rank
      FROM trade_ups t
      ${args.where}
    ) t
    WHERE t.combo_rank <= $${capParam}`,
    params: [API_MAX_PER_COLLECTION_COMBO],
    nextParamIndex: args.startParamIndex + 1,
  };
}
