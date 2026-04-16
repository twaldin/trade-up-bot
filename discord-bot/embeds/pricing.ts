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
          "- Unlimited trade-ups\n" +
          "- Full filters, search, sorting\n" +
          "- Direct listing links\n" +
          "- Full outcome details and chart\n" +
          "- 3-hour data delay\n" +
          "- Collection browser + price analytics",
      },
      {
        name: "Pro — $6.99/mo",
        value:
          "- Everything in Free\n" +
          "- **Real-time data** (no delay)\n" +
          "- **Claim system** (lock listings 30 min)\n" +
          "- Up to 5 active claims\n" +
          "- Verify availability (20/hr)\n" +
          "- Claims (10/hr)",
      },
      {
        name: "Feature Comparison",
        value:
          "```\n" +
          "Feature              Free        Pro\n" +
          "────────────────────────────────────\n" +
          "Trade-ups            Unlimited   Unlimited\n" +
          "Data freshness       3h delay    Real-time\n" +
          "Filters & search     Yes         Yes\n" +
          "Listing links        Yes         Yes\n" +
          "Verify               No          20/hr\n" +
          "Claims               No          10/hr\n" +
          "Active claims        No          Up to 5\n" +
          "```",
      },
    )
    .setFooter({ text: "Cancel anytime. No cancellation fees. tradeupbot.app/pricing" });
}
