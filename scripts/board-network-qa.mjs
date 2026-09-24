/**
 * Counts the /api requests a first-session visitor's browser makes.
 *
 *   QA_BASE=https://tradeupbot.app QA_PAGES=1 node scripts/board-network-qa.mjs
 *   QA_BASE=http://localhost:3001 QA_PAGES=6 node scripts/board-network-qa.mjs
 *
 * Use a production build (not the Vite dev server): StrictMode double-runs
 * effects in dev and doubles every count.
 */
import puppeteer from "puppeteer";

const BASE = process.env.QA_BASE ?? "http://localhost:3001";
const PAGES = Number(process.env.QA_PAGES ?? 4);
const SHOTS = process.env.QA_OUT;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function bucket(url) {
  const { pathname, searchParams } = new URL(url);
  if (pathname === "/api/trade-ups") {
    return searchParams.get("per_page") === "1" ? "trade-ups (hero count)" : "trade-ups (board page)";
  }
  if (/^\/api\/trade-up\/\d+\/outcomes$/.test(pathname)) return "trade-up/:id/outcomes";
  if (/^\/api\/trade-up\/\d+\/inputs$/.test(pathname)) return "trade-up/:id/inputs";
  return pathname;
}

async function visit(browser, path, onReady) {
  const page = await browser.newPage();
  const counts = new Map();
  let limited = 0;
  const started = Date.now();
  page.on("response", (res) => {
    const url = res.url();
    if (!url.includes("/api/")) return;
    const key = bucket(url);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (res.status() === 429) limited++;
  });
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle2", timeout: 90000 });
  const extra = onReady ? await onReady(page, started) : {};
  await sleep(1500);
  await page.close();
  return { counts, limited, ...extra };
}

function report(label, result) {
  const total = [...result.counts.values()].reduce((a, b) => a + b, 0);
  console.log(`\n${label}: ${total} /api requests, ${result.limited} × 429`);
  for (const [key, n] of [...result.counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${key}`);
  }
  for (const [key, value] of Object.entries(result)) {
    if (key !== "counts" && key !== "limited") console.log(`  ${key}: ${JSON.stringify(value)}`);
  }
}

const browser = await puppeteer.launch({
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1440, height: 1000 },
});

try {
  console.log(`Base ${BASE}, board pages ${PAGES}`);

  report("/trade-ups", await visit(browser, "/trade-ups", async (page, started) => {
    await page.waitForSelector(".preview-card .preview-skin--output", { timeout: 60000 });
    const firstCardsMs = Date.now() - started;
    for (let i = 1; i < PAGES; i++) {
      const before = await page.$$eval(".preview-card", (els) => els.length);
      await page.evaluate(() => document.querySelector(".preview-sentinel")?.scrollIntoView());
      await page.waitForFunction((n) => document.querySelectorAll(".preview-card").length > n, { timeout: 30000 }, before).catch(() => {});
      await sleep(400);
    }
    await sleep(1500);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/board-network-qa.png` });
    return page.evaluate((ms) => ({
      first_cards_ms: ms,
      cards: document.querySelectorAll(".preview-card").length,
      cards_with_outputs: [...document.querySelectorAll(".preview-card")].filter((c) => c.querySelector(".preview-skin--output")).length,
      cards_with_inputs: [...document.querySelectorAll(".preview-card")].filter((c) => c.querySelector(".preview-skin--input")).length,
      slow_down_banner: /slow down/i.test(document.body.innerText),
    }), firstCardsMs);
  }));

  report("/skins", await visit(browser, "/skins", async (page) => {
    await page.waitForSelector(".preview-skin", { timeout: 60000 }).catch(() => {});
    return {};
  }));

  report("/ (landing)", await visit(browser, "/", async (page) => {
    await page.waitForSelector(".preview-stats", { timeout: 60000 }).catch(() => {});
    return page.evaluate(() => ({ hero_stats: document.querySelector(".preview-stats")?.textContent?.replace(/\s+/g, " ").trim().slice(0, 160) ?? null }));
  }));
} finally {
  await browser.close();
}
