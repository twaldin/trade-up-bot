import { EmbedBuilder } from "discord.js";
import { EMBED_COLORS } from "../constants.js";

/** Build FAQ embeds (split into 2 to stay under Discord's 6000-char limit per embed). */
export function buildFaqEmbeds(): EmbedBuilder[] {
  const embed1 = new EmbedBuilder()
    .setColor(EMBED_COLORS.blue)
    .setTitle("Frequently Asked Questions")
    .addFields(
      {
        name: "What is a CS2 trade-up contract?",
        value:
          "An in-game mechanic where you exchange 10 weapon skins of the same rarity for 1 skin of the next higher rarity. " +
          "The output comes from the same collection(s) as your inputs. Float value is determined by a formula based on all 10 inputs.\n" +
          "For Knife/Glove trade-ups: 5 Covert skins → 1 Knife or Glove.",
      },
      {
        name: "How does TradeUpBot find profitable trade-ups?",
        value:
          "Unlike tools that use theoretical calculations, TradeUpBot builds every trade-up from **real, buyable listings** " +
          "on CSFloat, DMarket, and Skinport. The engine continuously scans listings, tests thousands of input combinations " +
          "across 45+ float targets, and evaluates expected profit and probability for each outcome.",
      },
      {
        name: 'What does "chance to profit" mean?',
        value:
          "Each possible outcome has a probability based on the proportion of inputs from its collection. " +
          '"Chance to profit" is the summed probability of all outcomes where output value exceeds total input cost. ' +
          "Trade-ups with >25% chance to profit are kept even if overall EV is slightly negative.",
      },
      {
        name: "How accurate are the prices?",
        value:
          "Output prices come primarily from CSFloat sale history (most reliable). DMarket and Skinport fill gaps. " +
          "Input prices are actual listing prices including buyer fees. " +
          "Prices can change between viewing and purchasing — always verify before buying.",
      },
      {
        name: 'What does "Verify" do?',
        value:
          "Checks whether all input listings are still available on their marketplaces and at what price. " +
          "Gives you up-to-the-moment confirmation before committing. Flags sold or delisted listings.",
      },
    );

  const embed2 = new EmbedBuilder()
    .setColor(EMBED_COLORS.blue)
    .addFields(
      {
        name: 'What does "Claim" do?',
        value:
          "Claiming (Pro only) hides a trade-up's listings from other TradeUpBot users for 30 minutes. " +
          "Up to 5 active claims at once. Claims expire automatically after 30 minutes.",
      },
      {
        name: "How often is data updated?",
        value:
          "Continuously. The discovery engine runs ~20-minute cycles. " +
          "DMarket listings fetched at 2 req/s in a separate process. Skinport streams via live WebSocket.",
      },
      {
        name: "What marketplaces are supported?",
        value:
          "**CSFloat** — primary source for Covert skins and sale-based pricing\n" +
          "**DMarket** — broad coverage across all tiers at 2 req/s\n" +
          "**Skinport** — passive WebSocket feed, no rate limits\n" +
          "Each has different buyer fees factored into cost calculations.",
      },
      {
        name: "Can I lose money?",
        value:
          "**Yes.** Prices are estimates and can change. Trade-locked items may shift in value. " +
          "You may receive a lower-value outcome. Marketplace fees reduce returns. " +
          "TradeUpBot is an analysis tool, not financial advice.",
      },
      {
        name: "Rate limits",
        value:
          "**Verify** — Basic: 10/hr, Pro: 20/hr\n" +
          "**Claim** — Pro only: 10/hr, up to 5 active\n\n" +
          "[Full FAQ](https://tradeupbot.app/faq) | [How Trade-Ups Work](https://tradeupbot.app/blog/how-cs2-trade-ups-work)",
      },
    );

  return [embed1, embed2];
}
