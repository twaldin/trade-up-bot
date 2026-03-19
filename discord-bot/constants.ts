// Channel, role, and type definitions for the Discord bot.

import type { ColorResolvable } from "discord.js";

// ---------------------------------------------------------------------------
// Channel / category definitions
// ---------------------------------------------------------------------------

export interface ChannelDef {
  name: string;
  topic?: string;
  readOnly?: boolean; // only admins + bot can send
  proOnly?: boolean; // locked to @Pro role
}

export interface CategoryDef {
  name: string;
  channels: ChannelDef[];
}

export const CATEGORIES: CategoryDef[] = [
  {
    name: "TRADEUPBOT",
    channels: [
      { name: "announcements", topic: "Official updates and patch notes", readOnly: true },
      { name: "welcome", topic: "Welcome — start here", readOnly: true },
      { name: "faq", topic: "Frequently asked questions", readOnly: true },
      { name: "pricing", topic: "Plans and pricing", readOnly: true },
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
      { name: "knife-alerts", topic: "New all-time top knife/glove trade-ups (Pro only)", proOnly: true },
      { name: "covert-alerts", topic: "New all-time top covert trade-ups (Pro only)", proOnly: true },
      { name: "classified-alerts", topic: "New all-time top classified trade-ups (Pro only)", proOnly: true },
      { name: "restricted-alerts", topic: "New all-time top restricted trade-ups (Pro only)", proOnly: true },
      { name: "milspec-alerts", topic: "New all-time top mil-spec trade-ups (Pro only)", proOnly: true },
      { name: "industrial-alerts", topic: "New all-time top industrial trade-ups (Pro only)", proOnly: true },
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

// ---------------------------------------------------------------------------
// Role definitions
// ---------------------------------------------------------------------------

export interface RoleDef {
  name: string;
  color: ColorResolvable;
  hoist: boolean;
}

export const ROLES: RoleDef[] = [
  { name: "Owner", color: "#E74C3C", hoist: true },
  { name: "Pro", color: "#F1C40F", hoist: true },
  { name: "Basic", color: "#3498DB", hoist: false },
  { name: "Free", color: "#95A5A6", hoist: false },
  { name: "Announcements", color: "#99AAB5", hoist: false },
  // Alert ping roles — users toggle these via /alerts
  { name: "knife-alerts", color: "#F39C12", hoist: false },
  { name: "covert-alerts", color: "#E74C3C", hoist: false },
  { name: "classified-alerts", color: "#E91E8B", hoist: false },
  { name: "restricted-alerts", color: "#9B59B6", hoist: false },
  { name: "milspec-alerts", color: "#3498DB", hoist: false },
  { name: "industrial-alerts", color: "#5DADE2", hoist: false },
];

// ---------------------------------------------------------------------------
// Trade-up type mappings
// ---------------------------------------------------------------------------

/** Maps user-facing tier name → DB trade-up type */
export const TRADE_UP_TYPE_MAP: Record<string, string> = {
  knife: "covert_knife",
  covert: "classified_covert",
  classified: "restricted_classified",
  restricted: "milspec_restricted",
  milspec: "industrial_milspec",
  industrial: "consumer_industrial",
};

/** Maps DB trade-up type → user-facing label */
export const TYPE_LABELS: Record<string, string> = {
  covert_knife: "Knife/Gloves",
  classified_covert: "Covert",
  restricted_classified: "Classified",
  milspec_restricted: "Restricted",
  industrial_milspec: "Mil-Spec",
  consumer_industrial: "Industrial",
};

/** Maps DB trade-up type → webhook env var key */
export const TYPE_WEBHOOK_KEY: Record<string, string> = {
  covert_knife: "DISCORD_WEBHOOK_KNIFE",
  classified_covert: "DISCORD_WEBHOOK_COVERT",
  restricted_classified: "DISCORD_WEBHOOK_CLASSIFIED",
  milspec_restricted: "DISCORD_WEBHOOK_RESTRICTED",
  industrial_milspec: "DISCORD_WEBHOOK_MILSPEC",
  consumer_industrial: "DISCORD_WEBHOOK_INDUSTRIAL",
};

/** Maps DB trade-up type → alert role name */
export const TYPE_ALERT_ROLE: Record<string, string> = {
  covert_knife: "knife-alerts",
  classified_covert: "covert-alerts",
  restricted_classified: "classified-alerts",
  milspec_restricted: "restricted-alerts",
  industrial_milspec: "milspec-alerts",
  consumer_industrial: "industrial-alerts",
};

// ---------------------------------------------------------------------------
// Embed colors
// ---------------------------------------------------------------------------

export const EMBED_COLORS = {
  green: 0x2ecc71,
  red: 0xe74c3c,
  gold: 0xf1c40f,
  blue: 0x3498db,
  purple: 0x9b59b6,
  pink: 0xe91e8b,
} as const;

/** Color per trade-up type */
export const TYPE_COLORS: Record<string, number> = {
  covert_knife: EMBED_COLORS.gold,
  classified_covert: EMBED_COLORS.red,
  restricted_classified: EMBED_COLORS.pink,
  milspec_restricted: EMBED_COLORS.purple,
  industrial_milspec: EMBED_COLORS.blue,
  consumer_industrial: 0x5dade2,
};

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export const API_BASE = process.env.API_BASE || "http://localhost:3001";
export const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN || "";
