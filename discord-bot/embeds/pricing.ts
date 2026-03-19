import { EmbedBuilder } from "discord.js";
import { EMBED_COLORS } from "../constants.js";

export function buildPricingEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.green)
    .setTitle("Plans & Pricing")
    .setDescription("Start free. Upgrade when you're ready to act on opportunities.")
    .addFields(
      {
        name: "Free — $0",
        value:
          "- 10 sample trade-ups per rarity tier\n" +
          "- Full outcome details and chart\n" +
          "- 3-hour data delay\n" +
          "- Collection browser + price analytics\n" +
          "- No listing links, filters, or claims",
      },
      {
        name: "Basic — $5/mo",
        value:
          "- Unlimited trade-ups\n" +
          "- 30-min delay on new discoveries\n" +
          "- Filters, search, pagination\n" +
          "- Direct listing links\n" +
          "- Verify availability (10/hr)",
      },
      {
        name: "Pro — $15/mo",
        value:
          "- Everything in Basic\n" +
          "- **Real-time data** (no delay)\n" +
          "- **Claim system** (lock listings 30 min)\n" +
          "- Up to 5 active claims\n" +
          "- Verify availability (20/hr)\n" +
          "- Discord alert channels",
      },
      {
        name: "Feature Comparison",
        value:
          "```\n" +
          "Feature              Free        Basic       Pro\n" +
          "─────────────────────────────────────────────────\n" +
          "Trade-ups            10/tier     Unlimited   Unlimited\n" +
          "Data freshness       3h delay    30m delay   Real-time\n" +
          "Filters & search     No          Yes         Yes\n" +
          "Listing links        No          Yes         Yes\n" +
          "Verify               No          10/hr       20/hr\n" +
          "Claims               No          No          10/hr\n" +
          "Active claims        No          No          Up to 5\n" +
          "Discord alerts       No          No          Yes\n" +
          "```",
      },
    )
    .setFooter({ text: "Cancel anytime. No cancellation fees. tradeupbot.app/pricing" });
}
