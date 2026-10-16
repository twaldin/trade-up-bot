import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import { findFreePort, viteOriginFromLog } from "../helpers/vite-dev-server.js";

describe("vite dev server port", () => {
  it("reads a vite local URL when ANSI color splits the host and port", () => {
    const raw = "\u001b[32m➜\u001b[31m  \u001b[1mLocal\u001b[22m:   \u001b[36mhttp://127.0.0.1:\u001b[1m5197\u001b[22m/\u001b[39m";
    expect(viteOriginFromLog(raw)).toBe("http://127.0.0.1:5197");
  });

  it("returns a TCP port that can be bound", async () => {
    const port = await findFreePort();
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThan(65536);
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => resolve());
    });
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });
});
