/**
 * Semantic search parser.
 *
 * Typing `covert <0.03 <$700` becomes three chips: a tier, a max float and a
 * max price. The grammar and the chip vocabulary are ours — the reference is
 * CSFloat's interaction model, not their code.
 *
 * A token is read as, in order: a comparison (price or float, decided by the
 * `$` marker and by magnitude), a wear, a tier, StatTrak, a paint seed, then
 * finally as free text to match against known item and collection names.
 */

export type ChipKind =
  | "max_price"
  | "min_price"
  | "max_float"
  | "min_float"
  | "wear"
  | "tier"
  | "stattrak"
  | "seed"
  | "item"
  | "collection";

export interface Chip {
  kind: ChipKind;
  /** Shown big on the chip. */
  label: string;
  /** Shown small under the label, naming the field. */
  field: string;
  /** Machine value: cents for prices, 0..1 for floats, else a string. */
  value: string | number;
  /** The token(s) this chip consumed, so the input can render them matched. */
  source: string;
}

export interface ParsedQuery {
  chips: Chip[];
  /** Tokens nothing claimed — kept so the caller can still free-text search. */
  rest: string[];
}

const WEARS: [RegExp, string][] = [
  [/^(fn|factory ?new)$/, "Factory New"],
  [/^(mw|minimal ?wear)$/, "Minimal Wear"],
  [/^(ft|field ?tested)$/, "Field-Tested"],
  [/^(ww|well ?worn)$/, "Well-Worn"],
  [/^(bs|battle ?scarred)$/, "Battle-Scarred"],
];

const TIERS: [RegExp, string, string][] = [
  [/^consumer$/, "Consumer", "consumer_industrial"],
  [/^industrial$/, "Industrial", "industrial_milspec"],
  [/^(milspec|mil-spec)$/, "Mil-Spec", "milspec_restricted"],
  [/^restricted$/, "Restricted", "restricted_classified"],
  [/^classified$/, "Classified", "classified_covert"],
  [/^covert$/, "Covert", "covert_knife"],
  [/^(knife|knives|gloves)$/, "Knife / Gloves", "covert_knife"],
];

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** A bare number under 1 with a decimal point reads as a float, not a price. */
function looksLikeFloat(raw: string, hadDollar: boolean): boolean {
  if (hadDollar) return false;
  const value = Number(raw);
  return raw.includes(".") && value <= 1;
}

function comparisonChip(token: string): Chip | null {
  const match = /^(<=|>=|<|>)\s*\$?\s*([0-9]*\.?[0-9]+)$/.exec(token);
  if (!match) return null;
  const [, operator, raw] = match;
  if (!operator || !raw) return null;
  const hadDollar = token.includes("$");
  const isMax = operator === "<" || operator === "<=";

  if (looksLikeFloat(raw, hadDollar)) {
    const value = Number(raw);
    return {
      kind: isMax ? "max_float" : "min_float",
      label: `${operator} ${raw}`,
      field: isMax ? "Max Float" : "Min Float",
      value,
      source: token,
    };
  }
  const cents = Math.round(Number(raw) * 100);
  return {
    kind: isMax ? "max_price" : "min_price",
    label: `${operator} ${money(cents)}`,
    field: isMax ? "Max Price" : "Min Price",
    value: cents,
    source: token,
  };
}

export interface NameHit {
  name: string;
  rarity?: string;
  kind?: "item" | "collection";
}

/**
 * Fuzzy match over cached names: every query word must appear, and shorter
 * names win so "ak nightwish" prefers the AK-47 over a longer sticker name.
 */
export function matchNames(query: string, names: NameHit[], limit = 8): NameHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const scored: { hit: NameHit; score: number }[] = [];
  for (const hit of names) {
    const haystack = hit.name.toLowerCase().replace(/[★|]/g, "");
    if (!words.every((word) => haystack.includes(word))) continue;
    const starts = haystack.startsWith(words[0] ?? "") ? -40 : 0;
    scored.push({ hit, score: haystack.length + starts });
  }
  return scored.sort((a, b) => a.score - b.score).slice(0, limit).map((row) => row.hit);
}

