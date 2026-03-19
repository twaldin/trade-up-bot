# TradeUpBot Discord Bot

Discord server setup, slash commands, and alert integration for [tradeupbot.app](https://tradeupbot.app).

## Setup

### 1. Create a Discord Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application**, name it "TradeUpBot"
3. Go to **Bot** tab, click **Reset Token**, copy the token
4. Under **Privileged Gateway Intents**, enable:
   - Server Members Intent
5. Go to **OAuth2** tab, copy the Client ID and Client Secret

### 2. Invite the Bot

Use this URL template (replace `YOUR_CLIENT_ID` with the Application ID):

```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=8&scope=bot%20applications.commands
```

### 3. Configure Environment

Add these to your root `.env` file:

```bash
DISCORD_BOT_TOKEN=your_token_here
DISCORD_CLIENT_ID=your_application_id_here
DISCORD_CLIENT_SECRET=your_oauth2_secret_here
DISCORD_GUILD_ID=your_server_id_here
INTERNAL_API_TOKEN=your_shared_secret_here  # openssl rand -hex 32
```

For alerts, create webhooks in each alert channel (Channel Settings > Integrations > Webhooks):

```bash
DISCORD_WEBHOOK_KNIFE=https://discord.com/api/webhooks/...
DISCORD_WEBHOOK_COVERT=https://discord.com/api/webhooks/...
DISCORD_WEBHOOK_CLASSIFIED=https://discord.com/api/webhooks/...
DISCORD_WEBHOOK_RESTRICTED=https://discord.com/api/webhooks/...
DISCORD_WEBHOOK_MILSPEC=https://discord.com/api/webhooks/...
```

### 4. Run

```bash
npx tsx discord-bot/index.ts
```

## What it does

### Server Setup (idempotent)

On startup, creates missing roles and channels:

**Categories & Channels:**
- TRADEUPBOT: #announcements (read-only), #welcome (read-only, welcome embed), #faq (read-only), #pricing (read-only)
- TRADE-UPS: #general, #strategies, #results
- ALERTS: #knife-alerts, #covert-alerts, #classified-alerts, #restricted-alerts, #milspec-alerts (all Pro-only)
- SUPPORT: #feedback, #help

**Roles:** @Owner, @Pro, @Basic, @Free, @Announcements, plus 5 alert ping roles

### Slash Commands

- `/link` — Link Discord to TradeUpBot account (requires web app OAuth first)
- `/status` — Bot uptime, daemon status, global stats
- `/top tier:[tier] sort:[profit|roi|chance] ...` — Browse top trade-ups with filters
- `/price skin:[name] float:[value] condition:[FN-BS]` — Price lookup with autocomplete
- `/alerts` — Toggle alert ping roles per tier (Pro only)

### Alert System

The daemon detects new all-time top trade-ups (by profit, ROI, or chance to profit) per type and posts to the corresponding alert channel via Discord webhooks. Alert state is cached in Redis for instant comparison — no DB queries at alert time.

Pro users use `/alerts` to choose which tiers to get pinged for.

### Role Sync

- `/link` assigns tier roles based on subscription
- Stripe webhooks auto-sync roles on subscribe/cancel/upgrade
- Uses Discord REST API from the Express server (no discord.js dependency)

### Account Linking Flow

1. User types `/link` in Discord
2. Bot says "Go to tradeupbot.app, click Link Discord in your profile"
3. User does Discord OAuth on the web app → stores discord_id in DB
4. User types `/link` again → bot assigns tier role

## Architecture

```
Discord Bot (discord-bot/index.ts)
  ├── Reads: localhost:3001 API (status, trade-ups, prices, discord-lookup)
  ├── Writes: Redis (role IDs on startup)
  └── Receives: slash command interactions

API Server (server/index.ts)
  ├── Serves: Discord OAuth, internal lookup, trade-ups with internal bypass
  ├── Writes: PostgreSQL (discord_id on OAuth), Discord REST (role sync on Stripe events)
  └── Reads: Redis (role IDs for sync)

Daemon (server/daemon/index.ts)
  ├── Reads: Redis (top state, role IDs for pings)
  ├── Writes: Redis (alert state), Discord webhooks (alert embeds)
  └── Never talks to bot process directly
```
