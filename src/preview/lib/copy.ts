/** Production landing copy — headlines and FAQ stay as-is. */

export const PREVIEW_HEADLINE = "CS2 trade-ups built from real, buyable listings";

export const PREVIEW_CTA_PRIMARY = "Find Real Tradeups ->";
export const PREVIEW_CTA_DISCORD = "Join the Discord";
export const PREVIEW_CTA_CALCULATOR = "Try the calculator";
export const PREVIEW_CTA_NOTE = "Free to browse — no account needed.";
export const PREVIEW_DISCORD_HREF = "https://discord.gg/gQ8cPqBq2a";
export const PREVIEW_GITHUB_HREF = "https://github.com/twaldin/trade-up-bot";

export const PREVIEW_LEDE =
  "Most calculators price trade-ups with idealized floats and average prices. TradeUpBot builds each trade-up from listings currently for sale.";

export const PREVIEW_SUBLEDE =
  "Every input links to a specific listing on CSFloat, DMarket, Skinport, or Buff.market, with its exact float and price. The output float is computed from your inputs, not estimated.";

export const PREVIEW_VALUE_HEADLINE = "Priced from listings you can buy";

export const PREVIEW_VALUE = [
  ["Real listings", "Each input links to a live listing on CSFloat, DMarket, Skinport, or Buff.market."],
  ["Verify (Pro) before buying", "Verify re-checks every input against the marketplace: still listed, and at what price."],
  ["Claim to lock", "Pro users can claim a trade-up for 30 minutes, hiding its listings from other TradeUpBot users while they buy."],
] as const;

/** Pipeline copy. First HTML and any HowTo markup are generated from this list. */
export const PREVIEW_HOW: { n: string; title: string; body: string }[] = [
  {
    n: "01",
    title: "Scan",
    body: "Listings pulled from CSFloat, DMarket, Skinport, and Buff.market every cycle. Continuous DMarket coverage at 2 req/s.",
  },
  {
    n: "02",
    title: "Discover",
    body: "Algorithms test thousands of input combinations at 45+ float targets. Swap optimization improves results each cycle. Output pricing uses CSFloat sale history first.",
  },
  {
    n: "03",
    title: "Verify (Pro)",
    body: "Before spending money, hit Verify. It calls each marketplace's API to confirm every input listing still exists and at what price. Cost, expected value, and ROI update from the response.",
  },
  {
    n: "04",
    title: "Claim",
    body: "Pro users see results the moment they're found. Claim a trade-up to hide its listings from other TradeUpBot users for 30 minutes while you buy. The free board is delayed 3 hours.",
  },
];

export const PREVIEW_FAQ: { q: string; a: string }[] = [
  {
    q: "How does TradeUpBot find trade-ups?",
    a: "We continuously scan CSFloat, DMarket, Skinport, and Buff.market for real listings, then test thousands of input combinations across 45+ float targets. Every result is built only from listings currently for sale.",
  },
  {
    q: "How accurate are the prices?",
    a: "Prices come from real marketplace data: CSFloat sale history (primary), DMarket listing floors, and Skinport prices. All prices are estimates — actual prices may differ at time of purchase, especially after trade lock periods.",
  },
  {
    q: "Can I lose money on a trade-up?",
    a: "Yes. All prices are estimates based on current market data. Items purchased from marketplaces have trade lock periods during which prices can change. \"Profitable\" means profitable at current estimated prices, not guaranteed profit.",
  },
  {
    q: "What does Verify do?",
    a: "Verify checks whether every input listing still exists on its marketplace and at what price. The trade-up's cost, profit, and ROI update from the response.",
  },
  {
    q: "What does Claim do?",
    a: "Pro users can claim a trade-up to hide its listings from other TradeUpBot users for 30 minutes while they buy. Buyers on the marketplaces themselves can still purchase the inputs — a claim removes TradeUpBot competition, it doesn't reserve listings.",
  },
];

/** Landing plan teaser. Every limit here is one `/pricing` already sells. */
export const PREVIEW_PLAN_FREE = [
  "Every trade-up, with filters, search, and sorting",
  "Direct links to every input listing",
  "Board data delayed 3 hours",
] as const;

export const PREVIEW_PLAN_PRO = [
  "Real-time trade-ups, no delay",
  "Verify every input is still listed (20/hr)",
  "Claim a trade-up for a 30 min lock, up to 5 at once",
  "Claims (10/hr)",
] as const;

export const PREVIEW_PRO_PRICES = "Or $59.99/year ($5/mo) · $74.99 lifetime";

export const DELAY_BANNER = "Free view: trade-ups are delayed 3 hours. Pro sees them the moment they're found.";

/** Visible metric labels. Engine fields (chance_to_profit, profit_cents) stay unchanged. */
export const LABEL_OUTCOMES_ABOVE_COST = "Outcomes above cost";
/** Short tile label. The long form is clipped in the 3-column strip at 390px. */
export const LABEL_ABOVE_COST = "Above cost";
export const NOTE_OF_OUTCOMES = "of outcomes";
export const LABEL_ABOVE_COST_PCT = "Above cost %";
export const LABEL_MIN_ABOVE_COST = "Min above cost %";
export const LABEL_EXPECTED_VALUE = "Expected value";
export const LABEL_AFTER_FEES = "after fees";
export const LABEL_EXPECTED_PL = "Expected P/L";
export const LABEL_OUTCOME_PROBABILITY = "Outcome probability";
export const NOTE_WORST_OUTCOMES = "10th percentile";
export const NOTE_PL_ABOVE_ZERO = "P(P/L > $0)";

export const HOME_TITLE = "TradeUpBot — CS2 Trade-Ups Built from Real, Buyable Listings";
export const HOME_DESCRIPTION =
  "Fee-adjusted expected value for CS2 trade-ups, built from real listings on CSFloat, DMarket, Skinport, and Buff.market. Verify inputs before you buy.";
export const HOME_SOCIAL_DESCRIPTION =
  "CS2 trade-ups built from real, buyable listings, with expected value after fees. Verify availability and claim before anyone else.";

export const FOOTER_NOT_VALVE = "Not affiliated with or endorsed by Valve.";
export const FOOTER_AGE = "18+. You must be 18 or older to use TradeUpBot.";

/** Logged-out trade-up page. Verify is Pro (`POST /api/verify-trade-up/:id` returns 403 otherwise). */
export const SIGN_IN_TO_CLAIM = "Verify and Claim are Pro features. Signing in with Steam is free.";

export { REPRICE_CAVEAT } from "../../../shared/copy.js";

export const COLLECTION_TRADEUP_LEDE = "Trade-ups using skins from the ${display} collection, with expected value after fees.";
