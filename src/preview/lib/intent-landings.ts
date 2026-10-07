/**
 * Search landing pages: best trade-ups right now, and one page per rarity tier.
 * Copy is shared by the crawler HTML and the kit page. Ad-safe: expected P/L
 * after fees, no promised outcomes. Prices stay integer cents.
 */
import { formatOdds, rarityLabel } from "./board.js";
import { boardFeeLine } from "./fees.js";
import { FREE_VIEW_DELAY_NOTE, OPEN_BOARD_CTA, REPRICE_CAVEAT, SIGN_IN_TO_CLAIM } from "./copy.js";
import { proPriceLine } from "./pro-pricing.js";
import { formatDollars } from "../../utils/format.js";

export const INTENT_ORIGIN = "https://tradeupbot.app";

/** Table floor. Matches `profit_cents > 100` (above $1 expected P/L). */
export const INTENT_MIN_PROFIT_CENTS = 101;

export interface IntentRow {
  id: number;
  type: string;
  total_cost_cents: number;
  profit_cents: number;
  roi_percentage: number;
  chance_to_profit: number;
}

export interface IntentSnapshot {
  active: number | null;
  profitable: number | null;
  top: IntentRow[];
  byType: Record<string, IntentRow[]>;
}

export const EMPTY_INTENT_SNAPSHOT: IntentSnapshot = {
  active: null,
  profitable: null,
  top: [],
  byType: {},
};

export interface IntentFaq {
  q: string;
  a: string;
}

export interface TradeUpTier {
  slug: string;
  type: string;
  inputCount: number;
  inputRarity: string;
  outputName: string;
  title: string;
  description: string;
  h1: string;
  points: string[];
  faq: IntentFaq[];
}

const WEIGHT = (count: number) =>
  `Each collection's share of the draw equals how many of the ${count} inputs came from it, divided by ${count}. That share is split evenly across the next-rarity skins in the collection.`;

