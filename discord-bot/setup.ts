// Server setup: roles, channels, embeds. Idempotent — safe to re-run.
// Permissions are enforced on EVERY startup, not just on channel creation.

import {
  ChannelType,
  PermissionFlagsBits,
  type Guild,
  type TextChannel,
  type CategoryChannel,
  type Role,
  type OverwriteResolvable,
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
// Build permission overwrites for a channel
// ---------------------------------------------------------------------------

function buildPermissions(
  guild: Guild,
  roleMap: Map<string, Role>,
  chDef: { readOnly?: boolean; proOnly?: boolean },
): OverwriteResolvable[] {
  const overwrites: OverwriteResolvable[] = [];
  const proRole = roleMap.get("Pro");
  const ownerRole = roleMap.get("Owner");
  const botId = guild.client.user!.id;

  if (chDef.readOnly) {
    // @everyone can read but not send
    overwrites.push({
      id: guild.id,
      deny: [PermissionFlagsBits.SendMessages],
    });
    // Bot can send (for posting embeds)
    overwrites.push({
      id: botId,
      allow: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ViewChannel],
    });
  }

  if (chDef.proOnly) {
    // @everyone can't see
    overwrites.push({
      id: guild.id,
      deny: [PermissionFlagsBits.ViewChannel],
    });
    // @Pro can see
    if (proRole) {
      overwrites.push({
        id: proRole.id,
        allow: [PermissionFlagsBits.ViewChannel],
      });
    }
    // @Owner can see
    if (ownerRole) {
      overwrites.push({
        id: ownerRole.id,
        allow: [PermissionFlagsBits.ViewChannel],
      });
    }
    // Bot can see + send (for webhook fallback / embed posting)
    overwrites.push({
      id: botId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
    });
  }

  return overwrites;
}

// ---------------------------------------------------------------------------
// Channels — create if missing, enforce permissions always
// ---------------------------------------------------------------------------

export async function ensureChannels(guild: Guild, roleMap: Map<string, Role>) {
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
      ) as TextChannel | undefined;

      const overwrites = buildPermissions(guild, roleMap, chDef);

      if (existing) {
        // Enforce permissions on existing channels every startup
        if (chDef.readOnly || chDef.proOnly) {
          try {
            await existing.permissionOverwrites.set(overwrites);
            console.log(`    Channel exists: #${chDef.name} (permissions synced)`);
          } catch (err: any) {
            console.log(`    Channel exists: #${chDef.name} (perm sync failed: ${err.message})`);
          }
        } else {
          console.log(`    Channel exists: #${chDef.name}`);
        }
        continue;
      }

      await guild.channels.create({
        name: chDef.name,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: chDef.topic,
        permissionOverwrites: overwrites,
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
