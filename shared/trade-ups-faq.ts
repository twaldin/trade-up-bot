/** Visible /trade-ups FAQ. Crawler JSON-LD uses these strings unchanged. */
export const TRADE_UPS_FAQ: { q: string; a: string }[] = [
  {
    q: "What is a CS2 trade-up contract?",
    a: "A CS2 trade-up contract exchanges 10 weapon skins of the same rarity for 1 skin of the next higher rarity. The output is randomly selected from collections matching your inputs, weighted proportionally by input count per collection.",
  },
  {
    q: "How does TradeUpBot find trade-ups?",
    a: "TradeUpBot scans real marketplace listings across CSFloat, DMarket, and Skinport. For each valid combination of 10 inputs, it calculates expected output value using the actual CS2 float formula and accounts for marketplace fees on both buy and sell sides.",
  },
  {
    q: "Are these listings live?",
    a: "Every trade-up is built from listings that existed on the marketplace at discovery time. Listings can sell before you act — use the Verify button to confirm availability before purchasing.",
  },
];
