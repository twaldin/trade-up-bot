// Discord OAuth account linking + internal bot lookup endpoint.

import { Router } from "express";
import type { Request, Response } from "express";
import pg from "pg";
import crypto from "crypto";
import { requireAuth, invalidateUserCache, type User } from "../auth.js";

export function discordRouter(pool: pg.Pool): Router {
  const router = Router();

  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  const baseUrl = process.env.BASE_URL || "http://localhost:3001";
  const internalToken = process.env.INTERNAL_API_TOKEN;

  // ---------------------------------------------------------------------------
  // Discord OAuth: initiate
  // ---------------------------------------------------------------------------

  router.get("/api/auth/discord", requireAuth, (req: Request, res: Response) => {
    if (!clientId || !clientSecret) {
      res.status(503).json({ error: "Discord OAuth not configured" });
      return;
    }

    // Generate state for CSRF protection
    const state = crypto.randomBytes(16).toString("hex");
    req.session.discordState = state;

    const redirectUri = `${baseUrl}/api/auth/discord/callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: "identify",
      state,
    });

    res.redirect(`https://discord.com/oauth2/authorize?${params}`);
  });

  // ---------------------------------------------------------------------------
  // Discord OAuth: callback
  // ---------------------------------------------------------------------------

  router.get("/api/auth/discord/callback", requireAuth, async (req: Request, res: Response) => {
    if (!clientId || !clientSecret) {
      res.redirect("/?discord=error");
      return;
    }

    const { code, state } = req.query as { code?: string; state?: string };
    const expectedState = req.session.discordState;
    delete req.session.discordState;

    if (!code || !state || state !== expectedState) {
      res.redirect("/?discord=error");
      return;
    }

    const redirectUri = `${baseUrl}/api/auth/discord/callback`;
    const user = req.user as User;

    try {
      // Exchange code for access token
      const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
        }),
      });

      if (!tokenRes.ok) {
        console.error("Discord token exchange failed:", tokenRes.status);
        res.redirect("/?discord=error");
        return;
      }

      const tokenData = await tokenRes.json() as { access_token: string };

      // Fetch Discord user info
      const userRes = await fetch("https://discord.com/api/users/@me", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });

      if (!userRes.ok) {
        console.error("Discord user fetch failed:", userRes.status);
        res.redirect("/?discord=error");
        return;
      }

      const discordUser = await userRes.json() as { id: string; username: string; discriminator?: string };
      const discordId = discordUser.id;
      const discordTag = discordUser.discriminator && discordUser.discriminator !== "0"
        ? `${discordUser.username}#${discordUser.discriminator}`
        : discordUser.username;

      // Check if another user already has this Discord ID
      const { rows: existing } = await pool.query(
        "SELECT steam_id FROM users WHERE discord_id = $1 AND steam_id != $2",
        [discordId, user.steam_id],
      );

      if (existing.length > 0) {
        res.redirect("/?discord=already_linked");
        return;
      }

      // Store Discord ID
      await pool.query(
        "UPDATE users SET discord_id = $1, discord_tag = $2 WHERE steam_id = $3",
        [discordId, discordTag, user.steam_id],
      );
      invalidateUserCache(user.steam_id);

      console.log(`Discord linked: ${user.display_name} (${user.steam_id}) -> ${discordTag} (${discordId})`);
      res.redirect("/?discord=linked");
    } catch (err: any) {
      console.error("Discord OAuth error:", err.message);
      res.redirect("/?discord=error");
    }
  });

  // ---------------------------------------------------------------------------
  // Unlink Discord
  // ---------------------------------------------------------------------------

  router.delete("/api/auth/discord", requireAuth, async (req: Request, res: Response) => {
    const user = req.user as User;
    await pool.query(
      "UPDATE users SET discord_id = NULL, discord_tag = NULL WHERE steam_id = $1",
      [user.steam_id],
    );
    invalidateUserCache(user.steam_id);
    console.log(`Discord unlinked: ${user.display_name} (${user.steam_id})`);
    res.json({ success: true });
  });

  // ---------------------------------------------------------------------------
  // Internal: bot lookup by Discord ID
  // ---------------------------------------------------------------------------

  router.get("/api/internal/discord-lookup", async (req: Request, res: Response) => {
    // Auth: require internal token
    if (!internalToken) {
      res.status(503).json({ error: "Internal API not configured" });
      return;
    }
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${internalToken}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const discordId = req.query.discord_id as string;
    if (!discordId) {
      res.status(400).json({ error: "discord_id required" });
      return;
    }

    const { rows } = await pool.query(
      "SELECT steam_id, display_name, tier, discord_tag FROM users WHERE discord_id = $1",
      [discordId],
    );

    if (rows.length === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    res.json(rows[0]);
  });

  return router;
}
