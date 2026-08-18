import type { TradeUp, TradeUpInput, TradeUpOutcome } from "../../../shared/types.js";
import { listingUrl } from "../../utils/format.js";

export type TileKind = "input" | "output" | "chrome";

export type TileClick = { action: "open-listing"; href: string } | { action: "open-outcome"; href: string } | { action: "none" };

/** Tile clicks never toggle expand — only the dedicated expand control does. */
export function tileClick(kind: TileKind, href: string | null): TileClick {
  if (!href) return { action: "none" };
  if (kind === "input") return { action: "open-listing", href };
  if (kind === "output") return { action: "open-outcome", href };
  return { action: "none" };
}

export function inputListingHref(input: TradeUpInput): string {
  return listingUrl(
    input.listing_id,
    input.skin_name,
    input.condition,
    input.float_value,
    input.price_cents,
    input.source,
    input.marketplace_id,
    input.stattrak,
  );
}

export function outcomeHref(tradeUpId: number, skinName: string): string {
  return `/skins/${encodeURIComponent(skinName)}?from=${tradeUpId}`;
}

export function bentoColumns(viewportWidth: number): 1 | 2 | 3 {
  if (viewportWidth < 720) return 1;
  if (viewportWidth < 1180) return 2;
  return 3;
}

export function expandPushesOthers(expandedId: number | null, id: number): boolean {
  return expandedId === id;
}

export type PlPoint = { i: number; v: number };

/** Compact P/L series for the kit chart: last point is current profit. */
export function profitLossSeries(profitCents: number, points = 8): PlPoint[] {
  const end = profitCents / 100;
  const series: PlPoint[] = [];
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    const wobble = Math.sin(i * 1.7) * Math.abs(end) * 0.12;
    series.push({ i, v: end * t + wobble });
  }
  series[points - 1] = { i: points - 1, v: end };
  return series;
}

export function profitFill(profitCents: number): "lime" | "charcoal" {
  return profitCents >= 0 ? "lime" : "charcoal";
}

export function outputPriceCents(tu: TradeUp, outcomes: TradeUpOutcome[]): number | null {
  if (outcomes.length === 0) {
    if (tu.expected_value_cents) return tu.expected_value_cents;
    return null;
  }
  const best = outcomes.reduce((a, b) => (a.estimated_price_cents >= b.estimated_price_cents ? a : b));
  return best.estimated_price_cents;
}

export function primaryOutcome(outcomes: TradeUpOutcome[]): TradeUpOutcome | null {
  if (outcomes.length === 0) return null;
  return [...outcomes].sort((a, b) => b.probability - a.probability || b.estimated_price_cents - a.estimated_price_cents)[0] ?? null;
}

export function groupedInputs(inputs: TradeUpInput[]): { name: string; count: number; sample: TradeUpInput }[] {
  const map = new Map<string, { name: string; count: number; sample: TradeUpInput }>();
  for (const input of inputs) {
    const existing = map.get(input.skin_name);
    if (existing) existing.count += 1;
    else map.set(input.skin_name, { name: input.skin_name, count: 1, sample: input });
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

export function rarityColor(type: string | undefined): string {
  switch (type) {
    case "covert_knife": return "#d4a017";
    case "classified_covert": return "#eb4b4b";
    case "restricted_classified": return "#d32ce6";
    case "milspec_restricted": return "#8847ff";
    case "industrial_milspec": return "#4b69ff";
    case "consumer_industrial": return "#5e98d9";
    default: return "#d7fe52";
  }
}

export function rarityLabel(type: string | undefined): string {
  switch (type) {
    case "covert_knife": return "Knife / Gloves";
    case "classified_covert": return "Covert";
    case "restricted_classified": return "Classified";
    case "milspec_restricted": return "Restricted";
    case "industrial_milspec": return "Mil-Spec";
    case "consumer_industrial": return "Industrial";
    default: return "Trade-up";
  }
}
