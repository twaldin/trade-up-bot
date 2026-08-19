import type { TradeUp, TradeUpInput, TradeUpOutcome } from "../../../shared/types.js";
import { collectionToSlug, toSlug } from "../../../shared/slugs.js";
import { csfloatSearchUrl, listingUrl } from "../../utils/format.js";

export const PREVIEW_PROD_ORIGIN = "https://tradeupbot.app";

/** Marketplaces publish four decimals; the 14-digit inspect float is hover only. */
export const FLOAT_DP = 4;

const CONSUMER = "#b0c3d9";
const INDUSTRIAL = "#5e98d9";
const MILSPEC = "#4b69ff";
const RESTRICTED = "#8847ff";
const CLASSIFIED = "#d32ce6";
const COVERT = "#eb4b4b";
const KNIFE = "#d4a017";

export type TileKind = "input" | "output" | "chrome";

export type TileClick = { action: "open-listing"; href: string } | { action: "open-outcome"; href: string } | { action: "none" };

export type InputGroup = {
  name: string;
  count: number;
  listings: TradeUpInput[];
  unitPriceCents: number;
  /** Mean float of the group's listings. Null until the listings hydrate. */
  avgFloat: number | null;
  condition: string | null;
};

export type PayoffPoint = {
  name: string;
  probability: number;
  priceCents: number;
  profitCents: number;
  evContributionCents: number;
};

export type CdfPoint = { x: number; p: number };

export type EvWaterfall = {
  steps: PayoffPoint[];
  totalEvCents: number;
  topShare: number;
  concentrationNote: string | null;
};

/** One floating step of the cumulative EV waterfall, in integer cents. */
export type WaterfallBar = PayoffPoint & { startCents: number; endCents: number };

export type ListingTotals = { count: number; totalCents: number; averageCents: number };

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

/** Skin data page inside the preview shell — never an unprefixed /skins/ 404. */
export function previewSkinHref(skinName: string): string {
  return `/preview/skins/${toSlug(skinName)}`;
}

