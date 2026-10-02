// Chromium: the head strip runs before trackers and before a bundle delayed ~3s.
// Puppeteer is the browser harness this repo already uses.
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import puppeteer, { type Browser } from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUTH_RETURN_STRIP_SOURCE } from "../../shared/auth-return-strip.js";

const NONCE = "cd".repeat(16);

describe("delayed bundle does not leak the login nonce", () => {
  let browser: Browser;
  let server: Server;
  let port = 0;
  const hits: { url: string; referer: string }[] = [];

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    server = createServer((req, res) => {
      const url = req.url ?? "/";
      const referer = typeof req.headers.referer === "string" ? req.headers.referer : "";
      if (url.startsWith("/collect") || url.startsWith("/tr") || url.startsWith("/api/")) {
        hits.push({ url, referer });
      }
      if (url.startsWith("/app.js")) {
        setTimeout(() => {
          res.writeHead(200, { "Content-Type": "application/javascript", "Cache-Control": "no-store" });
          res.end("fetch('/api/auth/me',{credentials:'include'});fetch('/api/global-stats');");
        }, 3000);
        return;
      }
      if (url.startsWith("/pricing")) {
        const html = `<!doctype html><html><head>
          <script>${AUTH_RETURN_STRIP_SOURCE}</script>
          <script>
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-TEST', { page_location: window.__tubPageLocation || location.href });
            fetch('/collect?dl=' + encodeURIComponent(window.__tubPageLocation || location.href));
          </script>
          <script>fetch('/tr?dl=' + encodeURIComponent(location.href));</script>
        </head><body><script src="/app.js"></script></body></html>`;
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    port = addr.port;
  }, 30_000);

  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  it("strips lid before GA4, the Pixel, and the first /api fetch", async () => {
    const page = await browser.newPage();
    try {
      const target = `http://127.0.0.1:${port}/pricing?auth=return&lid=${NONCE}&eid=legacy&session_id=cs_test_123&upgraded=pro&utm_source=google#plans`;
      const apiSeen = page.waitForResponse((res) => res.url().includes("/api/auth/me"), { timeout: 15_000 });
      await page.goto(target, { waitUntil: "domcontentloaded", timeout: 15_000 });
      expect(await page.evaluate(() => location.search)).toBe("?utm_source=google");
      expect(await page.evaluate(() => location.hash)).toBe("#plans");
      await apiSeen;
      const tracked = hits.filter((hit) => hit.url.startsWith("/collect") || hit.url.startsWith("/tr") || hit.url.startsWith("/api/"));
      expect(tracked.some((hit) => hit.url.startsWith("/collect"))).toBe(true);
      expect(tracked.some((hit) => hit.url.startsWith("/tr"))).toBe(true);
      expect(tracked.filter((hit) => hit.url.startsWith("/api/")).length).toBeGreaterThan(0);
      for (const hit of tracked) {
        for (const leaked of ["lid=", "eid=", "auth=", "session_id=", "upgraded=", NONCE, "cs_test_123"]) {
          expect(hit.url).not.toContain(leaked);
          expect(hit.referer).not.toContain(leaked);
          expect(hit.url).not.toContain(encodeURIComponent(leaked));
          expect(hit.referer).not.toContain(encodeURIComponent(leaked));
        }
      }
      const api = tracked.filter((hit) => hit.url.startsWith("/api/"));
      expect(api.every((hit) => hit.referer.includes("/pricing"))).toBe(true);
    } finally {
      await page.close();
    }
  }, 25_000);
});
