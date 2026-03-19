// TradeUpBot Discord Bot — slash commands, alerts, role management.
// Run: npx tsx discord-bot/index.ts

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  InteractionType,
} from "discord.js";
import { ensureRoles, ensureChannels, ensureEmbeds } from "./setup.js";
import { handleStatus } from "./commands/status.js";
import { handleLink } from "./commands/link.js";
import { handleTop } from "./commands/top.js";
import { handlePrice, handlePriceAutocomplete } from "./commands/price.js";
import { handleAlerts, handleAlertSelect } from "./commands/alerts.js";

// ---------------------------------------------------------------------------
// Load .env from project root
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^(\w+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;

if (!TOKEN) { console.error("Missing DISCORD_BOT_TOKEN"); process.exit(1); }
if (!GUILD_ID) { console.error("Missing DISCORD_GUILD_ID"); process.exit(1); }
if (!CLIENT_ID) { console.error("Missing DISCORD_CLIENT_ID"); process.exit(1); }

// ---------------------------------------------------------------------------
// Slash command definitions
// ---------------------------------------------------------------------------

const commands = [
  new SlashCommandBuilder()
    .setName("link")
    .setDescription("Link your Discord to your TradeUpBot account"),

  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Bot and daemon status"),

  new SlashCommandBuilder()
    .setName("top")
    .setDescription("Top trade-ups by tier")
    .addStringOption(opt =>
      opt.setName("tier").setDescription("Rarity tier").setRequired(true)
        .addChoices(
          { name: "Knife/Gloves", value: "knife" },
          { name: "Covert", value: "covert" },
          { name: "Classified", value: "classified" },
          { name: "Restricted", value: "restricted" },
          { name: "Mil-Spec", value: "milspec" },
          { name: "Industrial", value: "industrial" },
        ),
    )
    .addStringOption(opt =>
      opt.setName("sort").setDescription("Sort by (default: profit)")
        .addChoices(
          { name: "Profit", value: "profit" },
          { name: "ROI", value: "roi" },
          { name: "Chance to Profit", value: "chance" },
        ),
    )
    .addNumberOption(opt =>
      opt.setName("min_profit").setDescription("Minimum profit in dollars (e.g. 5 = $5)"),
    )
    .addNumberOption(opt =>
      opt.setName("max_cost").setDescription("Maximum cost in dollars"),
    )
    .addNumberOption(opt =>
      opt.setName("min_chance").setDescription("Minimum chance to profit (0-100)"),
    )
    .addNumberOption(opt =>
      opt.setName("min_roi").setDescription("Minimum ROI percentage"),
    )
    .addIntegerOption(opt =>
      opt.setName("count").setDescription("Number of results (1-50, default 5)")
        .setMinValue(1).setMaxValue(50),
    ),

  new SlashCommandBuilder()
    .setName("price")
    .setDescription("Look up skin price")
    .addStringOption(opt =>
      opt.setName("skin").setDescription("Skin name").setRequired(true).setAutocomplete(true),
    )
    .addNumberOption(opt =>
      opt.setName("float").setDescription("Float value (0.0 - 1.0)"),
    )
    .addStringOption(opt =>
      opt.setName("condition").setDescription("Condition (if no float)")
        .addChoices(
          { name: "Factory New", value: "FN" },
          { name: "Minimal Wear", value: "MW" },
          { name: "Field-Tested", value: "FT" },
          { name: "Well-Worn", value: "WW" },
          { name: "Battle-Scarred", value: "BS" },
        ),
    ),

  new SlashCommandBuilder()
    .setName("alerts")
    .setDescription("Toggle alert notifications (Pro only)"),
];

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

client.once("clientReady", async () => {
  console.log(`Logged in as ${client.user!.tag}`);

  client.user!.setPresence({
    activities: [{ name: "profitable trade-ups", type: 3 }], // Watching
    status: "online",
  });

  // Setup server
  const guild = client.guilds.cache.get(GUILD_ID!);
  if (!guild) {
    console.error(`Guild ${GUILD_ID} not found. Is the bot invited?`);
    return;
  }

  console.log(`Setting up server: ${guild.name}`);
  const roleMap = await ensureRoles(guild);
  await ensureChannels(guild, roleMap);
  await ensureEmbeds(guild);
  console.log("Server setup complete");

  // Register slash commands (guild-scoped = instant)
  try {
    const rest = new REST().setToken(TOKEN!);
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID!, GUILD_ID!),
      { body: commands.map(c => c.toJSON()) },
    );
    console.log(`Registered ${commands.length} slash commands`);
  } catch (err: any) {
    console.error("Failed to register slash commands:", err.message);
  }
});

// ---------------------------------------------------------------------------
// Interaction handler
// ---------------------------------------------------------------------------

client.on("interactionCreate", async (interaction) => {
  try {
    // Slash commands
    if (interaction.isChatInputCommand()) {
      switch (interaction.commandName) {
        case "link": return await handleLink(interaction);
        case "status": return await handleStatus(interaction);
        case "top": return await handleTop(interaction);
        case "price": return await handlePrice(interaction);
        case "alerts": return await handleAlerts(interaction);
      }
    }

    // Autocomplete (for /price skin search)
    if (interaction.isAutocomplete()) {
      if (interaction.commandName === "price") {
        return await handlePriceAutocomplete(interaction);
      }
    }

    // Select menu (for /alerts toggle)
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === "alert_select") {
        return await handleAlertSelect(interaction);
      }
    }
  } catch (err: any) {
    console.error(`Interaction error (${interaction.type}):`, err.message);
    // Try to respond if we haven't already
    try {
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "Something went wrong.", ephemeral: true });
      }
    } catch { /* already responded */ }
  }
});

client.login(TOKEN);
