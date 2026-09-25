/**
 * Doppler and Gamma Doppler phases share the base finish image when the
 * catalog has no phase-specific art. Phase names stay the lookup key.
 */
/** Phase 1–4 only. Gems (Ruby, Sapphire, Black Pearl, Emerald) keep a placeholder. */
const DOPPLER_PHASE_NAME = /^(.*\| (?:Gamma Doppler|Doppler)) Phase [1-4]$/;

/** Base finish name for a phase or gem, or null when the name is not one. */
export function dopplerBaseName(name: string): string | null {
  const match = name.match(DOPPLER_PHASE_NAME);
  return match?.[1] ?? null;
}

/**
 * Fill requested names that have no image from the base Doppler or Gamma
 * Doppler row. A phase-specific URL already in the map is left alone.
 */
export function withDopplerFaces(
  requested: readonly string[],
  faces: Record<string, string | null>,
): Record<string, string | null> {
  const out: Record<string, string | null> = { ...faces };
  for (const name of requested) {
    if (out[name]) continue;
    const base = dopplerBaseName(name);
    if (!base) continue;
    const url = out[base];
    if (url) out[name] = url;
  }
  return out;
}
