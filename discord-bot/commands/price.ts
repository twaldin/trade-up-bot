import { type ChatInputCommandInteraction, type AutocompleteInteraction, EmbedBuilder } from "discord.js";
import { API_BASE, INTERNAL_API_TOKEN, EMBED_COLORS } from "../constants.js";
import { CONDITIONS } from "../../shared/types.js";

const CONDITION_BOUNDS: Record<string, [number, number]> = Object.fromEntries(
  CONDITIONS.map(c => [c.abbr, [c.min, c.max] as [number, number]])
);

const CONDITION_NAMES: Record<string, string> = Object.fromEntries(
  CONDITIONS.map(c => [c.abbr, c.name])
);

function floatToCondition(float: number): string {
  if (float < 0.07) return "FN";
  if (float < 0.15) return "MW";
  if (float < 0.38) return "FT";
  if (float < 0.45) return "WW";
  return "BS";
}

function formatDollars(cents: number): string {
  const abs = Math.abs(cents);
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(abs / 100).toFixed(2)}`;
}

// Cache filter options for autocomplete (refreshed every 10 min)
let _skinNames: string[] = [];
let _skinCacheAt = 0;

async function getSkinNames(): Promise<string[]> {
  if (_skinNames.length > 0 && Date.now() - _skinCacheAt < 600_000) return _skinNames;
  try {
    const headers: Record<string, string> = {};
    if (INTERNAL_API_TOKEN) headers["Authorization"] = `Bearer ${INTERNAL_API_TOKEN}`;
    const res = await fetch(`${API_BASE}/api/filter-options`, { headers });
    if (res.ok) {
      const data = await res.json() as { skins: { name: string }[] };
      _skinNames = data.skins.map(s => s.name);
      _skinCacheAt = Date.now();
    }
  } catch { /* keep stale cache */ }
  return _skinNames;
}

export async function handlePriceAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused().toLowerCase();
  const skins = await getSkinNames();
  const matches = skins
    .filter(s => s.toLowerCase().includes(focused))
    .slice(0, 25)
    .map(s => ({ name: s.length > 100 ? s.slice(0, 100) : s, value: s }));
  await interaction.respond(matches);
}

export async function handlePrice(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const skin = interaction.options.getString("skin", true);
  const float = interaction.options.getNumber("float");
  const conditionInput = interaction.options.getString("condition");

  if (float == null && !conditionInput) {
    await interaction.editReply({ content: "Provide at least one of `float` or `condition`." });
    return;
  }

  const condition = conditionInput || (float != null ? floatToCondition(float) : "FT");
  const conditionFull = CONDITION_NAMES[condition] || condition;

  try {
    const headers: Record<string, string> = {};
    if (INTERNAL_API_TOKEN) headers["Authorization"] = `Bearer ${INTERNAL_API_TOKEN}`;

    const params = new URLSearchParams({ skin_name: skin, condition });
    const res = await fetch(`${API_BASE}/api/price-details?${params}`, { headers });

    if (!res.ok) {
      await interaction.editReply({ content: `No price data found for **${skin}** (${conditionFull}).` });
      return;
    }

    const data = await res.json() as any;

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLORS.green)
      .setTitle(`${skin}`)
      .setDescription(`**${conditionFull}**${float != null ? ` (float: ${float.toFixed(6)})` : ""}`);

    // Price sources
    const lines: string[] = [];
    if (data.csfloat_ref_price) lines.push(`CSFloat Ref: ${formatDollars(data.csfloat_ref_price)}`);
    if (data.csfloat_sale_price) lines.push(`CSFloat Sales: ${formatDollars(data.csfloat_sale_price)}${data.csfloat_sale_count ? ` (${data.csfloat_sale_count} sales)` : ""}`);
    if (data.dmarket_floor) lines.push(`DMarket Floor: ${formatDollars(data.dmarket_floor)}${data.dmarket_count ? ` (${data.dmarket_count} listings)` : ""}`);
    if (data.skinport_floor) lines.push(`Skinport Floor: ${formatDollars(data.skinport_floor)}${data.skinport_volume ? ` (${data.skinport_volume} vol)` : ""}`);
    if (data.knn_price) lines.push(`KNN Estimate: ${formatDollars(data.knn_price)}`);

    if (lines.length > 0) {
      embed.addFields({ name: "Price Sources", value: lines.join("\n") });
    }

    if (data.estimated_price) {
      embed.addFields({ name: "Best Estimate", value: formatDollars(data.estimated_price), inline: true });
    }

    embed.setFooter({ text: "Prices in USD. tradeupbot.app/data" });
    embed.setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    await interaction.editReply({ content: "Failed to fetch price data. Is the API server running?" });
  }
}
