import {
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  EmbedBuilder,
} from "discord.js";
import { EMBED_COLORS, TYPE_ALERT_ROLE } from "../constants.js";

const ALERT_OPTIONS = [
  { label: "Knife/Gloves", value: "knife-alerts", emoji: "🔪" },
  { label: "Covert", value: "covert-alerts", emoji: "🔴" },
  { label: "Classified", value: "classified-alerts", emoji: "🩷" },
  { label: "Restricted", value: "restricted-alerts", emoji: "🟣" },
  { label: "Mil-Spec", value: "milspec-alerts", emoji: "🔵" },
  { label: "Industrial", value: "industrial-alerts", emoji: "⚪" },
];

export async function handleAlerts(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: "This command must be used in a server.", ephemeral: true });
    return;
  }

  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) {
    await interaction.reply({ content: "Could not fetch your server membership.", ephemeral: true });
    return;
  }

  // Check Pro role
  const proRole = guild.roles.cache.find(r => r.name === "Pro");
  if (!proRole || !member.roles.cache.has(proRole.id)) {
    const embed = new EmbedBuilder()
      .setColor(EMBED_COLORS.gold)
      .setTitle("Pro Feature")
      .setDescription(
        "Alert preferences are available for **Pro** subscribers.\n\n" +
        "Link your account with `/link` after subscribing at [tradeupbot.app/pricing](https://tradeupbot.app/pricing).",
      );
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  // Get current alert roles
  const currentAlertRoles = ALERT_OPTIONS
    .filter(opt => {
      const role = guild.roles.cache.find(r => r.name === opt.value);
      return role && member.roles.cache.has(role.id);
    })
    .map(opt => opt.value);

  const select = new StringSelectMenuBuilder()
    .setCustomId("alert_select")
    .setPlaceholder("Select alert types")
    .setMinValues(0)
    .setMaxValues(ALERT_OPTIONS.length)
    .addOptions(
      ALERT_OPTIONS.map(opt => ({
        label: opt.label,
        value: opt.value,
        emoji: opt.emoji,
        description: `Get pinged for new #1 ${opt.label.toLowerCase()} trade-ups`,
        default: currentAlertRoles.includes(opt.value),
      })),
    );

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

  const currentDesc = currentAlertRoles.length > 0
    ? `Currently subscribed to: ${currentAlertRoles.map(r => `@${r}`).join(", ")}`
    : "You're not subscribed to any alerts yet.";

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.gold)
    .setTitle("Alert Preferences")
    .setDescription(
      `${currentDesc}\n\n` +
      "Select which alert types you want to be pinged for. " +
      "You'll be notified when a new all-time top trade-up is discovered for the selected tiers.",
    );

  await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
}

/** Handle the select menu interaction from /alerts. */
export async function handleAlertSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) return;

  const selected = new Set(interaction.values);

  // Add/remove alert roles
  const changes: string[] = [];
  for (const opt of ALERT_OPTIONS) {
    const role = guild.roles.cache.find(r => r.name === opt.value);
    if (!role) continue;

    const hasRole = member.roles.cache.has(role.id);
    const wants = selected.has(opt.value);

    if (wants && !hasRole) {
      await member.roles.add(role);
      changes.push(`+ @${opt.value}`);
    } else if (!wants && hasRole) {
      await member.roles.remove(role);
      changes.push(`- @${opt.value}`);
    }
  }

  const subscribed = ALERT_OPTIONS
    .filter(opt => selected.has(opt.value))
    .map(opt => `${opt.emoji} ${opt.label}`);

  const desc = subscribed.length > 0
    ? `You'll be pinged for:\n${subscribed.join("\n")}`
    : "You've unsubscribed from all alerts.";

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.green)
    .setTitle("Alerts Updated")
    .setDescription(desc);

  await interaction.update({ embeds: [embed], components: [] });
}
