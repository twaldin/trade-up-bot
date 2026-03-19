# TradeUpBot Discord Bot

Discord server setup + community bot for [tradeupbot.app](https://tradeupbot.app).

## Setup

### 1. Create a Discord Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application**, name it "TradeUpBot"
3. Go to **Bot** tab, click **Reset Token**, copy the token
4. Under **Privileged Gateway Intents**, enable:
   - Server Members Intent
   - Message Content Intent

### 2. Invite the Bot

Use this URL template (replace `YOUR_CLIENT_ID` with the Application ID from the General Information tab):

```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=8&scope=bot
```

This requests Administrator permissions for channel/role management. You can narrow permissions later.

### 3. Configure Environment

Copy `.env.example` values into your root `.env` file (or export them):

```bash
DISCORD_BOT_TOKEN=your_token_here
DISCORD_GUILD_ID=your_server_id_here
```

To get your Guild ID: enable Developer Mode in Discord (Settings > Advanced), then right-click your server name and click "Copy Server ID".

### 4. Run

```bash
npx tsx discord-bot/index.ts
```

## What it does

On startup, the bot auto-creates the server structure if it doesn't exist:

**Categories & Channels:**
- TRADEUPBOT: #announcements (read-only), #welcome (read-only, auto-posts welcome embed)
- TRADE-UPS: #general, #strategies, #results
- ALERTS: #knife-alerts (Pro only), #top-daily (Pro only)
- SUPPORT: #feedback, #help

**Roles:** @Pro (purple, hoisted), @Basic (blue), @Free (gray), @Linked (green)

**Commands:**
- `!status` — bot uptime and server member count
- `!link <steam_id>` — placeholder for future Steam account linking

The setup is idempotent — running the bot again won't duplicate channels or roles.

## Future

- Daemon webhook posts to #knife-alerts for high-profit knife trade-ups
- Daily summary in #top-daily
- Steam account linking with auto tier-role assignment
- Live presence showing real profitable trade-up count from API
