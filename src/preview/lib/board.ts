import type { TradeUp, TradeUpInput, TradeUpOutcome } from "../../../shared/types.js";
import { toSlug } from "../../../shared/slugs.js";
import { csfloatSearchUrl, listingUrl } from "../../utils/format.js";

export const PREVIEW_PROD_ORIGIN = "https://tradeupbot.app";

export type TileKind = "input" | "output" | "chrome";

export type TileClick = { action: "open-listing"; href: string } | { action: "open-outcome"; href: string } | { action: "none" };

export type InputGroup = {
  name: string;
  count: number;
  listings: TradeUpInput[];
};

export type OddsSegment = {
  key: string;
  name: string;
  probability: number;
  color: string;
  priceCents: number;
};

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

/** Every distinct live listing URL for a grouped input skin. */
export function inputListingHrefs(listings: TradeUpInput[]): string[] {
  const seen = new Set<string>();
  const hrefs: string[] = [];
  for (const listing of listings) {
    if (!listing.listing_id) continue;
    const href = inputListingHref(listing);
    if (!href || seen.has(href)) continue;
    seen.add(href);
    hrefs.push(href);
  }
  return hrefs;
}

export type OpenListingsFn = (url: string, target: string) => object | null;

/** Open every listing under the same user gesture. Later popups may be blocked. */
export function openGroupedListings(
  urls: string[],
  openFn: OpenListingsFn,
): { opened: string[]; blocked: string[] } {
  const opened: string[] = [];
  const blocked: string[] = [];
  for (const url of urls) {
    const win = openFn(url, "_blank");
    if (win) opened.push(url);
    else blocked.push(url);
  }
  return { opened, blocked };
}

export function prodSkinHref(skinName: string): string {
  return `${PREVIEW_PROD_ORIGIN}/skins/${toSlug(skinName)}`;
}

/** Marketplace float/price URL when we have one; otherwise the prod skin page. Never a local /skins path. */
export function outputHref(outcome: TradeUpOutcome): string {
  const market = outcome.sell_marketplace;
  if (market === "dmarket" || market === "skinport" || market === "buff") {
    return listingUrl(
      "",
      outcome.skin_name,
      outcome.predicted_condition,
      outcome.predicted_float,
      outcome.estimated_price_cents,
      market,
    );
  }
  if (market === "csfloat") {
    return csfloatSearchUrl(outcome.skin_name, outcome.predicted_condition);
  }
  return prodSkinHref(outcome.skin_name);
}

export function verifyClaimHref(tradeUpId: number): string {
  return `${PREVIEW_PROD_ORIGIN}/trade-ups/${tradeUpId}`;
}

export function bentoColumns(viewportWidth: number): 1 | 2 | 3 {
  if (viewportWidth < 720) return 1;
  if (viewportWidth < 1180) return 2;
  return 3;
}

export function expandPushesOthers(expandedId: number | null, id: number): boolean {
  return expandedId === id;
}

export function profitFill(profitCents: number): "lime" | "muted" {
  return profitCents >= 0 ? "lime" : "muted";
}

export function inputCostCents(tu: TradeUp): number {
  return tu.total_cost_cents;
}

export function inputQty(tu: TradeUp): number {
  if (typeof tu.input_summary?.input_count === "number" && tu.input_summary.input_count > 0) {
    return tu.input_summary.input_count;
  }
  if (tu.inputs.length > 0) return tu.inputs.length;
  if (tu.input_summary?.skins?.length) {
    return tu.input_summary.skins.reduce((sum, skin) => sum + skin.count, 0);
  }
  return 0;
}

export function uniqueInputs(tu: TradeUp): InputGroup[] {
  if (tu.inputs.length > 0) {
    const map = new Map<string, InputGroup>();
    for (const input of tu.inputs) {
      const existing = map.get(input.skin_name);
      if (existing) {
        existing.count += 1;
        existing.listings.push(input);
      } else {
        map.set(input.skin_name, { name: input.skin_name, count: 1, listings: [input] });
      }
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }
  return (tu.input_summary?.skins ?? []).map((skin) => ({
    name: skin.name,
    count: skin.count,
    listings: [],
  }));
}

export function uniqueOutputs(tu: TradeUp): TradeUpOutcome[] {
  const map = new Map<string, TradeUpOutcome>();
  for (const outcome of tu.outcomes) {
    const existing = map.get(outcome.skin_name);
    if (existing) {
      map.set(outcome.skin_name, {
        ...existing,
        probability: existing.probability + outcome.probability,
      });
    } else {
      map.set(outcome.skin_name, outcome);
    }
  }
  return [...map.values()];
}

export function oddsBarSegments(tu: TradeUp): OddsSegment[] {
  return uniqueOutputs(tu)
    .filter((outcome) => outcome.probability > 0)
    .map((outcome, index) => ({
      key: `out-${index}`,
      name: outcome.skin_name,
      probability: outcome.probability,
      color: outcome.estimated_price_cents >= tu.total_cost_cents ? "#d7fe52" : "#6b6b66",
      priceCents: outcome.estimated_price_cents,
    }));
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
