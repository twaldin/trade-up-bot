#!/usr/bin/env tsx

import { createServer, type Server } from "http";
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "fs";
import { join, extname, dirname } from "path";
import { fileURLToPath } from "url";
import { blogPosts } from "../src/data/blog-posts.js";
import { dedupeHead } from "../server/seo.js";
import { fetchLiveHomepageStats, writeHomepageFirstHtmlFile } from "../server/homepage-first-html.js";
import { normalizePrerenderedHead } from "./seo-html.js";
import { deferSameOriginSubresources } from "../shared/defer-same-origin-subresources.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = join(__dirname, "..", "dist");

const ROUTES = [
  "/",
  "/faq",
  "/calculator",
  "/blog",
  ...blogPosts.map((post) => `/blog/${post.slug}/`),
  "/features",
  "/pricing",
  "/terms",
  "/privacy",
  "/listing-sniper",
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

function startServer(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      let url = (req.url ?? "/").split("?")[0];

      if (url.startsWith("/api/")) {
        if (url === "/api/auth/me") {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end("{}");
        } else {
          // Empty payloads — never bake hero zeros into first HTML.
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

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address == null || typeof address === "string") {
        reject(new Error("prerender static server did not bind a TCP port"));
        return;
      }
      console.log(`Static server running on http://127.0.0.1:${address.port}`);
      resolve({ server, port: address.port });
    });
  });
}

async function prerenderRoute(browser: import("puppeteer").Browser, route: string, port: number): Promise<void> {
  const page = await browser.newPage();
  // A route that renders nothing used to be written out silently as an empty
  // body; surface the reason instead.
  page.on("pageerror", (error) => {
    console.error(`  ${route} threw: ${error.message.split("\n")[0]}`);
  });

  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (url.startsWith(`http://127.0.0.1:${port}`)) {
      req.continue();
    } else {
      req.abort();
    }
  });

  try {
    await page.goto(`http://127.0.0.1:${port}${route}`, {
      waitUntil: "networkidle0",
      timeout: 15000,
    });

    // The console shell is code-split, so wait for the root to actually fill
    // before capturing — a 5s selector race wrote an empty body for "/".
    await page
      .waitForFunction(
        () => (document.getElementById("root")?.childElementCount ?? 0) > 0,
        { timeout: 20000 },
      )
      .catch(() => {});
    await page.waitForSelector("main, h1, [data-prerender]", { timeout: 10000 }).catch(() => {});

    const rawHtml = await page.content();
    const html = deferSameOriginSubresources(normalizePrerenderedHead(dedupeHead(rawHtml), route));

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

  // Preserve the pristine Vite-built shell before any prerender run overwrites index.html.
  // server/index.ts reads _shell.html for SPA routes; index.html becomes the prerendered landing.
  copyFileSync(join(DIST_DIR, "index.html"), join(DIST_DIR, "_shell.html"));

  console.log("Starting prerender...");

  const { server, port } = await startServer();

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
      await prerenderRoute(browser, route, port);
    }
    const stats = await fetchLiveHomepageStats();
    if (writeHomepageFirstHtmlFile(join(DIST_DIR, "index.html"), stats)) {
      console.log("Homepage first HTML materialized with live stats");
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
