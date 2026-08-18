import type { TradeUp, TradeUpOutcome } from "./types.js";

export interface GroupedInputSkin {
  name: string;
  count: number;
}

/** Distinct input skins with counts. Never invents names or pads empty slots. */
export function groupInputSkins(tu: TradeUp): GroupedInputSkin[] {
  if (tu.input_summary?.skins?.length) {
    return tu.input_summary.skins
      .filter(skin => skin.name.trim().length > 0)
      .map(skin => ({ name: skin.name, count: Math.max(0, Math.floor(skin.count)) }))
      .filter(skin => skin.count > 0);
  }
  const counts = new Map<string, number>();
  for (const input of tu.inputs) {
    if (!input.skin_name.trim()) continue;
    counts.set(input.skin_name, (counts.get(input.skin_name) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count }));
}

/** Unique output skins. Duplicate names merge probability. Never invents a skin. */
export function uniqueOutcomes(outcomes: TradeUpOutcome[]): TradeUpOutcome[] {
  const byName = new Map<string, TradeUpOutcome>();
  for (const outcome of outcomes) {
    if (!outcome.skin_name?.trim()) continue;
    const prev = byName.get(outcome.skin_name);
    if (!prev) {
      byName.set(outcome.skin_name, { ...outcome });
      continue;
    }
    byName.set(outcome.skin_name, {
      ...prev,
      probability: prev.probability + outcome.probability,
    });
  }
  return [...byName.values()].sort((a, b) =>
    b.probability - a.probability || b.estimated_price_cents - a.estimated_price_cents,
  );
}

export function chanceToProfit(tu: TradeUp): number {
  if (tu.chance_to_profit !== undefined) return tu.chance_to_profit;
  return tu.outcomes.reduce((sum, outcome) =>
    sum + (outcome.estimated_price_cents > tu.total_cost_cents ? outcome.probability : 0), 0);
}

/** Lime if that outcome beats contract cost; charcoal otherwise. No third color. */
export function outcomeSegmentClass(
  outcome: Pick<TradeUpOutcome, "estimated_price_cents">,
  totalCostCents: number,
): "pv-seg-lime" | "pv-seg-charcoal" {
  return outcome.estimated_price_cents > totalCostCents ? "pv-seg-lime" : "pv-seg-charcoal";
}

/** Discrete profit vs loss mass. Not a dollar-bin histogram. */
export function profitLossSplit(tu: TradeUp): { profit: number; loss: number } {
  if (tu.outcomes.length === 0) {
    const profit = chanceToProfit(tu);
    return { profit, loss: Math.max(0, 1 - profit) };
  }
  let profit = 0;
  let loss = 0;
  for (const outcome of tu.outcomes) {
    if (outcome.estimated_price_cents > tu.total_cost_cents) profit += outcome.probability;
    else loss += outcome.probability;
  }
  return { profit, loss };
}

export function collectPreviewSkinNames(tradeUps: TradeUp[]): string[] {
  const names = new Set<string>();
  for (const tu of tradeUps) {
    for (const skin of groupInputSkins(tu)) names.add(skin.name);
    for (const outcome of uniqueOutcomes(tu.outcomes)) names.add(outcome.skin_name);
  }
  return [...names].filter(Boolean);
}

export function lookupFaces(
  faces: Record<string, TradeUpOutcome[]> | Record<number, TradeUpOutcome[]>,
  id: number,
): TradeUpOutcome[] {
  const record = faces as Record<string | number, TradeUpOutcome[] | undefined>;
  return record[id] ?? record[String(id)] ?? [];
}

/** Hydrate list-row `outcomes: []` from the preview face batch. */
export function mergeContractFaces(
  tradeUps: TradeUp[],
  faces: Record<string, TradeUpOutcome[]> | Record<number, TradeUpOutcome[]>,
): TradeUp[] {
  return tradeUps.map(tu => {
    if (tu.outcomes?.length) return tu;
    const next = lookupFaces(faces, tu.id);
    return next.length ? { ...tu, outcomes: next } : tu;
  });
}
