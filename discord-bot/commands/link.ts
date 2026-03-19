import { type ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { API_BASE, INTERNAL_API_TOKEN, EMBED_COLORS } from "../constants.js";

export async function handleLink(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const discordId = interaction.user.id;

  try {
    const headers: Record<string, string> = {};
    if (INTERNAL_API_TOKEN) headers["Authorization"] = `Bearer ${INTERNAL_API_TOKEN}`;

    const res = await fetch(`${API_BASE}/api/internal/discord-lookup?discord_id=${discordId}`, { headers });

    if (res.status === 404 || !res.ok) {
      const embed = new EmbedBuilder()
        .setColor(EMBED_COLORS.blue)
        .setTitle("Link Your Account")
        .setDescription(
          "Your Discord isn't linked to a TradeUpBot account yet.\n\n" +
          "**To link:**\n" +
          "1. Go to [tradeupbot.app](https://tradeupbot.app)\n" +
          "2. Sign in with Steam\n" +
          "3. Click your profile menu → **Link Discord**\n" +
          "4. Authorize the connection\n" +
          "5. Come back here and run `/link` again",
        );
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const data = await res.json() as { steam_id: string; display_name: string; tier: string; discord_tag: string };

    // Assign the correct tier role
    const guild = interaction.guild;
    if (!guild) {
      await interaction.editReply({ content: "This command must be used in a server." });
      return;
    }

    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) {
      await interaction.editReply({ content: "Could not fetch your server membership." });
      return;
    }

    // Remove existing tier roles, add the correct one
    const tierRoleNames = ["Pro", "Basic", "Free"];
    const targetRoleName = data.tier === "pro" ? "Pro" : data.tier === "basic" ? "Basic" : "Free";

    for (const roleName of tierRoleNames) {
      const role = guild.roles.cache.find(r => r.name === roleName);
      if (!role) continue;
      if (roleName === targetRoleName) {
        if (!member.roles.cache.has(role.id)) await member.roles.add(role);
      } else {
        if (member.roles.cache.has(role.id)) await member.roles.remove(role);
      }
    }

    const tierColors: Record<string, number> = {
      pro: EMBED_COLORS.gold,
      basic: EMBED_COLORS.blue,
      free: EMBED_COLORS.green,
    };

    const embed = new EmbedBuilder()
      .setColor(tierColors[data.tier] ?? EMBED_COLORS.green)
      .setTitle("Account Linked!")
      .setDescription(
        `You are **${data.display_name}** on the **${data.tier.charAt(0).toUpperCase() + data.tier.slice(1)}** plan.\n\n` +
        `Your @${targetRoleName} role has been assigned.`,
      );

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    await interaction.editReply({ content: "Failed to check account link. Is the API server running?" });
  }
}
