/**
 * Exact DMarket relist identity. Offer ids change when a seller delists and
 * relists; the skin, float, and paint seed do not.
 *
 * The marketplace v2 offer payload (`DMarketV2Offer`) has `offerId` only — no
 * separate asset id. A Steam inspect URI (`…A<assetId>D…`) is the only stable
 * per-item id on that payload. Prefer it when both sides have one.
 */

export const RELIST_FLOAT_EPSILON = 1e-7;

export interface RelistIdentity {
  skinName: string;
  floatValue: number;
  /** Null when the side does not know the seed (deleted listing, input row). */
  paintSeed: number | null;
  /** Null when the payload/row has no stable asset id. */
  assetId: string | null;
}

export interface RelistCandidate extends RelistIdentity {
  id: string;
}

export type RelistPick =
  | { ok: true; match: RelistCandidate }
  | { ok: false; reason: "no_relist" | "ambiguous" };

const INSPECT_ASSET = /A(\d+)D/;

/** Asset id embedded in a DMarket/Steam inspect link, if present. */
export function assetIdFromInspect(inspect: string | null | undefined): string | null {
  if (!inspect) return null;
  let decoded = inspect;
  try {
    decoded = decodeURIComponent(inspect);
  } catch {
    decoded = inspect;
  }
  const match = INSPECT_ASSET.exec(decoded);
  return match ? match[1] : null;
}

export function floatsMatchRelist(a: number, b: number): boolean {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= RELIST_FLOAT_EPSILON;
}

/** Same seed when both are known. An unknown seed does not reject the pair. */
export function paintSeedsCompatible(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return true;
  return a === b;
}

export function isExactDMarketRelist(missing: RelistIdentity, candidate: RelistIdentity): boolean {
  if (missing.skinName !== candidate.skinName) return false;
  if (missing.assetId && candidate.assetId) return missing.assetId === candidate.assetId;
  if (!floatsMatchRelist(missing.floatValue, candidate.floatValue)) return false;
  return paintSeedsCompatible(missing.paintSeed, candidate.paintSeed);
}

/**
 * One incoming/stored listing, or none. Two float hits are ambiguous unless a
 * shared asset id singles one of them out.
 */
export function pickDMarketRelist(missing: RelistIdentity, candidates: readonly RelistCandidate[]): RelistPick {
  const hits = candidates.filter(c => isExactDMarketRelist(missing, c));
  if (hits.length === 1) return { ok: true, match: hits[0] };
  if (hits.length === 0) return { ok: false, reason: "no_relist" };
  if (missing.assetId) {
    const byAsset = hits.filter(h => h.assetId != null && h.assetId === missing.assetId);
    if (byAsset.length === 1) return { ok: true, match: byAsset[0] };
  }
  return { ok: false, reason: "ambiguous" };
}
