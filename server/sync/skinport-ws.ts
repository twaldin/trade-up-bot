/**
 * Skinport WebSocket listener — passive listing accumulation.
 *
 * Connects to wss://skinport.com using Socket.IO + msgpack.
 * Listens for "saleFeed" events (listed + sold).
 * Only stores Classified, Covert, and Extraordinary (knife/glove) rarity skins.
 *
 * This is data-only — Skinport listings are used for pricing/evaluation
 * but not directly purchasable through our tool. They expand the listing
 * pool available to the trade-up engine.
 *
 * No auth required. No rate limits. Runs continuously in background.
 */

import Database from "better-sqlite3";
import { io, Socket } from "socket.io-client";

// socket.io-msgpack-parser is a CJS module, use dynamic import
let msgpackParser: any = null;

const RELEVANT_RARITIES = new Set([
  "Classified", "Covert", "Extraordinary",
  // Skinport may use different casing
  "classified", "covert", "extraordinary",
]);

interface SkinportSaleItem {
  saleId: number;
  productId?: number;
  assetId?: string;
  itemId?: number;
  marketHashName: string;
  marketName?: string;
  wear: number | null;          // float value
  exterior?: string | null;     // "Factory New", "Minimal Wear", etc.
  salePrice: number;            // cents in requested currency
  suggestedPrice?: number;
  pattern?: number;             // paint seed
  finish?: number;              // paint index
  stattrak?: boolean;
  souvenir?: boolean;
  rarity?: string;
  rarityColor?: string;
  collection?: string;
  link?: string;                // inspect link
  url?: string;                 // slug for item page
  category?: string;
  subCategory?: string;
  eventType?: string;           // "listed" or "sold"
}

interface SkinportFeedData {
  eventType: string;           // "listed" or "sold"
  sales: SkinportSaleItem[];
}

export interface SkinportListenerStats {
  connected: boolean;
  totalReceived: number;
  totalStored: number;
  totalSold: number;
  totalSaleObservations: number;
  lastEventAt: string | null;
}

const stats: SkinportListenerStats = {
  connected: false,
  totalReceived: 0,
  totalStored: 0,
  totalSold: 0,
  totalSaleObservations: 0,
  lastEventAt: null,
};

export function getSkinportStats(): SkinportListenerStats {
  return { ...stats };
}

/**
 * Start the Skinport WebSocket listener.
 * Runs indefinitely, auto-reconnects on disconnect.
 * Returns a cleanup function to stop the listener.
 */
export async function startSkinportListener(db: Database.Database): Promise<() => void> {
  // Dynamically import msgpack parser
  if (!msgpackParser) {
    try {
      const mod = await import("socket.io-msgpack-parser");
      msgpackParser = mod.default ?? mod;
    } catch (err) {
      console.error("  Skinport WebSocket: failed to load msgpack parser, skipping");
      return () => {};
    }
  }

  // Prepare DB statements
  const lookupSkin = db.prepare(
    "SELECT id, rarity FROM skins WHERE name = ? AND stattrak = 0 LIMIT 1"
  );
  const lookupSkinST = db.prepare(
    "SELECT id, rarity FROM skins WHERE name = ? AND stattrak = 1 LIMIT 1"
  );
  const upsertListing = db.prepare(`
    INSERT OR REPLACE INTO listings (id, skin_id, price_cents, float_value, paint_seed, stattrak, created_at, source, listing_type, price_updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), 'skinport', 'buy_now', datetime('now'))
  `);
  const insertSaleObservation = db.prepare(`
    INSERT OR IGNORE INTO price_observations (skin_name, float_value, price_cents, source, observed_at)
    VALUES (?, ?, ?, 'skinport_sale', datetime('now'))
  `);

  const socket: Socket = io("wss://skinport.com", {
    transports: ["websocket"],
    parser: msgpackParser,
    reconnection: true,
    reconnectionDelay: 5000,
    reconnectionDelayMax: 30000,
  });

  socket.on("connect", () => {
    stats.connected = true;
    socket.emit("saleFeedJoin", { currency: "USD", locale: "en", appid: 730 });
  });

  socket.on("disconnect", () => {
    stats.connected = false;
  });

  socket.on("saleFeed", (data: SkinportFeedData) => {
    if (!data?.sales) return;

    for (const item of data.sales) {
      stats.totalReceived++;
      stats.lastEventAt = new Date().toISOString();

      // Skip items without float
      if (item.wear == null || item.wear === 0) continue;

      // Parse skin name from marketHashName: "AK-47 | Redline (Field-Tested)" → "AK-47 | Redline"
      const nameMatch = item.marketHashName?.match(/^(.+?)\s*\([\w\s-]+\)$/);
      const skinName = nameMatch ? nameMatch[1].trim() : item.marketHashName;
      if (!skinName) continue;

      // Look up skin in DB
      const stattrak = item.stattrak ?? false;
      const skinRow = (stattrak ? lookupSkinST : lookupSkin).get(skinName) as { id: string; rarity: string } | undefined;
      if (!skinRow) continue;

      // Filter by rarity — only store relevant skins
      if (!RELEVANT_RARITIES.has(skinRow.rarity)) continue;

      if (data.eventType === "listed") {
        upsertListing.run(
          `skinport:${item.saleId}`,
          skinRow.id,
          item.salePrice,
          item.wear,
          item.pattern ?? null,
          stattrak ? 1 : 0
        );
        stats.totalStored++;
      } else if (data.eventType === "sold") {
        stats.totalSold++;
        // Record sale as a price observation (free real-time sale data)
        if (item.salePrice > 0) {
          insertSaleObservation.run(skinName, item.wear, item.salePrice);
          stats.totalSaleObservations++;
        }
        // Remove sold listing from DB if we had it
        db.prepare("DELETE FROM listings WHERE id = ?").run(`skinport:${item.saleId}`);
      }
    }
  });

  socket.on("connect_error", (err: Error) => {
    // Silent — auto-reconnect handles this
  });

  return () => {
    socket.disconnect();
    stats.connected = false;
  };
}
