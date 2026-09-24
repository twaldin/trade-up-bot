/**
 * Regression probe for the buried narrow skin page: at 390px, Listings |
 * Trade-ups and the live listings must be on the first screen, the tabs must
 * stay pinned while the chart scrolls past, and the wide split must not move.
 */
import { mkdirSync } from "node:fs";
import puppeteer from "puppeteer";

const OUT = process.env.QA_OUT ?? "/tmp/qa-skin-mobile";
const BASE = process.env.QA_BASE ?? "http://127.0.0.1:5173";
const SLUG = process.env.QA_SKIN ?? "ak-47-nightwish";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const layout = () => {
  const box = (sel) => {
    const node = document.querySelector(sel);
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), visible: getComputedStyle(node).display !== "none" };
  };
  return {
    bar: box(".preview-console__bar"),
    tabs: box(".preview-skin-tabs"),
    listings: box(".preview-skin-pane--listings"),
    firstBuy: box(".preview-skin-pane--listings a.preview-link"),
    hero: box(".preview-hero-skin"),
    chart: box(".preview-skin-detail__chart"),
    board: box(".preview-skin-pane--board"),
    main: document.querySelector(".preview-console__main")?.scrollTop ?? 0,
  };
};

const browser = await puppeteer.launch({
  headless: "new", protocolTimeout: 240000,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const failures = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(`${BASE}/skins/${SLUG}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector(".preview-skin-pane--listings a.preview-link", { timeout: 60000 });
  await sleep(1500);
  await page.screenshot({ path: `${OUT}/narrow-first-screen.png` });
  const first = await page.evaluate(layout);
  console.log("narrow first screen:", JSON.stringify(first));
  if (!first.tabs || first.tabs.top > 844) failures.push(`tabs below the fold (y=${first.tabs?.top})`);
  if (!first.firstBuy || first.firstBuy.bottom > 844) failures.push(`no buyable listing row on the first screen (y=${first.firstBuy?.top})`);
  if (first.chart && first.listings && first.chart.top < first.listings.top) failures.push("chart still sits above listings");

  await page.evaluate(() => {
    const main = document.querySelector(".preview-console__main");
    const chart = document.querySelector(".preview-skin-detail__chart");
    if (main && chart) main.scrollTop += chart.getBoundingClientRect().top - main.getBoundingClientRect().top - 60;
  });
  await sleep(600);
  await page.screenshot({ path: `${OUT}/narrow-scrolled-to-chart.png` });
  const scrolled = await page.evaluate(layout);
  console.log("narrow scrolled to chart:", JSON.stringify(scrolled));
  if (!scrolled.chart || scrolled.chart.top > 844) failures.push("chart is not reachable by scroll");
  if (!scrolled.tabs || !scrolled.bar || Math.abs(scrolled.tabs.top - scrolled.bar.bottom) > 2) {
    failures.push(`tabs are not pinned under the console bar (tabs ${scrolled.tabs?.top}, bar ${scrolled.bar?.bottom})`);
  }

  await page.tap('.preview-skin-tabs [data-pane="listings"]');
  await sleep(600);
  const back = await page.evaluate(layout);
  console.log("narrow after Listings tap:", JSON.stringify(back));
  if (!back.firstBuy || back.firstBuy.top < back.tabs.bottom || back.firstBuy.bottom > 844) {
    failures.push("Listings tap does not bring listings back into view");
  }
  await page.screenshot({ path: `${OUT}/narrow-after-listings-tap.png` });

  await page.tap('.preview-skin-tabs [data-pane="tradeups"]');
  await sleep(1500);
  const trades = await page.evaluate(layout);
  console.log("narrow after Trade-ups tap:", JSON.stringify(trades));
  if (!trades.board?.visible || trades.listings?.visible) failures.push("Trade-ups tab does not swap panes");
  if (!trades.board || Math.abs(trades.board.top - trades.tabs.bottom) > 12) {
    failures.push(`Trade-ups tap does not land on the board's top (board ${trades.board?.top}, tabs ${trades.tabs?.bottom})`);
  }
  await page.screenshot({ path: `${OUT}/narrow-tradeups-tab.png` });

  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/skins/${SLUG}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector(".preview-skin-pane--listings a.preview-link", { timeout: 60000 });
  await sleep(1500);
  const wide = await page.evaluate(layout);
  console.log("wide:", JSON.stringify(wide));
  if (wide.tabs?.visible) failures.push("tabs visible on the wide split");
  if (!wide.chart || !wide.listings || wide.chart.top > wide.listings.top) failures.push("wide split no longer keeps the chart above listings");
  if (!wide.board?.visible || !wide.listings?.visible) failures.push("wide split does not show listings and board together");
  await page.screenshot({ path: `${OUT}/wide.png` });
} finally {
  await browser.close();
}
console.log(failures.length === 0 ? "\nSKIN-MOBILE PASS" : `\nSKIN-MOBILE FAIL:\n- ${failures.join("\n- ")}`);
process.exit(failures.length === 0 ? 0 : 1);
