/**
 * Prices re-read from the live site on 24 Sept 2026. Not from the morning capture.
 * Nightwish: GET /api/skin-data/AK-47%20%7C%20Nightwish, cheapest listing per wear.
 * Hero: GET /api/trade-ups/780199345. Outcome shares and worst/best stay off screen.
 */
export const LIVE = {
  date: "24 Sept 2026",
  nightwish: {
    label: "AK-47 | Nightwish, cheapest listing, 24 Sept 2026",
    fn: "$99.59",
    mw: "$64.10",
    marker: 0.07,
  },
  hero: {
    id: "780199345",
    url: "https://tradeupbot.app/trade-ups/780199345",
    cost: "$63.86",
    expectedValue: "$66.23",
    expectedPl: "+$2.37",
    belowCost: [
      { name: "AK-47 | Nightwish", price: "$55.86" },
      { name: "MP9 | Starlight Protector", price: "$57.23" },
    ],
  },
} as const;

export const EXAMPLE =
  "Example from tradeupbot.app, 24 Sept 2026. Listings and prices change.";

export const DELAY = "Free view delayed 3 h";
export const VALVE = "Not affiliated with or endorsed by Valve.";
export const HONESTY = "Estimates after fees. You can lose money.";