/** Splits on spaces but keeps a quoted phrase together. */
export function tokenize(text: string): string[] {
  return (text.match(/"[^"]*"|\S+/g) ?? []).map((token) => token.replace(/^"|"$/g, ""));
}

const OPERATOR_LIKE = /^[<>#]|^\$/;

/**
 * The words the cursor is still inside, used to drive completion. A chip may
 * already have claimed these words — completion is about what is being typed,
 * not about what the parser managed to place, so the picture keeps showing.
 */
export function typingTail(text: string, maxWords = 4): string {
  if (/\s$/.test(text)) return "";
  const tokens = tokenize(text);
  const words: string[] = [];
  for (let i = tokens.length - 1; i >= 0 && words.length < maxWords; i--) {
    const token = tokens[i] ?? "";
    if (OPERATOR_LIKE.test(token)) break;
    words.unshift(token);
  }
  return words.join(" ").trim();
}

export function parseQuery(text: string, names: NameHit[] = []): ParsedQuery {
  const chips: Chip[] = [];
  const rest: string[] = [];
  const words: string[] = [];

  for (const token of tokenize(text)) {
    const lower = token.toLowerCase();

    const comparison = comparisonChip(lower);
    if (comparison) {
      chips.push(comparison);
      continue;
    }

    const wear = WEARS.find(([pattern]) => pattern.test(lower));
    if (wear) {
      chips.push({ kind: "wear", label: wear[1], field: "Wear", value: wear[1], source: token });
      continue;
    }

    const tier = TIERS.find(([pattern]) => pattern.test(lower));
    if (tier) {
      chips.push({ kind: "tier", label: tier[1], field: "Tier", value: tier[2], source: token });
      continue;
    }

    if (/^(st|stattrak|stattrak™)$/.test(lower)) {
      chips.push({ kind: "stattrak", label: "StatTrak™", field: "Category", value: "stattrak", source: token });
      continue;
    }

    if (/^#\d+$/.test(lower)) {
      chips.push({ kind: "seed", label: lower, field: "Paint Seed", value: lower.slice(1), source: token });
      continue;
    }

    words.push(token);
  }

  // Longest run of leftover words that names something we know wins.
  if (words.length > 0) {
    let claimed = 0;
    for (let take = words.length; take >= 1; take--) {
      const phrase = words.slice(0, take).join(" ");
      const [hit] = matchNames(phrase, names, 1);
      if (hit) {
        chips.push({
          kind: hit.kind === "collection" ? "collection" : "item",
          label: hit.name,
          field: hit.kind === "collection" ? "Collection" : "Item",
          value: hit.name,
          source: phrase,
        });
        claimed = take;
        break;
      }
    }
    rest.push(...words.slice(claimed));
  }

  return { chips, rest };
}

export interface BoardParams {
  skin?: string;
  collection?: string;
  type?: string;
  max_cost?: string;
  min_profit?: string;
}

/** Chips → the query parameters `/api/trade-ups` already accepts. */
export function chipsToBoardParams(chips: Chip[], rest: string[] = []): BoardParams {
  const params: BoardParams = {};
  for (const chip of chips) {
    if (chip.kind === "item") params.skin = String(chip.value);
    if (chip.kind === "collection") params.collection = String(chip.value);
    if (chip.kind === "tier") params.type = String(chip.value);
    if (chip.kind === "max_price") params.max_cost = String(chip.value);
    if (chip.kind === "min_price") params.min_profit = String(chip.value);
  }
  if (!params.skin && rest.length > 0) params.skin = rest.join(" ");
  return params;
}

export interface SkinParams {
  search?: string;
  rarity?: string;
  maxPriceCents?: number;
  maxFloat?: number;
  minFloat?: number;
  wear?: string;
}

const TIER_TO_RARITY: Record<string, string> = {
  consumer_industrial: "Consumer Grade",
  industrial_milspec: "Industrial Grade",
  milspec_restricted: "Mil-Spec Grade",
  restricted_classified: "Restricted",
  classified_covert: "Classified",
  covert_knife: "Covert",
};

/** Chips → the skins index filters. Floats and wear filter client-side. */
export function chipsToSkinParams(chips: Chip[], rest: string[] = []): SkinParams {
  const params: SkinParams = {};
  const terms: string[] = [...rest];
  for (const chip of chips) {
    if (chip.kind === "item" || chip.kind === "collection") terms.push(String(chip.value));
    if (chip.kind === "tier") params.rarity = TIER_TO_RARITY[String(chip.value)];
    if (chip.kind === "max_price") params.maxPriceCents = Number(chip.value);
    if (chip.kind === "max_float") params.maxFloat = Number(chip.value);
    if (chip.kind === "min_float") params.minFloat = Number(chip.value);
    if (chip.kind === "wear") params.wear = String(chip.value);
  }
  if (terms.length > 0) params.search = terms.join(" ");
  return params;
}
