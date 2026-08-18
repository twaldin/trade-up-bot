import type { TradeUpOutcome } from "../../shared/types.js";

export const PREVIEW_FACE_ID_CAP = 50;

export function parseFaceIds(raw: string): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const part of raw.split(",")) {
    const id = Number(part.trim());
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= PREVIEW_FACE_ID_CAP) break;
  }
  return ids;
}

export function facesFromOutcomeRows(
  rows: { id: number; outcomes_json: string | null }[],
): Record<string, TradeUpOutcome[]> {
  const faces: Record<string, TradeUpOutcome[]> = {};
  for (const row of rows) {
    const key = String(row.id);
    try {
      const parsed = JSON.parse(row.outcomes_json || "[]") as unknown;
      faces[key] = Array.isArray(parsed) ? parsed as TradeUpOutcome[] : [];
    } catch {
      faces[key] = [];
    }
  }
  return faces;
}
