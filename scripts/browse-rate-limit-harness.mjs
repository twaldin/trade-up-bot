/**
 * Browse-session harness for the per-IP API rate limit.
 *
 * Drives one headless browser through a fixed "trader browsing inventory"
 * session — scroll the board, scroll /skins, open skin pages and scroll their
 * listings panes, scroll collections, back to the board — and records every
 * /api request the page makes, every 429, and how long the throttle copy was on
 * screen. Prints a JSON summary; writes it to HARNESS_OUT when set.
 *
 *   HARNESS_BASE=http://127.0.0.1:5173 node scripts/browse-rate-limit-harness.mjs
 *
 * Point it at a local stack (see scripts/seed-browse-fixture.ts), not production.
 */
import { writeFileSync } from "node:fs";
import puppeteer from "puppeteer";

const BASE = process.env.HARNESS_BASE ?? "http://127.0.0.1:5173";
const SCALE = Number(process.env.HARNESS_SCALE ?? "1");
const OUT = process.env.HARNESS_OUT;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const THROTTLE_RE = /Slow down|Rate limited|Too many requests/i;

const browser = await puppeteer.launch({
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();

let phase = "boot";
const phases = new Map();
const stat = () => {
  if (!phases.has(phase)) phases.set(phase, { requests: 0, rate_limited: 0, throttle_samples: 0, samples: 0, by_path: {} });
  return phases.get(phase);
};
page.on("response", (res) => {
  const url = new URL(res.url());
  if (!url.pathname.startsWith("/api/")) return;
  const s = stat();
  s.requests += 1;
  const key = url.pathname.replace(/\/\d+(\/|$)/, "/:id$1").replace(/^\/api\/skin-data\/.+/, "/api/skin-data/:name")
    .replace(/^\/api\/skin-by-slug\/.+/, "/api/skin-by-slug/:slug");
  s.by_path[key] = (s.by_path[key] ?? 0) + 1;
  if (res.status() === 429) s.rate_limited += 1;
});

async function sampleThrottle() {
  const text = await page.evaluate(() => document.body.innerText).catch(() => "");
  const s = stat();
  s.samples += 1;
  if (THROTTLE_RE.test(text)) s.throttle_samples += 1;
}

async function scrollFor(ms, selector) {
  const end = Date.now() + ms * SCALE;
  while (Date.now() < end) {
    await page.evaluate((sel) => {
      const start = sel ? document.querySelector(sel) : document.querySelector(".preview-page, .preview-board-embed");
      let node = start;
      while (node && node !== document.body) {
        const style = getComputedStyle(node);
        if ((style.overflowY === "auto" || style.overflowY === "scroll") && node.scrollHeight > node.clientHeight) break;
        node = node.parentElement;
      }
      const target = node && node !== document.body ? node : document.scrollingElement;
      target.scrollBy(0, 1400);
    }, selector).catch(() => {});
    await sampleThrottle();
    await sleep(350);
  }
}

async function count(selector) {
  return page.evaluate((sel) => document.querySelectorAll(sel).length, selector).catch(() => 0);
}

async function spaNavigate(path) {
  await page.evaluate((to) => {
    window.history.pushState({}, "", to);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
  await sleep(1200);
}

const started = Date.now();
const loaded = {};

phase = "board";
await page.goto(`${BASE}/trade-ups`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".preview-card", { timeout: 60000 }).catch(() => {});
await scrollFor(60_000);
loaded.board_cards = await count(".preview-card");

phase = "skins";
await spaNavigate("/skins");
await page.waitForSelector(".preview-skin--card", { timeout: 30000 }).catch(() => {});
await scrollFor(40_000);
loaded.skin_cards = await count(".preview-skin--card");

phase = "skin_pages";
const hrefs = await page.evaluate(() => [...document.querySelectorAll("a.preview-skin--card")]
  .map((a) => a.getAttribute("href")).filter(Boolean).slice(0, 8));
let listingRows = 0;
for (const href of hrefs) {
  await spaNavigate(href);
  await page.waitForSelector(".preview-skin-pane--listings", { timeout: 20000 }).catch(() => {});
  await scrollFor(3_000, ".preview-skin-pane--listings table, .preview-skin-pane--listings");
  listingRows += await count(".preview-skin-pane--listings tbody tr");
}
loaded.skin_pages = hrefs.length;
loaded.listing_rows_seen = listingRows;

phase = "collections";
await spaNavigate("/collections");
await scrollFor(20_000);
loaded.collection_cards = await count(".preview-collection");

phase = "board_again";
await spaNavigate("/trade-ups");
await page.waitForSelector(".preview-card", { timeout: 30000 }).catch(() => {});
await scrollFor(30_000);
loaded.board_cards_again = await count(".preview-card");

await browser.close();

const summary = {
  base: BASE,
  duration_s: Math.round((Date.now() - started) / 1000),
  loaded,
  phases: Object.fromEntries([...phases.entries()].map(([name, s]) => [name, {
    requests: s.requests,
    rate_limited: s.rate_limited,
    throttle_visible_pct: s.samples ? Math.round((s.throttle_samples / s.samples) * 100) : 0,
    by_path: s.by_path,
  }])),
  totals: {
    requests: [...phases.values()].reduce((sum, s) => sum + s.requests, 0),
    rate_limited: [...phases.values()].reduce((sum, s) => sum + s.rate_limited, 0),
  },
};
const json = JSON.stringify(summary, null, 2);
if (OUT) writeFileSync(OUT, json);
console.log(json);
