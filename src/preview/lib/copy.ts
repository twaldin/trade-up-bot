/** Production landing copy — headlines and FAQ stay as-is. */

export const PREVIEW_HEADLINE = "CS2 trade-ups built from real, buyable listings";

export const PREVIEW_LEDE =
  "Most calculators price trade-ups with idealized floats and average prices. TradeUpBot builds each trade-up from listings currently for sale.";

export const PREVIEW_SUBLEDE =
  "Every input links to a specific listing on CSFloat, DMarket, Skinport, or Buff.market, with its exact float and price. The output float is computed from your inputs, not estimated.";

export const PREVIEW_VALUE_HEADLINE = "What you see is what you pay";

export const PREVIEW_FAQ: { q: string; a: string }[] = [
  {
    q: "How does TradeUpBot find profitable trade-ups?",
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

export const DELAY_BANNER = "Free view: trade-ups are delayed 3 hours. Pro sees them the moment they're found.";
