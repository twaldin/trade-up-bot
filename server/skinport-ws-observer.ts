/**
 * Skinport WebSocket observer — logs ALL events to see what actually comes through.
 * Run: npx tsx server/skinport-ws-observer.ts
 * Watch for: price_changed, canceled events (listed as "unsupported" in docs)
 */

import { io } from "socket.io-client";

async function main() {
  const mod = await import("socket.io-msgpack-parser");
  const msgpackParser = mod.default ?? mod;

  const socket = io("wss://skinport.com", {
    transports: ["websocket"],
    parser: msgpackParser,
    reconnection: true,
  });

  const eventCounts: Record<string, number> = {};
  const startedAt = Date.now();

  socket.on("connect", () => {
    console.log(`[${ts()}] Connected to Skinport WebSocket`);
    socket.emit("saleFeedJoin", { currency: "USD", locale: "en", appid: 730 });
  });

  socket.on("disconnect", (reason: string) => {
    console.log(`[${ts()}] Disconnected: ${reason}`);
  });

  // Listen to ALL possible events
  socket.onAny((eventName: string, ...args: any[]) => {
    if (eventName === "saleFeed") {
      const data = args[0];
      const eventType = data?.eventType ?? "unknown";
      eventCounts[eventType] = (eventCounts[eventType] ?? 0) + 1;

      // Log non-standard events in full
      if (eventType !== "listed" && eventType !== "sold") {
        console.log(`\n[${ts()}] *** NON-STANDARD EVENT: ${eventType} ***`);
        console.log(JSON.stringify(data, null, 2));
      }

      // Periodic summary
      const total = Object.values(eventCounts).reduce((a, b) => a + b, 0);
      if (total % 100 === 0) {
        const elapsed = ((Date.now() - startedAt) / 60000).toFixed(1);
        console.log(`[${ts()}] ${elapsed}min | Events: ${JSON.stringify(eventCounts)} | Total: ${total}`);
      }
    } else {
      // Log any non-saleFeed events
      console.log(`[${ts()}] Event: "${eventName}" | Args: ${JSON.stringify(args).slice(0, 200)}`);
    }
  });

  // Keep alive
  process.on("SIGINT", () => {
    console.log(`\n[${ts()}] Final counts: ${JSON.stringify(eventCounts)}`);
    const elapsed = ((Date.now() - startedAt) / 60000).toFixed(1);
    console.log(`[${ts()}] Ran for ${elapsed} minutes`);
    process.exit(0);
  });
}

function ts() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