export const TRADE_UP_TIERS: TradeUpTier[] = [
  {
    slug: "knife",
    type: "covert_knife",
    inputCount: 5,
    inputRarity: "Covert",
    outputName: "a knife or glove",
    title: "Knife and Glove CS2 Trade-Ups — 5 Covert Inputs | TradeUpBot",
    description: "Knife and glove CS2 trade-ups take 5 Covert skins. The draw follows the case mix, and output prices use sales near the computed float. Live expected P/L is after fees.",
    h1: "Knife and glove trade-ups",
    points: [
      "This tier takes 5 Covert skins, not 10. The output is one knife or glove from the cases those Coverts belong to.",
      "Three Coverts from Dreams & Nightmares and two from Kilowatt means 60% of the draw is a Dreams & Nightmares knife or glove and 40% is a Kilowatt knife or glove, then split across the finishes in each case.",
      "One expensive finish can carry the average. Read the share of outcomes above cost next to expected P/L before you buy the inputs.",
      "Output prices come from sales near the computed float, so two trade-ups with the same finishes can differ when the floats differ.",
    ],
    faq: [
      {
        q: "Why do knife trade-ups take 5 skins?",
        a: "Covert inputs trade up to a knife or glove, and that trade-up takes 5 Coverts rather than 10. The output comes from the case pool tied to those Coverts.",
      },
      {
        q: "Are knife prices the same at every float?",
        a: "No. TradeUpBot prices knife and glove outputs from sales near the computed float. Two trade-ups with the same finishes can show different expected P/L when the input floats differ.",
      },
    ],
  },
  {
    slug: "covert",
    type: "classified_covert",
    inputCount: 10,
    inputRarity: "Classified",
    outputName: "one Covert skin",
    title: "Covert CS2 Trade-Ups — 10 Classified Inputs | TradeUpBot",
    description: "A Covert CS2 trade-up takes 10 Classified skins and draws one Covert. Collection mix sets each outcome's share. Live expected P/L is after marketplace fees.",
    h1: "Covert trade-ups",
    points: [
      "Ten Classified skins go in. One Covert skin comes out, from the collections represented by those inputs.",
      "Seven Recoil inputs and three Fracture inputs means 70% of the draw is a Recoil Covert and 30% is a Fracture Covert, then split evenly across the Covert skins in each collection.",
      "Covert prices move a lot with skin and float. The collection mix is the decision, not a single average price for the tier.",
    ],
    faq: [
      {
        q: "How many skins go into a Covert trade-up?",
        a: "10 Classified skins. The output is one Covert skin from the collections those inputs came from.",
      },
      {
        q: "What does above cost mean on a Covert trade-up?",
        a: "It is the share of possible Covert outcomes whose estimated sale, after the seller fee, is higher than the cost of the 10 inputs. A high expected P/L can still come with a low share above cost when one expensive outcome carries the average.",
      },
    ],
  },
  {
    slug: "classified",
    type: "restricted_classified",
    inputCount: 10,
    inputRarity: "Restricted",
    outputName: "one Classified skin",
    title: "Classified CS2 Trade-Ups — 10 Restricted Inputs | TradeUpBot",
    description: "A Classified CS2 trade-up takes 10 Restricted skins and draws one Classified skin. See how the collection mix sets the draw, plus live expected P/L after fees.",
    h1: "Classified trade-ups",
    points: [
      "Ten Restricted skins go in. One Classified skin comes out.",
      "Players use this tier on its own, and as the step that produces Coverts for a later knife trade-up. Each step has its own cost and its own draw.",
      WEIGHT(10),
    ],
    faq: [
      {
        q: "What comes out of a Classified trade-up?",
        a: "One Classified skin. Which one depends on the collections of the 10 Restricted inputs, weighted by how many inputs came from each collection.",
      },
    ],
  },
  {
    slug: "restricted",
    type: "milspec_restricted",
    inputCount: 10,
    inputRarity: "Mil-Spec",
    outputName: "one Restricted skin",
    title: "Restricted CS2 Trade-Ups — 10 Mil-Spec Inputs | TradeUpBot",
    description: "A Restricted CS2 trade-up takes 10 Mil-Spec skins and draws one Restricted skin. Expected P/L after fees can be positive while most outcomes still sit below cost.",
    h1: "Restricted trade-ups",
    points: [
      "Ten Mil-Spec skins go in. One Restricted skin comes out.",
      "A positive expected P/L can sit next to a small share of outcomes above cost. Read both numbers. The average can be carried by one outcome you are unlikely to draw.",
      WEIGHT(10),
    ],
    faq: [
      {
        q: "Can expected P/L be positive when most outcomes are below cost?",
        a: "Yes. Expected P/L is the probability-weighted average. One high-priced outcome can lift the average while most outcomes still sell for less than the inputs cost.",
      },
    ],
  },
  {
    slug: "mil-spec",
    type: "industrial_milspec",
    inputCount: 10,
    inputRarity: "Industrial Grade",
    outputName: "one Mil-Spec skin",
    title: "Mil-Spec CS2 Trade-Ups — 10 Industrial Inputs | TradeUpBot",
    description: "A Mil-Spec CS2 trade-up takes 10 Industrial Grade skins and draws one Mil-Spec skin. Fees are a larger share of these cheaper inputs. Live expected P/L includes them.",
    h1: "Mil-Spec trade-ups",
    points: [
      "Ten Industrial Grade skins go in. One Mil-Spec skin comes out.",
      "Input prices are lower here, so buyer and seller fees are a larger share of the trade. A thin expected P/L can disappear once you are looking at a different listing.",
      WEIGHT(10),
    ],
    faq: [
      {
        q: "Why do fees matter more on Mil-Spec trade-ups?",
        a: "The skins cost less, so a flat buyer fee and the seller fee are a bigger fraction of the trade. Compare expected P/L after fees, not the sticker prices alone.",
      },
    ],
  },
  {
    slug: "industrial",
    type: "consumer_industrial",
    inputCount: 10,
    inputRarity: "Consumer Grade",
    outputName: "one Industrial Grade skin",
    title: "Industrial CS2 Trade-Ups — 10 Consumer Inputs | TradeUpBot",
    description: "An Industrial CS2 trade-up takes 10 Consumer Grade skins and draws one Industrial Grade skin. The same collection weighting applies. Live expected P/L is after fees.",
    h1: "Industrial trade-ups",
    points: [
      "Ten Consumer Grade skins go in. One Industrial Grade skin comes out.",
      "This is the bottom of the gun ladder. The draw rule is the same as the higher tiers: collection mix sets the shares, and fees are already in the expected P/L.",
      WEIGHT(10),
    ],
    faq: [
      {
        q: "Do Consumer inputs follow a different draw?",
        a: "No. Ten skins of one rarity still return one skin of the next rarity. A collection's share equals its input count divided by 10.",
      },
    ],
  },
];

export const BEST_TRADE_UPS_PATH = "/best-cs2-trade-ups";
export const TRADE_UP_TIERS_PATH = "/trade-ups/tiers";

export function tierPath(slug: string): string {
  return `${TRADE_UP_TIERS_PATH}/${slug}`;
}

