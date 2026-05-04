#!/usr/bin/env tsx

import { createServer } from "http";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, extname, dirname } from "path";
import { fileURLToPath } from "url";
import { dedupeHead } from "../server/seo.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = join(__dirname, "..", "dist");
const PORT = 45678;

const ROUTES = [
  "/",
  "/faq",
  "/calculator",
  "/blog",
  "/blog/how-cs2-trade-ups-work",
  "/blog/profitable-trade-ups-theory-vs-reality",
  "/blog/cs2-trade-up-float-values-guide",
  "/blog/how-to-use-tradeupbot",
  "/blog/cs2-trade-up-marketplace-fees",
  "/blog/best-cs2-collections-knife-trade-ups-2026",
  "/blog/cs2-trade-up-probability-expected-value",
  "/features",
  "/pricing",
  "/terms",
  "/privacy",
];

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".xml": "application/xml",
  ".txt": "text/plain",
};

function startServer(): Promise<ReturnType<typeof createServer>> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let url = (req.url ?? "/").split("?")[0];

      if (url.startsWith("/api/")) {
        if (url === "/api/global-stats") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ total_trade_ups: 0, profitable_trade_ups: 0, total_data_points: 0, total_cycles: 0, uptime_ms: 0 }));
        } else if (url === "/api/auth/me") {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end("{}");
        } else {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end("{}");
        }
        return;
      }

      let filePath = join(DIST_DIR, url);

      if (!extname(url)) {
        filePath = join(DIST_DIR, "index.html");
      }

      if (existsSync(filePath)) {
        const ext = extname(filePath);
        const contentType = MIME_TYPES[ext] || "application/octet-stream";
        const content = readFileSync(filePath);
        res.writeHead(200, { "Content-Type": contentType });
        res.end(content);
      } else {
        const content = readFileSync(join(DIST_DIR, "index.html"));
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(content);
      }
    });

    server.listen(PORT, () => {
      console.log(`Static server running on http://localhost:${PORT}`);
      resolve(server);
    });
  });
}

async function prerenderRoute(browser: import("puppeteer").Browser, route: string): Promise<void> {
  const page = await browser.newPage();

  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (url.startsWith(`http://localhost:${PORT}`)) {
      req.continue();
    } else {
      req.abort();
    }
  });

  try {
    await page.goto(`http://localhost:${PORT}${route}`, {
      waitUntil: "networkidle0",
      timeout: 15000,
    });

    await page.waitForSelector("main, h1, [data-prerender]", { timeout: 5000 }).catch(() => {});

    const rawHtml = await page.content();
    const html = dedupeHead(rawHtml);

    let outputPath: string;
    if (route === "/") {
      outputPath = join(DIST_DIR, "index.html");
    } else {
      outputPath = join(DIST_DIR, route, "index.html");
    }

    const dir = dirname(outputPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(outputPath, html, "utf-8");
    console.log(`  Prerendered: ${route} -> ${outputPath}`);
  } catch (err) {
    console.error(`  Failed to prerender ${route}:`, err instanceof Error ? err.message : err);
  } finally {
    await page.close();
  }
}

async function main(): Promise<void> {
  if (!existsSync(DIST_DIR)) {
    console.error("dist/ directory not found. Run `vite build` first.");
    process.exit(1);
  }

  console.log("Starting prerender...");

  const server = await startServer();

  let puppeteer: typeof import("puppeteer");
  try {
    puppeteer = await import("puppeteer");
  } catch {
    console.error("puppeteer not installed. Skipping prerender.");
    server.close();
    return;
  }

  const browser = await puppeteer.default.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    for (const route of ROUTES) {
      await prerenderRoute(browser, route);
    }
    console.log(`\nPrerendered ${ROUTES.length} routes.`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error("Prerender failed:", err);
  process.exit(1);
});
