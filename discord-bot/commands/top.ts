import { type ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { API_BASE, INTERNAL_API_TOKEN, TRADE_UP_TYPE_MAP, TYPE_LABELS, EMBED_COLORS, TYPE_COLORS } from "../constants.js";
import { buildTradeUpEmbed } from "../embeds/trade-up.js";

export async function handleTop(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const tier = interaction.options.getString("tier", true);
  const sort = interaction.options.getString("sort") || "profit";
  const minProfit = interaction.options.getNumber("min_profit");
  const maxCost = interaction.options.getNumber("max_cost");
  const minChance = interaction.options.getNumber("min_chance");
  const minRoi = interaction.options.getNumber("min_roi");
  const count = interaction.options.getInteger("count") || 5;

  const dbType = TRADE_UP_TYPE_MAP[tier];
  if (!dbType) {
    await interaction.editReply({ content: `Unknown tier: ${tier}` });
    return;
  }

  // Build query params
  const params = new URLSearchParams();
  params.set("type", dbType);
  params.set("per_page", String(Math.min(count, 50)));
  params.set("page", "1");

  // Map sort param to API sort field
  const sortMap: Record<string, string> = { profit: "profit", roi: "roi", chance: "chance" };
  params.set("sort", sortMap[sort] || "profit");
  params.set("order", "desc");

  // Filters — convert dollars to cents for the API
  if (minProfit != null) params.set("min_profit", String(Math.round(minProfit * 100)));
  if (maxCost != null) params.set("max_cost", String(Math.round(maxCost * 100)));
  if (minChance != null) params.set("min_chance", String(minChance));
  if (minRoi != null) params.set("min_roi", String(minRoi));

  try {
    const headers: Record<string, string> = {};
    if (INTERNAL_API_TOKEN) headers["Authorization"] = `Bearer ${INTERNAL_API_TOKEN}`;

    const res = await fetch(`${API_BASE}/api/trade-ups?${params}`, { headers });
    if (!res.ok) {
      await interaction.editReply({ content: `API error: ${res.status}` });
      return;
    }

    const data = await res.json() as { trade_ups: any[]; total: number };

    if (!data.trade_ups || data.trade_ups.length === 0) {
      await interaction.editReply({ content: `No ${TYPE_LABELS[dbType] || tier} trade-ups found with those filters.` });
      return;
    }

    const tierLabel = TYPE_LABELS[dbType] || tier;
    const sortLabel = sort === "roi" ? "ROI" : sort === "chance" ? "Chance to Profit" : "Profit";

    const header = new EmbedBuilder()
      .setColor(TYPE_COLORS[dbType] ?? EMBED_COLORS.green)
      .setTitle(`Top ${data.trade_ups.length} ${tierLabel} Trade-Ups`)
      .setDescription(`Sorted by **${sortLabel}** (descending) | ${data.total.toLocaleString()} total matching`);

    // Discord allows max 10 embeds per message
    const embeds = [header, ...data.trade_ups.slice(0, 9).map((tu: any) => buildTradeUpEmbed(tu))];

    await interaction.editReply({ embeds });
  } catch (err) {
    await interaction.editReply({ content: "Failed to fetch trade-ups. Is the API server running?" });
  }
}
