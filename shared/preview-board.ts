import type { TradeUp, TradeUpOutcome } from "./types.js";

/** Expand a contract's named inputs into a slot strip. Never invents skins. */
export function expandInputSlots(tu: TradeUp, size = 10): string[] {
  const names: string[] = [];
  if (tu.input_summary?.skins?.length) {
    for (const skin of tu.input_summary.skins) {
      const count = Math.max(0, Math.floor(skin.count));
      for (let i = 0; i < count; i++) names.push(skin.name);
    }
  } else {
    for (const input of tu.inputs) names.push(input.skin_name);
  }
  const filled = names.filter(Boolean).slice(0, size);
  while (filled.length < size) filled.push("");
  return filled;
}

/** Distinctive output: highest probability, then highest estimated price. */
export function pickHeroOutcome(outcomes: TradeUpOutcome[]): TradeUpOutcome | null {
  if (!outcomes.length) return null;
  return [...outcomes].sort((a, b) =>
    b.probability - a.probability || b.estimated_price_cents - a.estimated_price_cents,
  )[0] ?? null;
}

export function collectPreviewSkinNames(tradeUps: TradeUp[]): string[] {
  const names = new Set<string>();
  for (const tu of tradeUps) {
    for (const skin of tu.input_summary?.skins ?? []) names.add(skin.name);
    for (const input of tu.inputs) names.add(input.skin_name);
    for (const outcome of tu.outcomes) names.add(outcome.skin_name);
  }
  return [...names].filter(Boolean);
}