export function previewCollectionHref(collectionName: string): string {
  return `/preview/collections/${collectionToSlug(collectionName)}`;
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

function unitPrice(listings: TradeUpInput[]): number {
  if (listings.length === 0) return 0;
  return Math.round(listings.reduce((sum, row) => sum + row.price_cents, 0) / listings.length);
}

/** Mean float of a group. Null rather than 0 when the listings are not loaded. */
export function averageFloat(listings: TradeUpInput[]): number | null {
  const floats = listings
    .map((row) => row.float_value)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (floats.length === 0) return null;
  return floats.reduce((sum, value) => sum + value, 0) / floats.length;
}

/** Four decimals, the number every marketplace prints. Null stays null. */
export function formatFloat(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value.toFixed(FLOAT_DP);
}

export function uniqueInputs(tu: TradeUp): InputGroup[] {
  if (tu.inputs.length > 0) {
    const map = new Map<string, InputGroup>();
    for (const row of tu.inputs) {
      const existing = map.get(row.skin_name);
      if (existing) {
        existing.count += 1;
        existing.listings.push(row);
        existing.unitPriceCents = unitPrice(existing.listings);
        existing.avgFloat = averageFloat(existing.listings);
      } else {
        map.set(row.skin_name, {
          name: row.skin_name,
          count: 1,
          listings: [row],
          unitPriceCents: row.price_cents,
          avgFloat: averageFloat([row]),
          condition: row.condition ?? null,
        });
      }
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }
  return (tu.input_summary?.skins ?? []).map((skin) => ({
    name: skin.name,
    count: skin.count,
    listings: [],
    unitPriceCents: 0,
    avgFloat: null,
    condition: skin.condition ?? null,
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

export function payoffPoints(tu: TradeUp): PayoffPoint[] {
  const cost = tu.total_cost_cents;
  return uniqueOutputs(tu)
    .filter((outcome) => outcome.probability > 0)
    .map((outcome) => {
      const profitCents = outcome.estimated_price_cents - cost;
      return {
        name: outcome.skin_name,
        probability: outcome.probability,
        priceCents: outcome.estimated_price_cents,
        profitCents,
        evContributionCents: Math.round(outcome.probability * profitCents),
      };
    })
    .sort((a, b) => a.profitCents - b.profitCents);
}

/** Quantile of the discrete P/L distribution. Points arrive sorted by P/L. */
export function percentileProfitCents(points: PayoffPoint[], quantile: number): number | null {
  if (points.length === 0) return null;
  let cumulative = 0;
  for (const point of points) {
    cumulative += point.probability;
    if (cumulative >= quantile) return point.profitCents;
  }
  return points[points.length - 1]?.profitCents ?? null;
}

export function medianProfitCents(points: PayoffPoint[]): number | null {
  return percentileProfitCents(points, 0.5);
}

export function chanceOfProfit(points: PayoffPoint[]): number {
  return points.reduce((sum, point) => sum + (point.profitCents > 0 ? point.probability : 0), 0);
}

export function worstBest(points: PayoffPoint[]): { worst: number; best: number } | null {
  if (points.length === 0) return null;
  const profits = points.map((point) => point.profitCents);
  return { worst: Math.min(...profits), best: Math.max(...profits) };
}

export function evWaterfall(tu: TradeUp): EvWaterfall {
  const steps = payoffPoints(tu);
  const totalEvCents = steps.reduce((sum, step) => sum + step.evContributionCents, 0);
  const top = [...steps].sort((a, b) => b.evContributionCents - a.evContributionCents)[0] ?? null;
  const topShare = top && totalEvCents !== 0 ? top.evContributionCents / totalEvCents : 0;
  const concentrationNote = top && totalEvCents > 0 && topShare > 0.5
    ? `This is only +EV because of ${top.name}`
    : null;
  return { steps, totalEvCents, topShare, concentrationNote };
}

/**
 * Cumulative EV walk: lifts first, biggest drag last, each bar floating from the
 * running total so the steps connect instead of restating the P/L bars.
 */
export function waterfallBars(tu: TradeUp): { bars: WaterfallBar[]; totalEvCents: number } {
  const steps = payoffPoints(tu).filter((step) => step.evContributionCents !== 0);
  const lifts = steps
    .filter((step) => step.evContributionCents > 0)
    .sort((a, b) => b.evContributionCents - a.evContributionCents);
  const drags = steps
    .filter((step) => step.evContributionCents < 0)
    .sort((a, b) => a.evContributionCents - b.evContributionCents);
  let running = 0;
  const bars = [...lifts, ...drags].map((step) => {
    const startCents = running;
    running += step.evContributionCents;
    return { ...step, startCents, endCents: running };
  });
  return { bars, totalEvCents: running };
}

export function evDrivers(
  points: PayoffPoint[],
  limit: number,
): { drivers: PayoffPoint[]; drags: PayoffPoint[] } {
  const drivers = points
    .filter((point) => point.evContributionCents > 0)
    .sort((a, b) => b.evContributionCents - a.evContributionCents)
    .slice(0, limit);
  const drags = points
    .filter((point) => point.evContributionCents < 0)
    .sort((a, b) => a.evContributionCents - b.evContributionCents)
    .slice(0, limit);
  return { drivers, drags };
}

export type TickFace = {
  name: string;
  x: number;
  /** "end" right-aligns the face to its tick; "start" left-aligns it. */
  align: "start" | "end";
  z: number;
};

/**
 * Places an outcome's render at its tick. A tick left of centre gets its face
 * right-aligned and a tick right of centre gets it left-aligned, so the two
 * halves lean outward instead of colliding over the middle of the rail. Faces
 * at the very ends flip back so they cannot escape the well. When ticks crowd,
 * the likeliest outcome stacks on top and the rest fade behind it.
 */
export function tickFaceLayout(
  points: { name: string; x: number; probability: number }[],
  crowdGap = 14,
): { faces: TickFace[]; crowded: boolean } {
  if (points.length === 0) return { faces: [], crowded: false };
  const byX = [...points].sort((a, b) => a.x - b.x);
  const crowded = byX.some((point, index) => index > 0 && point.x - (byX[index - 1]?.x ?? point.x) < crowdGap);
  const rank = [...points].sort((a, b) => a.probability - b.probability);
  const faces = points.map((point) => {
    let align: "start" | "end" = point.x < 50 ? "end" : "start";
    if (point.x < 14) align = "start";
    if (point.x > 86) align = "end";
    return {
      name: point.name,
      x: point.x,
      align,
      z: rank.findIndex((row) => row.name === point.name) + 1,
    };
  });
  return { faces, crowded };
}

/** "AK-47 | Nightwish" tiles as two lines instead of one ellipsed one. */
export function splitSkinName(name: string): { weapon: string; finish: string } {
  const at = name.indexOf("|");
  if (at === -1) return { weapon: "", finish: name.trim() };
  return { weapon: name.slice(0, at).trim(), finish: name.slice(at + 1).trim() };
}

export function conditionShort(condition: string | undefined): string {
  switch (condition) {
    case "Factory New": return "FN";
    case "Minimal Wear": return "MW";
    case "Field-Tested": return "FT";
    case "Well-Worn": return "WW";
    case "Battle-Scarred": return "BS";
    default: return "";
  }
}

export function listingTotals(listings: TradeUpInput[]): ListingTotals {
  if (listings.length === 0) return { count: 0, totalCents: 0, averageCents: 0 };
  const totalCents = listings.reduce((sum, row) => sum + row.price_cents, 0);
  return {
    count: listings.length,
    totalCents,
    averageCents: Math.round(totalCents / listings.length),
  };
}

export function cdfCurve(tu: TradeUp): CdfPoint[] {
  const points = payoffPoints(tu);
  if (points.length === 0) return [];
  const xs = [...new Set(points.map((point) => point.profitCents))].sort((a, b) => a - b);
  return xs.map((x) => ({
    x,
    p: points.filter((point) => point.profitCents >= x).reduce((sum, point) => sum + point.probability, 0),
  }));
}

/** Inputs are one CS2 rarity below the trade-up output tier. Lime is never a rarity. */
export function inputRarityColor(type: string | undefined): string {
  switch (type) {
    case "covert_knife": return COVERT;
    case "classified_covert": return CLASSIFIED;
    case "restricted_classified": return RESTRICTED;
    case "milspec_restricted": return MILSPEC;
    case "industrial_milspec": return INDUSTRIAL;
    case "consumer_industrial": return CONSUMER;
    case "staircase": return CLASSIFIED;
    default: return CONSUMER;
  }
}

export function outputRarityColor(type: string | undefined): string {
  switch (type) {
    case "covert_knife": return KNIFE;
    case "classified_covert": return COVERT;
    case "restricted_classified": return CLASSIFIED;
    case "milspec_restricted": return RESTRICTED;
    case "industrial_milspec": return MILSPEC;
    case "consumer_industrial": return INDUSTRIAL;
    case "staircase": return KNIFE;
    default: return INDUSTRIAL;
  }
}

/** CS2 rarity name (as the data API spells it) → its tile tint. Never lime. */
export function rarityTint(rarity: string | undefined): string {
  switch (rarity) {
    case "Consumer Grade": return CONSUMER;
    case "Industrial Grade": return INDUSTRIAL;
    case "Mil-Spec Grade":
    case "Mil-Spec": return MILSPEC;
    case "Restricted": return RESTRICTED;
    case "Classified": return CLASSIFIED;
    case "Covert": return COVERT;
    case "Extraordinary":
    case "Contraband": return KNIFE;
    default: return CONSUMER;
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

/** The tier the ten inputs come from — always one below the output tier. */
export function inputRarityLabel(type: string | undefined): string {
  switch (type) {
    case "covert_knife": return "Covert";
    case "classified_covert": return "Classified";
    case "restricted_classified": return "Restricted";
    case "milspec_restricted": return "Mil-Spec";
    case "industrial_milspec": return "Industrial";
    case "consumer_industrial": return "Consumer";
    default: return "Inputs";
  }
}
