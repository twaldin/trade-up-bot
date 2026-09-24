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
}

export function signedExpectedPl(profitCents: number): string {
  if (profitCents > 0) return `+${formatDollars(profitCents)}`;
  return formatDollars(profitCents);
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
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of collections) {
    const clean = cleanCollectionName(name);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
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
    if (!best || outcome.probability > best.probability) best = outcome;
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

export function tradeUpOgTitle(type: string, profitCents: number, outcomes: { skin_name: string }[] = []): string {
  const pair = tradeUpPair(type, outcomes);
  const money = signedExpectedPl(profitCents);
  return fitTitle([
    `${pair} Trade-Up: ${money} Expected P/L${BRAND}`,
    `${pair}: ${money} Expected P/L${BRAND}`,
  ]);
}

export function tradeUpH1(
  type: string,
  profitCents: number,
  roiPercentage: number | null,
  outcomes: { skin_name: string }[] = [],
): string {
  const pair = tradeUpPair(type, outcomes);
  const profit = formatDollars(profitCents);
  const roi = roiPercentage?.toFixed(1) ?? "0";
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
