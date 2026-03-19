// Server setup: roles, channels, embeds. Idempotent — safe to re-run.

import {
  ChannelType,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type TextChannel,
  type CategoryChannel,
  type Role,
} from "discord.js";
import Redis from "ioredis";
import { CATEGORIES, ROLES } from "./constants.js";
import { buildWelcomeEmbed } from "./embeds/welcome.js";
import { buildFaqEmbeds } from "./embeds/faq.js";
import { buildPricingEmbed } from "./embeds/pricing.js";

let _redis: Redis | null = null;

function getRedis(): Redis | null {
  if (_redis) return _redis;
  try {
    _redis = new Redis({ host: "127.0.0.1", port: 6379, maxRetriesPerRequest: 1, lazyConnect: false });
    _redis.on("error", () => {}); // suppress unhandled
    return _redis;
  } catch {
    return null;
  }
}

export { getRedis };

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export async function ensureRoles(guild: Guild): Promise<Map<string, Role>> {
  const roleMap = new Map<string, Role>();

  for (const def of ROLES) {
    let role = guild.roles.cache.find((r) => r.name === def.name);
    if (!role) {
      role = await guild.roles.create({
        name: def.name,
        color: def.color,
        hoist: def.hoist,
        reason: "TradeUpBot auto-setup",
      });
      console.log(`  Created role: @${def.name}`);
    } else {
      console.log(`  Role exists: @${def.name}`);
    }
    roleMap.set(def.name, role);
  }

  // Write role IDs to Redis for daemon + API server to read
  const redis = getRedis();
  if (redis) {
    for (const [name, role] of roleMap) {
      await redis.set(`discord:role:${name}`, role.id).catch(() => {});
    }
    console.log("  Role IDs written to Redis");
  }

  return roleMap;
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export async function ensureChannels(guild: Guild, roleMap: Map<string, Role>) {
  const proRole = roleMap.get("Pro")!;

  for (const catDef of CATEGORIES) {
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

      const permissionOverwrites: Array<{
        id: string;
        allow?: bigint[];
        deny?: bigint[];
      }> = [];

      if (chDef.readOnly) {
        permissionOverwrites.push({
          id: guild.id,
          deny: [PermissionFlagsBits.SendMessages],
        });
      }

      if (chDef.proOnly) {
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
// Embeds: post to read-only info channels (idempotent)
// ---------------------------------------------------------------------------

async function postEmbedIfMissing(
  guild: Guild,
  channelName: string,
  embeds: ReturnType<typeof buildWelcomeEmbed>[],
) {
  const channel = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildText && c.name === channelName,
  ) as TextChannel | undefined;

  if (!channel) return;

  const messages = await channel.messages.fetch({ limit: 10 });
  if (messages.some((m) => m.author.id === guild.client.user!.id)) {
    console.log(`  Embed already posted in #${channelName}, skipping`);
    return;
  }

  // Send embeds — Discord allows max 10 per message
  await channel.send({ embeds: Array.isArray(embeds) ? embeds : [embeds] });
  console.log(`  Posted embed in #${channelName}`);
}

export async function ensureEmbeds(guild: Guild) {
  await postEmbedIfMissing(guild, "welcome", [buildWelcomeEmbed()]);
  await postEmbedIfMissing(guild, "faq", buildFaqEmbeds());
  await postEmbedIfMissing(guild, "pricing", [buildPricingEmbed()]);
}