export function intentBoardHref(type?: string): string {
  const params = new URLSearchParams({ sort: "profit", order: "desc" });
  if (type) params.set("type", type);
  return `/trade-ups?${params.toString()}`;
}

export interface IntentSitemapEntry {
  path: string;
  priority: string;
  freq: string;
}

export function intentSitemapEntries(): IntentSitemapEntry[] {
  return [
    { path: BEST_TRADE_UPS_PATH, priority: "0.8", freq: "daily" },
    { path: TRADE_UP_TIERS_PATH, priority: "0.7", freq: "weekly" },
    ...TRADE_UP_TIERS.map((tier) => ({ path: tierPath(tier.slug), priority: "0.6", freq: "daily" as const })),
  ];
}

export type IntentKind = "best" | "index" | "tier";

export interface IntentPage {
  kind: IntentKind;
  path: string;
  title: string;
  description: string;
  h1: string;
  tier: TradeUpTier | null;
}

const BEST_PAGE: IntentPage = {
  kind: "best",
  path: BEST_TRADE_UPS_PATH,
  title: "Best CS2 Trade-Ups Right Now | TradeUpBot",
  description: "Highest expected P/L on the TradeUpBot board right now, priced from live CSFloat, DMarket, Skinport, and Buff listings after marketplace fees.",
  h1: "Best CS2 trade-ups right now",
  tier: null,
};

const INDEX_PAGE: IntentPage = {
  kind: "index",
  path: TRADE_UP_TIERS_PATH,
  title: "CS2 Trade-Ups by Rarity — Covert, Classified, Knife | TradeUpBot",
  description: "How each CS2 trade-up tier is drawn: input count, the next rarity, and collection weighting. Live expected P/L after fees for every tier.",
  h1: "CS2 trade-ups by rarity",
  tier: null,
};

export function intentPageForPath(pathname: string): IntentPage | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path === BEST_PAGE.path) return BEST_PAGE;
  if (path === INDEX_PAGE.path) return INDEX_PAGE;
  const prefix = `${TRADE_UP_TIERS_PATH}/`;
  if (!path.startsWith(prefix)) return null;
  const slug = path.slice(prefix.length);
  if (!slug || slug.includes("/")) return null;
  const tier = TRADE_UP_TIERS.find((entry) => entry.slug === slug);
  if (!tier) return null;
  return {
    kind: "tier",
    path: tierPath(tier.slug),
    title: tier.title,
    description: tier.description,
    h1: tier.h1,
    tier,
  };
}

