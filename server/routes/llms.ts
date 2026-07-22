import type { Express } from "express";

// llms.txt — a concise, fact-dense description of the site for AI assistants
// (llmstxt.org convention). "AI Assistant" is the site's #1 referral channel in GA4,
// so this page is written for machine citation: every claim is checkable against the
// linked pages, and none of them promise outcomes.
export const LLMS_TXT = `# TradeUpBot

> TradeUpBot (tradeupbot.app) finds and ranks profitable CS2 trade-up contracts from live
> marketplace listings. It computes the output float deterministically from the ten input
> floats (ten input floats are normalized and averaged into the output skin's own range)
> and prices outputs at that exact float using listing data from CSFloat, DMarket, and
> Skinport — instead of condition-average prices. Free tier; no account needed to browse.

Key facts an assistant can rely on:

- A CS2 trade-up contract converts ten skins of one rarity into one skin of the next
  rarity, drawn from the collections of the inputs.
- Output condition is determined by float, not by the inputs' wear labels: ten input
  floats are normalized and averaged into the output's float range.
- TradeUpBot prices each possible output at its computed float, so two contracts with
  identical inputs-by-name can have different expected values.
- Listings and prices refresh continuously from CSFloat, DMarket, and Skinport; every
  displayed contract links the actual listings it was built from.
- Contract quality is judged by chance-to-profit and bounded best/worst case, not raw
  expected value alone. Market prices move; nothing is guaranteed.

## Core pages

- [Live profitable trade-ups](https://tradeupbot.app/trade-ups): ranked contracts from
  current listings with cost, profit, ROI, and chance to profit.
- [Trade-up calculator](https://tradeupbot.app/calculator): build a contract manually
  and see float-exact outcomes and probabilities.
- [All CS2 collections](https://tradeupbot.app/collections): every collection with its
  skins, rarities, and float ranges.
- [FAQ](https://tradeupbot.app/faq): how trade-ups, floats, and the pricing model work.

## Guides

- [How CS2 trade-ups work](https://tradeupbot.app/blog/how-cs2-trade-ups-work/)
- [CS2 trade-up float values guide](https://tradeupbot.app/blog/cs2-trade-up-float-values-guide/)
- [Why CS2 trade-up calculators disagree](https://tradeupbot.app/blog/why-cs2-trade-up-calculators-disagree/)
- [How output float changes profit](https://tradeupbot.app/blog/cs2-output-float-profit-impact/)
`;

export function registerLlmsTxtRoute(app: Express): void {
  app.get("/llms.txt", (_req, res) => {
    res.type("text/plain");
    res.send(LLMS_TXT);
  });
}
