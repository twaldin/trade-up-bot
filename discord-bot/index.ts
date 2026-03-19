import {
  Client,
  GatewayIntentBits,
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  type Guild,
  type TextChannel,
  type CategoryChannel,
  type Role,
  type ColorResolvable,
} from "discord.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

if (!TOKEN) {
  console.error("Missing DISCORD_BOT_TOKEN env var");
  process.exit(1);
}
if (!GUILD_ID) {
  console.error("Missing DISCORD_GUILD_ID env var");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Channel / role definitions
// ---------------------------------------------------------------------------

interface ChannelDef {
  name: string;
  topic?: string;
  readOnly?: boolean; // only admins + bot can send
  proOnly?: boolean; // locked to @Pro role
}

interface CategoryDef {
  name: string;
  channels: ChannelDef[];
}

const CATEGORIES: CategoryDef[] = [
  {
    name: "TRADEUPBOT",
    channels: [
      { name: "announcements", topic: "Official updates and patch notes", readOnly: true },
      { name: "welcome", topic: "Welcome — start here", readOnly: true },
    ],
  },
  {
    name: "TRADE-UPS",
    channels: [
      { name: "general", topic: "General trade-up discussion" },
      { name: "strategies", topic: "Trade-up strategies, tips, and techniques" },
      { name: "results", topic: "Share your trade-up results" },
    ],
  },
  {
    name: "ALERTS",
    channels: [
      // TODO: Hook up daemon webhook to post high-profit knife trade-ups
      { name: "knife-alerts", topic: "High-profit knife trade-up alerts (Pro only)", proOnly: true },
      // TODO: Daily summary job
      { name: "top-daily", topic: "Daily best trade-ups summary (Pro only)", proOnly: true },
    ],
  },
  {
    name: "SUPPORT",
    channels: [
      { name: "feedback", topic: "Feature requests and bug reports" },
      { name: "help", topic: "How to use TradeUpBot" },
    ],
  },
];

interface RoleDef {
  name: string;
  color: ColorResolvable;
  hoist: boolean;
}

const ROLES: RoleDef[] = [
  { name: "Owner", color: "#E74C3C", hoist: true },
  { name: "Pro", color: "#F1C40F", hoist: true },
  { name: "Basic", color: "#3498DB", hoist: false },
  { name: "Announcements", color: "#99AAB5", hoist: false },
];

// ---------------------------------------------------------------------------
// Setup: roles
// ---------------------------------------------------------------------------

async function ensureRoles(guild: Guild): Promise<Map<string, Role>> {
  const roleMap = new Map<string, Role>();

  for (const def of ROLES) {
    let role = guild.roles.cache.find((r) => r.name === def.name);
    if (!role) {
      role = await guild.roles.create({
        name: def.name,
        colors: { primaryColor: def.color },
        hoist: def.hoist,
        reason: "TradeUpBot auto-setup",
      });
      console.log(`  Created role: @${def.name}`);
    } else {
      console.log(`  Role exists: @${def.name}`);
    }
    roleMap.set(def.name, role);
  }

  return roleMap;
}

// ---------------------------------------------------------------------------
// Setup: categories + channels
// ---------------------------------------------------------------------------

async function ensureChannels(guild: Guild, roleMap: Map<string, Role>) {
  const proRole = roleMap.get("Pro")!;

  for (const catDef of CATEGORIES) {
    // Find or create category
    let category = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildCategory && c.name === catDef.name,
    ) as CategoryChannel | undefined;

    if (!category) {
      category = await guild.channels.create({
        name: catDef.name,
        type: ChannelType.GuildCategory,
        reason: "TradeUpBot auto-setup",
      });
      console.log(`  Created category: ${catDef.name}`);
    } else {
      console.log(`  Category exists: ${catDef.name}`);
    }

    // Create channels under category
    for (const chDef of catDef.channels) {
      const existing = guild.channels.cache.find(
        (c) =>
          c.type === ChannelType.GuildText &&
          c.name === chDef.name &&
          c.parentId === category!.id,
      );

      if (existing) {
        console.log(`    Channel exists: #${chDef.name}`);
        continue;
      }

      // Build permission overwrites
      const permissionOverwrites: Array<{
        id: string;
        allow?: bigint[];
        deny?: bigint[];
      }> = [];

      if (chDef.readOnly) {
        // Everyone can read, only admins can send
        permissionOverwrites.push({
          id: guild.id, // @everyone
          deny: [PermissionFlagsBits.SendMessages],
        });
      }

      if (chDef.proOnly) {
        // @everyone can't see, @Pro can
        permissionOverwrites.push({
          id: guild.id,
          deny: [PermissionFlagsBits.ViewChannel],
        });
        permissionOverwrites.push({
          id: proRole.id,
          allow: [PermissionFlagsBits.ViewChannel],
        });
      }

      await guild.channels.create({
        name: chDef.name,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: chDef.topic,
        permissionOverwrites,
        reason: "TradeUpBot auto-setup",
      });
      console.log(`    Created channel: #${chDef.name}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Welcome embed
// ---------------------------------------------------------------------------

async function sendWelcomeEmbed(guild: Guild) {
  const welcomeChannel = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildText && c.name === "welcome",
  ) as TextChannel | undefined;

  if (!welcomeChannel) return;

  // Don't re-send if there's already a message from the bot
  const messages = await welcomeChannel.messages.fetch({ limit: 10 });
  if (messages.some((m) => m.author.id === guild.client.user!.id)) {
    console.log("  Welcome embed already posted, skipping");
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
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
          "**#feedback** — feature requests and bugs\n" +
          "**#help** — questions about the tool",
      },
    )
    .setFooter({ text: "Not affiliated with Valve. CS2 is a trademark of Valve Corporation." });

  await welcomeChannel.send({ embeds: [embed] });
  console.log("  Posted welcome embed");
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const startedAt = Date.now();

function handleCommand(message: { content: string; reply: (text: string) => Promise<unknown>; guild: Guild | null }) {
  const content = message.content.trim();

  // !status — bot uptime + member count
  if (content === "!status") {
    const uptimeMs = Date.now() - startedAt;
    const hours = Math.floor(uptimeMs / 3_600_000);
    const minutes = Math.floor((uptimeMs % 3_600_000) / 60_000);
    const uptime = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    const members = message.guild?.memberCount ?? "?";

    message.reply(`Bot uptime: ${uptime} | Server members: ${members}`);
    return;
  }

  // !link <steam_id> — placeholder for future Steam account linking
  if (content.startsWith("!link ")) {
    const steamId = content.slice(6).trim();
    if (!steamId) {
      message.reply("Usage: `!link <steam_id>`");
      return;
    }
    // TODO: Implement Steam account linking
    // - Verify steam_id exists
    // - Check subscription tier via API
    // - Store Discord user ID <-> Steam ID mapping
    // - Assign tier role (@Basic / @Pro) if subscribed
    message.reply(
      `Account linking isn't live yet. When it is, this will link your Discord to Steam ID \`${steamId}\` and auto-assign your tier role.`,
    );
    return;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

client.once("clientReady", async () => {
  console.log(`Logged in as ${client.user!.tag}`);

  // Set presence
  // TODO: Replace placeholder count with real count from API (/api/global-stats)
  client.user!.setPresence({
    activities: [{ name: "profitable trade-ups", type: 3 }], // type 3 = Watching
    status: "online",
  });

  // Auto-setup server
  const guild = client.guilds.cache.get(GUILD_ID!);
  if (!guild) {
    console.error(`Guild ${GUILD_ID} not found. Is the bot invited?`);
    return;
  }

  console.log(`Setting up server: ${guild.name}`);

  const roleMap = await ensureRoles(guild);
  await ensureChannels(guild, roleMap);
  await sendWelcomeEmbed(guild);

  console.log("Server setup complete");
});

client.on("messageCreate", (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith("!")) return;
  handleCommand(message);
});

client.login(TOKEN);
