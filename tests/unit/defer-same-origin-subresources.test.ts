import { createServer, type Server } from "node:http";
import { once } from "node:events";
import puppeteer, { type Browser } from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUTH_RETURN_STRIP_SOURCE } from "../../shared/auth-return-strip.js";
import { deferSameOriginSubresources } from "../../shared/defer-same-origin-subresources.js";

const NONCE = "cd".repeat(16);

function sampleHtml(): string {
  return `<!doctype html><html><head>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml">
    <link rel="preload" href="/assets/font.woff2" as="font" type="font/woff2" crossorigin>
    <script>
      ${AUTH_RETURN_STRIP_SOURCE}
    </script>
    <link rel="stylesheet" href="/assets/app.css">
    <script type="module" src="/assets/app.js"></script>
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-TEST"></script>
  </head><body>
    <img src="/preview/board.webp" alt="board">
    <img src="https://avatars.steamstatic.com/x.jpg" alt="">
  </body></html>`;
}

describe("defer same-origin subresources until after the strip", () => {
  it("document.writes styles and scripts after replaceState and marks images strict-origin", () => {
    const once = deferSameOriginSubresources(sampleHtml());
    expect(once).toContain(AUTH_RETURN_STRIP_SOURCE);
    expect(once.indexOf(AUTH_RETURN_STRIP_SOURCE)).toBeLessThan(once.indexOf("/* tub-defer-boot */"));
    expect(once).not.toMatch(/<link rel="stylesheet"/);
    expect(once).not.toMatch(/<script type="module"/);
    expect(once).toContain("\\u003clink");
    expect(once).toContain("/assets/app.css");
    expect(once).toContain("/assets/app.js");
    expect(once).toContain("https://www.googletagmanager.com/gtag/js");
    expect(once).toContain('<img src="/preview/board.webp" alt="board" referrerpolicy="strict-origin" >');
    expect(once).toContain('<img src="https://avatars.steamstatic.com/x.jpg" alt="">');
    expect(once).not.toContain('steamstatic.com/x.jpg" alt="" referrerpolicy');
    expect(deferSameOriginSubresources(once)).toBe(once);
  });
});

describe("deferred assets do not send auth or lid", () => {
  let browser: Browser;
  let server: Server;
  let port = 0;
  const hits: { path: string; referer: string }[] = [];

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    server = createServer((req, res) => {
      const path = (req.url ?? "/").split("?")[0] ?? "/";
      if (path !== "/") {
        hits.push({ path, referer: typeof req.headers.referer === "string" ? req.headers.referer : "" });
        const type = path.endsWith(".css") ? "text/css" : path.endsWith(".js") ? "application/javascript" : path.endsWith(".woff2") ? "font/woff2" : "image/gif";
        res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
        res.end(path.endsWith(".js") ? "window.__booted=1" : "");
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/html",
        "Referrer-Policy": "strict-origin-when-cross-origin",
      });
      res.end(deferSameOriginSubresources(sampleHtml()));
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

  it("strips auth and lid before the stylesheet, bundle, font, and screenshot", async () => {
    const page = await browser.newPage();
    try {
      const target = `http://127.0.0.1:${port}/?auth=return&lid=${NONCE}&eid=legacy&session_id=cs_test_123&upgraded=pro&utm_source=google`;
      await page.goto(target, { waitUntil: "networkidle0", timeout: 15_000 });
      const interesting = hits.filter((hit) => hit.path !== "/favicon.ico");
      // Chrome sometimes retries a body-less image. Every hit still has to be clean.
      expect([...new Set(interesting.map((hit) => hit.path))].sort()).toEqual([
        "/assets/app.css",
        "/assets/app.js",
        "/assets/font.woff2",
        "/favicon.svg",
        "/preview/board.webp",
      ]);
      for (const hit of interesting) {
        for (const leaked of ["lid=", "eid=", "auth=", "session_id=", "upgraded=", NONCE, "cs_test_123"]) {
          expect(hit.referer, hit.path).not.toContain(leaked);
        }
      }
      const css = interesting.find((hit) => hit.path === "/assets/app.css");
      expect(css?.referer).toContain("utm_source=google");
      expect(await page.evaluate(() => location.search)).toBe("?utm_source=google");
      expect(await page.evaluate(() => Reflect.get(window, "__booted"))).toBe(1);
    } finally {
      await page.close();
    }
  }, 20_000);
});
