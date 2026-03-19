import { EmbedBuilder } from "discord.js";
import { TYPE_COLORS, TYPE_LABELS, EMBED_COLORS } from "../constants.js";

interface TradeUpData {
  id: number;
  type: string;
  profit_cents: number;
  roi_percentage: number;
  chance_to_profit: number;
  total_cost_cents: number;
  expected_value_cents: number;
  best_case_cents?: number;
  worst_case_cents?: number;
  input_summary?: { skins: { name: string; count: number }[]; collections: string[]; input_count: number };
}

function formatDollars(cents: number): string {
  const abs = Math.abs(cents);
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(abs / 100).toFixed(2)}`;
}

function formatPct(value: number): string {
  return `${value.toFixed(1)}%`;
}

/** Build an embed for a trade-up (used in alerts and /top command). */
export function buildTradeUpEmbed(tu: TradeUpData): EmbedBuilder {
  const color = TYPE_COLORS[tu.type] ?? EMBED_COLORS.green;
  const tierLabel = TYPE_LABELS[tu.type] ?? tu.type;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${tierLabel} Trade-Up`)
    .addFields(
      {
        name: "Profit",
        value: formatDollars(tu.profit_cents),
        inline: true,
      },
      {
        name: "ROI",
        value: formatPct(tu.roi_percentage),
        inline: true,
      },
      {
        name: "Chance to Profit",
        value: formatPct(tu.chance_to_profit * 100),
        inline: true,
      },
      {
        name: "Cost",
        value: formatDollars(tu.total_cost_cents),
        inline: true,
      },
      {
        name: "Expected Value",
        value: formatDollars(tu.expected_value_cents),
        inline: true,
      },
    );

  if (tu.best_case_cents != null && tu.worst_case_cents != null) {
    embed.addFields({
      name: "Range",
      value: `${formatDollars(tu.worst_case_cents)} — ${formatDollars(tu.best_case_cents)}`,
      inline: true,
    });
  }

  // Input summary
  if (tu.input_summary && tu.input_summary.skins.length > 0) {
    const skinLines = tu.input_summary.skins
      .slice(0, 5)
      .map(s => s.count > 1 ? `${s.count}x ${s.name}` : s.name);
    if (tu.input_summary.skins.length > 5) {
      skinLines.push(`+${tu.input_summary.skins.length - 5} more`);
    }
    embed.addFields({
      name: `Inputs (${tu.input_summary.input_count})`,
      value: skinLines.join("\n"),
    });
  }

  if (tu.input_summary && tu.input_summary.collections.length > 0) {
    embed.addFields({
      name: "Collections",
      value: tu.input_summary.collections.join(", "),
      inline: true,
    });
  }

  embed.setFooter({ text: `ID: ${tu.id}` });
  embed.setURL(`https://tradeupbot.app/dashboard?type=${tu.type}`);

  return embed;
}

/** Build an alert embed with record type context. */
export function buildAlertEmbed(
  tu: TradeUpData,
  recordType: "profit" | "roi" | "chance",
): EmbedBuilder {
  const tierLabel = TYPE_LABELS[tu.type] ?? tu.type;
  const metricLabels = { profit: "Profit", roi: "ROI", chance: "Chance to Profit" };

  const embed = buildTradeUpEmbed(tu);
  embed.setTitle(`New #1 ${metricLabels[recordType]} — ${tierLabel}`);
  embed.setTimestamp();

  return embed;
}
