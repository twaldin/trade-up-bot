import { formatOdds } from "../src/preview/lib/board.js";
import { formatDollars } from "../src/utils/format.js";

const TITLE_MAX = 60;
const BRAND = " | TradeUpBot";

export const REPRICE_CAVEAT = "Prices refresh continuously. Check each listing before you buy.";

const PAIRS: Record<string, string> = {
  consumer_industrial: "Consumer to Industrial",
  industrial_milspec: "Industrial to Mil-Spec",
  milspec_restricted: "Mil-Spec to Restricted",
  restricted_classified: "Restricted to Classified",
  classified_covert: "Classified to Covert",
};

const GLOVE_NAME = /Gloves|Hand Wraps/i;

export interface TradeUpOutcomeName {
  skin_name: string;
  probability: number;
  estimated_price_cents?: number;
}

export function signedExpectedPl(profitCents: number): string {
  if (profitCents > 0) return `+${formatDollars(profitCents)}`;
  if (profitCents < 0) return `\u2212${formatDollars(-profitCents)}`;
  return formatDollars(0);
}

export function signedPercent(value: number): string {
  const v = Math.round(value * 10) / 10;
  return v < 0 ? `\u2212${Math.abs(v).toFixed(1)}` : v.toFixed(1);
}

export function cleanListingName(name: string): string {
  return name.replace(/★/g, "").replace(/ \| /g, " ").replace(/\s+/g, " ").trim();
}

export function cleanCollectionName(name: string): string {
  return name.replace(/^The\s+/i, "").replace(/\s+Collection$/i, "").replace(/\s+/g, " ").trim();
}

/** Rarity pair. Knife/glove splits on whether every output is a knife or gloves. */
export function tradeUpPair(type: string, outcomes: { skin_name: string }[] = []): string {
  if (type === "staircase") return "Staircase";
  if (type === "covert_knife") {
    if (outcomes.length === 0) return "Covert to Knife/Glove";
    const gloves = outcomes.filter((outcome) => GLOVE_NAME.test(outcome.skin_name)).length;
    if (gloves === outcomes.length) return "Covert to Gloves";
    if (gloves === 0) return "Covert to Knife";
    return "Covert to Knife/Glove";
  }
  return PAIRS[type] ?? "CS2";
}

function uniqueCollections(collections: string[]): string[] {
  const counts = new Map<string, number>();
  for (const name of collections) {
    const clean = cleanCollectionName(name);
    if (!clean) continue;
    counts.set(clean, (counts.get(clean) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);
}

/** 'A', 'A + B', or 'A + N more'. */
export function collectionDescriptor(collections: string[]): string {
  const names = uniqueCollections(collections);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} + ${names[1]}`;
  return `${names[0]} + ${names.length - 1} more`;
}

function likeliestOutcome(outcomes: TradeUpOutcomeName[]): TradeUpOutcomeName | undefined {
  let best: TradeUpOutcomeName | undefined;
  for (const outcome of outcomes) {
    if (!best || outcome.probability > best.probability) {
      best = outcome;
      continue;
    }
    if (outcome.probability !== best.probability) continue;
    const price = outcome.estimated_price_cents ?? Number.POSITIVE_INFINITY;
    const bestPrice = best.estimated_price_cents ?? Number.POSITIVE_INFINITY;
    if (price < bestPrice) best = outcome;
  }
  return best;
}

/** Title descriptor: a dominant output name, otherwise the collection join. */
export function tradeUpTitleDescriptor(
  type: string,
  outcomes: TradeUpOutcomeName[],
  collections: string[],
): string {
  const best = likeliestOutcome(outcomes);
  if (type !== "covert_knife" && best && best.probability >= 0.5) {
    const name = cleanListingName(best.skin_name);
    if (name) return name;
  }
  return collectionDescriptor(collections);
}

function fitTitle(candidates: string[]): string {
  for (const candidate of candidates) {
    if (candidate.length > 0 && candidate.length <= TITLE_MAX) return candidate;
  }
  const last = candidates[candidates.length - 1] ?? "";
  return last.length <= TITLE_MAX ? last : last.slice(0, TITLE_MAX);
}

export function tradeUpDocumentTitle(
  type: string,
  outcomes: TradeUpOutcomeName[],
  collections: string[],
): string {
  const pair = tradeUpPair(type, outcomes);
  const descriptor = tradeUpTitleDescriptor(type, outcomes, collections);
  const first = uniqueCollections(collections)[0] ?? "";
  const withDescriptor = (label: string, value: string) => (
    value ? `${label}: ${value}${BRAND}` : `${label}${BRAND}`
  );
  return fitTitle([
    withDescriptor(`${pair} Trade-Up`, descriptor),
    withDescriptor(pair, descriptor),
    withDescriptor(`${pair} Trade-Up`, first),
    withDescriptor(pair, first),
    `${pair} Trade-Up${BRAND}`,
  ]);
}

export function tradeUpOgTitle(type: string, profitCents: number, outcomes: TradeUpOutcomeName[] = []): string {
  const pair = tradeUpPair(type, outcomes);
  const money = signedExpectedPl(profitCents);
  return fitTitle([
    `${pair} Trade-Up: ${money} Expected P/L${BRAND}`,
    `${pair}: ${money} Expected P/L${BRAND}`,
    `${pair} Trade-Up${BRAND}`,
  ]);
}

export function tradeUpH1(
  type: string,
  profitCents: number,
  roiPercentage: number | null,
  outcomes: TradeUpOutcomeName[] = [],
): string {
  const pair = tradeUpPair(type, outcomes);
  const profit = signedExpectedPl(profitCents);
  const roi = signedPercent(roiPercentage ?? 0);
  return `${pair} Trade-Up — ${profit} Expected P/L (${roi}% ROI)`;
}

export function tradeUpDescription(input: {
  type: string;
  profitCents: number;
  costCents: number;
  chanceToProfit: number;
  outcomes?: { skin_name: string }[];
  inputNames: string[];
}): string {
  const money = signedExpectedPl(input.profitCents);
  const chance = formatOdds(input.chanceToProfit ?? 0);
  const cost = formatDollars(input.costCents);
  const names = input.inputNames.map(cleanListingName).filter(Boolean).slice(0, 3).join(", ");
  const inputs = names ? ` Inputs: ${names}.` : "";
  return `${money} expected P/L after fees, ${chance} of outcomes above cost, ${cost} cost.${inputs}`;
}

export function tradeUpCountPhrase(count: number): string {
  const n = Math.abs(Math.trunc(count));
  return `${n} trade-up${n === 1 ? "" : "s"}`;
}
