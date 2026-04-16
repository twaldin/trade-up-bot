// Lightweight Discord REST API helper for the API server.
// Used for role sync on Stripe tier changes. No discord.js dependency.

import { getRedis } from "./redis.js";

const DISCORD_API = "https://discord.com/api/v10";

function getConfig() {
  return {
    botToken: process.env.DISCORD_BOT_TOKEN || "",
    guildId: process.env.DISCORD_GUILD_ID || "",
  };
}

async function discordFetch(path: string, method: string = "PUT"): Promise<boolean> {
  const { botToken } = getConfig();
  if (!botToken) return false;

  try {
    const res = await fetch(`${DISCORD_API}${path}`, {
      method,
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
    });
    return res.ok || res.status === 204;
  } catch (err: any) {
    console.error(`Discord REST ${method} ${path} failed:`, err.message);
    return false;
  }
}

export async function addGuildMemberRole(userId: string, roleId: string): Promise<boolean> {
  const { guildId } = getConfig();
  if (!guildId) return false;
  return discordFetch(`/guilds/${guildId}/members/${userId}/roles/${roleId}`, "PUT");
}

export async function removeGuildMemberRole(userId: string, roleId: string): Promise<boolean> {
  const { guildId } = getConfig();
  if (!guildId) return false;
  return discordFetch(`/guilds/${guildId}/members/${userId}/roles/${roleId}`, "DELETE");
}

/** Read a role's snowflake ID from Redis (written by the bot on startup). */
async function getRoleId(roleName: string): Promise<string | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    return await redis.get(`discord:role:${roleName}`);
  } catch {
    return null;
  }
}

/**
 * Sync a user's Discord tier roles after a subscription change.
 * Removes all tier roles, then adds the correct one.
 * Fails silently — never blocks the caller.
 */
export async function syncDiscordRoles(discordId: string, newTier: string): Promise<void> {
  const [proRoleId, basicRoleId, freeRoleId] = await Promise.all([
    getRoleId("Pro"),
    getRoleId("Basic"),
    getRoleId("Free"),
  ]);

  // Remove all tier roles (keep basic role fetch for cleanup of grandfathered users)
  const allRoleIds = [proRoleId, basicRoleId, freeRoleId].filter(Boolean) as string[];
  await Promise.all(allRoleIds.map(id => removeGuildMemberRole(discordId, id)));

  // Add the correct one
  const targetRoleId = newTier === "pro" ? proRoleId : freeRoleId;
  if (targetRoleId) {
    await addGuildMemberRole(discordId, targetRoleId);
  }

  console.log(`Discord role sync: ${discordId} -> ${newTier}`);
}
