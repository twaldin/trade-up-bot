import { formatDollars } from "../src/utils/format.js";
import { TRADE_UP_TYPE_LABELS, detailTypeLabel } from "./types.js";

const TITLE_MAX = 60;
const TITLE_BRAND = " | TradeUpBot";

/** Input rarity for the detail heading. Knives start at Covert. */
const INPUT_RARITY: Record<string, string> = {
  covert_knife: "Covert",
  classified_covert: "Classified",
  restricted_classified: "Restricted",
  milspec_restricted: "Mil-Spec",
  industrial_milspec: "Industrial",
  consumer_industrial: "Consumer",
};

export function signedExpectedPl(profitCents: number): string {
  if (profitCents > 0) return `+${formatDollars(profitCents)}`;
  return formatDollars(profitCents);
}

function cleanOutcomeName(name: string): string {
  return name.replace(/★/g, "").replace(/ \| /g, " ").replace(/\s+/g, " ").trim();
}

function likeliestOutcomeName(outcomes: { skin_name: string; probability: number }[]): string {
  let best: { skin_name: string; probability: number } | undefined;
  for (const outcome of outcomes) {
    if (!best || outcome.probability > best.probability) best = outcome;
  }
  return best ? cleanOutcomeName(best.skin_name) : "";
}

/**
 * Social/document title. No percentage. 60 characters or fewer.
 * Name form, then `${typeLabel} Trade-Up: …`, then `CS2 Trade-Up: …`.
 */
export function shareDocumentTitle(
  typeLabel: string,
  profitCents: number,
  outcomes: { skin_name: string; probability: number }[],
): string {
  const money = signedExpectedPl(profitCents);
  const tail = `: ${money} Expected P/L${TITLE_BRAND}`;
  const name = likeliestOutcomeName(outcomes);
  const named = name ? `${name}${tail}` : "";
  if (named.length > 0 && named.length <= TITLE_MAX) return named;
  const typed = `${typeLabel} Trade-Up${tail}`;
  if (typed.length <= TITLE_MAX) return typed;
  const generic = `CS2 Trade-Up${tail}`;
  return generic.length <= TITLE_MAX ? generic : generic.slice(0, TITLE_MAX);
}

/** One-line swap if GTM sends a refined detail heading. */
export function detailTradeUpHeading(type: string): string {
  const input = INPUT_RARITY[type] ?? detailTypeLabel(type);
  const output = TRADE_UP_TYPE_LABELS[type] ?? type;
  return `${input} to ${output} Trade-Up`;
}

/**
 * Detail tab and crawler title. Heading helper plus the existing
 * `— $X expected P/L (chance above cost) | TradeUpBot` tail.
 */
export function detailTradeUpDocumentTitle(
  type: string,
  profitCents: number,
  chanceLabel: string,
): string {
  const profit = formatDollars(profitCents);
  return `${detailTradeUpHeading(type)} — ${profit} expected P/L (${chanceLabel} above cost)${TITLE_BRAND}`;
}

export function tradeUpCountPhrase(count: number): string {
  const n = Math.abs(Math.trunc(count));
  return `${n} trade-up${n === 1 ? "" : "s"}`;
}
