import type { TradeUp } from "../../shared/types.js";

export function isUsableImageUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function inputSkinEntries(tu: TradeUp): { name: string; count: number }[] {
  if (tu.input_summary?.skins?.length) {
    return tu.input_summary.skins.map(s => ({ name: s.name, count: s.count }));
  }
  const counts = new Map<string, number>();
  for (const input of tu.inputs) {
    counts.set(input.skin_name, (counts.get(input.skin_name) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count }));
}

/** Distinctive output then input names already on the contract. Never invents skins. */
export function distinctiveSkinNames(tu: TradeUp, max = 5): string[] {
  const outcomes = [...tu.outcomes]
    .sort((a, b) => b.probability - a.probability || b.estimated_price_cents - a.estimated_price_cents)
    .map(o => o.skin_name);

  const inputs = inputSkinEntries(tu)
    .sort((a, b) => {
      const aStar = a.name.includes("★") ? 0 : 1;
      const bStar = b.name.includes("★") ? 0 : 1;
      if (aStar !== bStar) return aStar - bStar;
      if (a.count !== b.count) return a.count - b.count;
      return a.name.localeCompare(b.name);
    })
    .map(s => s.name);

  const seen = new Set<string>();
  const names: string[] = [];
  for (const name of [...outcomes, ...inputs]) {
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
    if (names.length >= max) break;
  }
  return names;
}

export function collectSkinNames(tradeUps: TradeUp[]): string[] {
  const names = new Set<string>();
  for (const tu of tradeUps) {
    for (const s of tu.input_summary?.skins ?? []) names.add(s.name);
    for (const input of tu.inputs) names.add(input.skin_name);
    for (const outcome of tu.outcomes) names.add(outcome.skin_name);
  }
  return [...names].filter(Boolean);
}
