/** Typed min-chance on blur: empty stays empty, otherwise 0–100. */
export function commitMinChance(raw: string): string {
  if (raw.trim() === "") return "";
  const value = Number(raw);
  if (!Number.isFinite(value)) return "";
  return String(Math.min(100, Math.max(0, Math.round(value))));
}
