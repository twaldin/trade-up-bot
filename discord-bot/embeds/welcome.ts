import { EmbedBuilder } from "discord.js";
import { EMBED_COLORS } from "../constants.js";

export function buildWelcomeEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.green)
    .setTitle("TradeUpBot")
    .setDescription(
      "CS2 trade-up contract analyzer. We find profitable trade-ups from real, buyable marketplace listings on CSFloat, DMarket, and Skinport.\n\n" +
      "Every trade-up links to actual listings with exact floats and prices — no theoretical calculations, no guesswork.",
    )
    .addFields(
      {
        name: "Get started",
        value: "[tradeupbot.app](https://tradeupbot.app) — sign in with Steam, browse trade-ups, verify availability, and claim to lock listings.",
      },
      {
        name: "Pricing",
        value: "**Free** — 10 sample trade-ups per tier\n**Basic ($5/mo)** — unlimited, 30-min delay, verify\n**Pro ($15/mo)** — real-time, claims, full analytics\n\n[Compare plans](https://tradeupbot.app/pricing)",
      },
      {
        name: "Channels",
        value:
          "**#general** — chat about trade-ups\n" +
          "**#strategies** — share tips and techniques\n" +
          "**#results** — post your trade-up outcomes\n" +
          "**#faq** — frequently asked questions\n" +
          "**#pricing** — plan comparison\n" +
          "**#feedback** — feature requests and bugs\n" +
          "**#help** — questions about the tool",
      },
      {
        name: "Slash Commands",
        value:
          "`/link` — connect your Discord to TradeUpBot\n" +
          "`/top` — browse top trade-ups\n" +
          "`/price` — look up skin prices\n" +
          "`/alerts` — toggle alert notifications (Pro)\n" +
          "`/status` — bot and daemon status",
      },
    )
    .setFooter({ text: "Not affiliated with Valve. CS2 is a trademark of Valve Corporation." });
}
