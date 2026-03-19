import { type ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { API_BASE, INTERNAL_API_TOKEN, EMBED_COLORS } from "../constants.js";

const startedAt = Date.now();

export async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  try {
    const headers: Record<string, string> = {};
    if (INTERNAL_API_TOKEN) headers["Authorization"] = `Bearer ${INTERNAL_API_TOKEN}`;

    const [statusRes, statsRes] = await Promise.all([
      fetch(`${API_BASE}/api/status`, { headers }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${API_BASE}/api/global-stats`, { headers }).then(r => r.ok ? r.json() : null).catch(() => null),
    ]);

    const uptimeMs = Date.now() - startedAt;
    const hours = Math.floor(uptimeMs / 3_600_000);
    const minutes = Math.floor((uptimeMs % 3_600_000) / 60_000);
    const uptime = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLORS.green)
      .setTitle("TradeUpBot Status")
      .addFields(
        { name: "Bot Uptime", value: uptime, inline: true },
        { name: "Server Members", value: String(interaction.guild?.memberCount ?? "?"), inline: true },
      );

    if (statusRes) {
      const phase = statusRes.daemon_status?.phase || "unknown";
      const cycle = statusRes.daemon_status?.cycle || "?";
      embed.addFields(
        { name: "Daemon Phase", value: phase, inline: true },
        { name: "Cycle", value: String(cycle), inline: true },
      );
    }

    if (statsRes) {
      embed.addFields(
        { name: "Total Trade-Ups", value: Number(statsRes.total_trade_ups).toLocaleString(), inline: true },
        { name: "Profitable", value: Number(statsRes.profitable_trade_ups).toLocaleString(), inline: true },
        { name: "Listings", value: Number(statsRes.listings ?? statsRes.total_data_points ?? 0).toLocaleString(), inline: true },
      );
    }

    embed.setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    await interaction.editReply({ content: "Failed to fetch status. Is the API server running?" });
  }
}
