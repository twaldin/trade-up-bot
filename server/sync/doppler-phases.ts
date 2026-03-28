/**
 * Maps CS2 paint_index (item finish) to Doppler/Gamma Doppler phase names.
 *
 * IMPORTANT: Validate paint_index values against a live CSFloat listing before
 * shipping. Fetch: GET /api/v1/listings?market_hash_name=★+Karambit+|+Doppler
 * and inspect item.paint_index for known-phase items.
 *
 * Community reference: csgostash.com finish IDs.
 */

const DOPPLER_PHASES: Record<number, string> = {
  412: "Phase 1",
  413: "Phase 2",
  414: "Phase 3",
  415: "Phase 4",
  416: "Ruby",
  417: "Sapphire",
  418: "Black Pearl",
};

const GAMMA_DOPPLER_PHASES: Record<number, string> = {
  568: "Phase 1",
  569: "Phase 2",
  570: "Phase 3",
  571: "Phase 4",
  572: "Emerald",
};

/**
 * Returns the Doppler phase suffix ("Phase 1", "Ruby", etc.) for a given
 * paint_index, or null if the skin is not a Doppler or the index is unknown.
 */
export function dopplerPhaseFromPaintIndex(paintIndex: number, skinName: string): string | null {
  if (skinName.includes("Gamma Doppler")) return GAMMA_DOPPLER_PHASES[paintIndex] ?? null;
  if (skinName.includes("Doppler")) return DOPPLER_PHASES[paintIndex] ?? null;
  return null;
}