export function intentPages(): IntentPage[] {
  return [BEST_PAGE, INDEX_PAGE, ...TRADE_UP_TIERS.map((tier) => intentPageForPath(tierPath(tier.slug))!).filter(Boolean)];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function feeParagraph(): string {
  const fee = boardFeeLine();
  return `${fee.cost} ${fee.outcomes}`;
}

function countSentence(snapshot: IntentSnapshot): string | null {
  if (snapshot.active == null || snapshot.profitable == null) return null;
  const active = snapshot.active.toLocaleString("en-US");
  const profitable = snapshot.profitable.toLocaleString("en-US");
  return `${active} active trade-ups, ${profitable} with positive expected profit after fees.`;
}

function money(cents: number): string {
  return formatDollars(cents);
}

function profitCell(cents: number): string {
  return cents > 0 ? `+${formatDollars(cents)}` : formatDollars(cents);
}

function rowsFor(page: IntentPage, snapshot: IntentSnapshot): IntentRow[] {
  if (page.kind === "best") return snapshot.top;
  if (page.kind === "tier" && page.tier) return snapshot.byType[page.tier.type] ?? [];
  return [];
}

function tableHtml(rows: IntentRow[], showTier: boolean): string {
  if (rows.length === 0) {
    return `<p>No active trade-ups above $1 expected P/L in this list right now. Listings sell and prices move. <a href="/trade-ups">${OPEN_BOARD_CTA}</a>. ${escapeHtml(FREE_VIEW_DELAY_NOTE)}</p>`;
  }
  const head = showTier
    ? "<th>Trade-up</th><th>Tier</th><th>Cost</th><th>Expected P/L</th><th>ROI</th><th>Above cost</th>"
    : "<th>Trade-up</th><th>Cost</th><th>Expected P/L</th><th>ROI</th><th>Above cost</th>";
  const body = rows.map((row) => {
    const tierCell = showTier ? `<td>${escapeHtml(rarityLabel(row.type))}</td>` : "";
    const roi = Number.isFinite(row.roi_percentage) ? `${row.roi_percentage.toFixed(1)}%` : "";
    return `<tr><td><a href="/trade-ups/${row.id}">#${row.id}</a></td>${tierCell}<td>${money(row.total_cost_cents)}</td><td>${profitCell(row.profit_cents)}</td><td>${roi}</td><td>${formatOdds(row.chance_to_profit)}</td></tr>`;
  }).join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function relatedHtml(page: IntentPage): string {
  const tierLinks = TRADE_UP_TIERS.map((tier) =>
    `<li><a href="${tierPath(tier.slug)}">${escapeHtml(tier.h1)}</a> — ${tier.inputCount} ${escapeHtml(tier.inputRarity)} in, ${escapeHtml(tier.outputName)} out</li>`,
  ).join("");
  const neighbors = page.tier
    ? `<li><a href="${intentBoardHref(page.tier.type)}">Open ${escapeHtml(page.tier.h1)} on the board</a></li>`
    : `<li><a href="${intentBoardHref()}">Open the board sorted by expected P/L</a></li>`;
  return `<nav aria-label="Related pages"><h2>Related</h2><ul>
<li><a href="${BEST_TRADE_UPS_PATH}">Best CS2 trade-ups right now</a></li>
<li><a href="${TRADE_UP_TIERS_PATH}">Trade-ups by rarity</a></li>
${neighbors}
<li><a href="/calculator">CS2 trade-up calculator</a></li>
<li><a href="/collections">Browse collections</a></li>
<li><a href="/trade-ups/collection/dreams-nightmares">Dreams &amp; Nightmares trade-ups</a></li>
<li><a href="/trade-ups/collection/recoil">Recoil trade-ups</a></li>
<li><a href="/blog/how-cs2-trade-ups-work/">How CS2 trade-ups work</a></li>
<li><a href="/blog/cs2-trade-up-marketplace-fees/">Marketplace fees</a></li>
<li><a href="/blog/cs2-trade-up-probability-expected-value/">Probability and expected value</a></li>
</ul>
${page.kind === "index" ? "" : `<h2>Every tier</h2><ul>${tierLinks}</ul>`}
</nav>`;
}

function faqFor(page: IntentPage): IntentFaq[] {
  const fees: IntentFaq = {
    q: "Which fees are included?",
    a: `${feeParagraph()} ${REPRICE_CAVEAT}`,
  };
  if (page.kind === "best") {
    return [
      {
        q: "Does a positive expected P/L mean this trade-up makes money?",
        a: "No. Expected P/L is the average result if the same prices were drawn over and over. One draw can land on an outcome priced below the input cost. Listings also sell, and prices move.",
      },
      fees,
    ];
  }
  if (page.kind === "index") {
    return [
      {
        q: "Does every CS2 trade-up use the same input count?",
        a: "Gun tiers take 10 skins of one rarity and return one skin of the next rarity. Knife and glove trade-ups take 5 Covert skins.",
      },
      {
        q: "What decides which skin comes out?",
        a: "The collections of the inputs. A collection's share of the draw equals how many inputs came from it, divided by the input count. That share is split evenly across the next-rarity skins in the collection.",
      },
      fees,
    ];
  }
  return [...(page.tier?.faq ?? []), fees];
}

function breadcrumb(page: IntentPage): { html: string; items: { name: string; item?: string }[] } {
  const home = { name: "Home", item: `${INTENT_ORIGIN}/` };
  const tradeUps = { name: "Trade-Ups", item: `${INTENT_ORIGIN}/trade-ups` };
  if (page.kind === "best") {
    const items = [home, tradeUps, { name: "Best right now" }];
    return {
      items,
      html: `<nav aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li><li><a href="/trade-ups">Trade-Ups</a></li><li>Best right now</li></ol></nav>`,
    };
  }
  const tiers = { name: "By rarity", item: `${INTENT_ORIGIN}${TRADE_UP_TIERS_PATH}` };
  if (page.kind === "index") {
    return {
      items: [home, tradeUps, { name: "By rarity" }],
      html: `<nav aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li><li><a href="/trade-ups">Trade-Ups</a></li><li>By rarity</li></ol></nav>`,
    };
  }
  return {
    items: [home, tradeUps, tiers, { name: page.h1 }],
    html: `<nav aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li><li><a href="/trade-ups">Trade-Ups</a></li><li><a href="${TRADE_UP_TIERS_PATH}">By rarity</a></li><li>${escapeHtml(page.h1)}</li></ol></nav>`,
  };
}

export interface IntentDocument {
  title: string;
  description: string;
  url: string;
  h1: string;
  bodyHtml: string;
  jsonLd: Record<string, unknown>[];
  faq: IntentFaq[];
}

export function renderIntentDocument(page: IntentPage, snapshot: IntentSnapshot): IntentDocument {
  const crumb = breadcrumb(page);
  const counts = countSentence(snapshot);
  const faq = faqFor(page);
  const rows = rowsFor(page, snapshot);
  const showTier = page.kind === "best";

  let intro = "";
  if (page.kind === "best") {
    intro = `<p>These are the active trade-ups with the highest expected P/L after fees. Expected P/L is the probability-weighted value of the outputs minus the input cost. It is an average across the draw, so one trade-up can still come back below cost.</p>`
      + (counts ? `<p>${escapeHtml(counts)}</p>` : "")
      + `<p>The table keeps trade-ups above $1 expected P/L whose listings are still active. ${escapeHtml(feeParagraph())} ${escapeHtml(REPRICE_CAVEAT)}</p>`
      + tableHtml(rows, showTier);
  } else if (page.kind === "index") {
    const cards = TRADE_UP_TIERS.map((tier) => {
      const top = (snapshot.byType[tier.type] ?? [])[0];
      const live = top
        ? ` Highest expected P/L right now: <a href="/trade-ups/${top.id}">${profitCell(top.profit_cents)}</a>, ${formatOdds(top.chance_to_profit)} of outcomes above cost.`
        : "";
      return `<h2><a href="${tierPath(tier.slug)}">${escapeHtml(tier.h1)}</a></h2><p>${escapeHtml(tier.points[0] ?? "")}${live}</p>`;
    }).join("");
    intro = `<p>A CS2 trade-up exchanges skins of one rarity for one skin of the next rarity. Gun tiers take 10 inputs. Knife and glove trade-ups take 5 Covert inputs. The output skin is not a fixed result: the collections you put in set the shares.</p>`
      + (counts ? `<p>${escapeHtml(counts)}</p>` : "")
      + `<p>${escapeHtml(feeParagraph())}</p>`
      + cards;
  } else {
    const tier = page.tier!;
    const points = tier.points.map((point) => `<p>${escapeHtml(point)}</p>`).join("");
    intro = `<p>${tier.inputCount} ${escapeHtml(tier.inputRarity)} skins in. Output: ${escapeHtml(tier.outputName)}.</p>`
      + points
      + (counts ? `<p>${escapeHtml(counts)} The table is this tier only, above $1 expected P/L, listings still active.</p>` : `<p>The table is this tier only, above $1 expected P/L, listings still active.</p>`)
      + `<p>${escapeHtml(feeParagraph())} ${escapeHtml(REPRICE_CAVEAT)}</p>`
      + tableHtml(rows, false);
  }

  const faqHtml = `<section><h2>Common questions</h2>${faq.map((item) => `<h3>${escapeHtml(item.q)}</h3><p>${escapeHtml(item.a)}</p>`).join("")}</section>`;
  const boardHref = page.tier ? intentBoardHref(page.tier.type) : intentBoardHref();
  const cta = `<p><a href="${boardHref}">${OPEN_BOARD_CTA}</a>. ${escapeHtml(FREE_VIEW_DELAY_NOTE)} ${escapeHtml(SIGN_IN_TO_CLAIM)}</p>`
    + `<p><a href="/pricing">See Pro plans</a>. Pro is ${escapeHtml(proPriceLine("monthly"))}, with the board in real time, Verify (20/hr), and Claim (10/hr, up to 5 active). The free board is delayed 3 hours.</p>`;
  const bodyHtml = `${crumb.html}<h1>${escapeHtml(page.h1)}</h1>${intro}${faqHtml}${cta}${relatedHtml(page)}`;

  const itemList = rows.slice(0, 10).map((row, index) => ({
    "@type": "ListItem",
    position: index + 1,
    url: `${INTENT_ORIGIN}/trade-ups/${row.id}`,
    name: `${rarityLabel(row.type)} — ${profitCell(row.profit_cents)} expected P/L`,
  }));

  const jsonLd: Record<string, unknown>[] = [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: crumb.items.map((item, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: item.name,
        ...(item.item ? { item: item.item } : {}),
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faq.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    },
  ];
  if (itemList.length > 0) {
    jsonLd.push({
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: page.h1,
      numberOfItems: rows.length,
      itemListElement: itemList,
    });
  }

  return {
    title: page.title,
    description: page.description,
    url: `${INTENT_ORIGIN}${page.path}`,
    h1: page.h1,
    bodyHtml,
    jsonLd,
    faq,
  };
}
