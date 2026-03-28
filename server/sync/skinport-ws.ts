/**
 * Skinport WebSocket listener — sale observations only.
 *
 * Connects to wss://skinport.com using Socket.IO + msgpack.
 * Listens for "saleFeed" events and records SOLD events as price observations
 * for KNN float-precise pricing. Does NOT store listings — Skinport has no
 * individual listing API so we can't verify/staleness-check them, and
 * unverifiable listings poison trade-up data with bad prices.
 *
 * No auth required. No rate limits. Runs continuously in background.
 */

import pg from "pg";
import { io, Socket } from "socket.io-client";
import { dopplerPhaseFromPaintIndex } from "./doppler-phases.js";

// socket.io-msgpack-parser is a CJS module, use dynamic import
let msgpackParser: any = null;

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
  totalSaleObservations: number;
  lastEventAt: string | null;
}

const stats: SkinportListenerStats = {
  connected: false,
  totalReceived: 0,
  totalSaleObservations: 0,
  lastEventAt: null,
};

export function getSkinportStats(): SkinportListenerStats {
  return { ...stats };
}

/**
 * Start the Skinport WebSocket listener.
 * Records sale observations only — no listing storage.
 * Runs indefinitely, auto-reconnects on disconnect.
 * Returns a cleanup function to stop the listener.
 */
export async function startSkinportListener(pool: pg.Pool): Promise<() => void> {
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

  socket.on("saleFeed", async (data: SkinportFeedData) => {
    if (!data?.sales) return;

    // Detect unsupported event types — docs list "price_changed" and "canceled" as unsupported.
    if (data.eventType !== "listed" && data.eventType !== "sold") {
      console.log(`[Skinport WS] NEW EVENT TYPE: "${data.eventType}" — investigate! Sample: ${JSON.stringify(data.sales[0]).slice(0, 300)}`);
    }

    // Only process sold events — record as price observations for KNN pricing
    if (data.eventType !== "sold") return;

    for (const item of data.sales) {
      stats.totalReceived++;
      stats.lastEventAt = new Date().toISOString();

      // Skip items without float
      if (item.wear == null || item.wear === 0) continue;
      if (item.salePrice <= 0) continue;

      // Parse skin name from marketHashName: "AK-47 | Redline (Field-Tested)" -> "AK-47 | Redline"
      const nameMatch = item.marketHashName?.match(/^(.+?)\s*\([\w\s-]+\)$/);
      const skinName = nameMatch ? nameMatch[1].trim() : item.marketHashName;
      if (!skinName) continue;

      // Re-key Doppler sales by phase using paint_index (item finish)
      let finalSkinName = skinName;
      if (item.pattern != null &&
          (skinName.includes("| Doppler") || skinName.includes("| Gamma Doppler"))) {
        const phase = dopplerPhaseFromPaintIndex(item.pattern, skinName);
        if (phase !== null) {
          finalSkinName = `${skinName} ${phase}`;
        }
      }

      try {
        await pool.query(`
          INSERT INTO price_observations (skin_name, float_value, price_cents, source, observed_at)
          VALUES ($1, $2, $3, 'skinport_sale', NOW())
          ON CONFLICT DO NOTHING
        `, [finalSkinName, item.wear, item.salePrice]);
        stats.totalSaleObservations++;
      } catch {
        // DB errors in WS handler are non-critical
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
