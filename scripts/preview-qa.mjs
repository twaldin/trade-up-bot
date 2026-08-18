import { mkdirSync } from "node:fs";
import puppeteer from "puppeteer";

const OUT = process.env.QA_OUT ?? "/opt/cursor/artifacts/screenshots";
const BASE = process.env.QA_BASE ?? "http://127.0.0.1:5173";
const TAG = process.env.QA_TAG ?? "";
mkdirSync(OUT, { recursive: true });

const shot = (name) => `${OUT}/${TAG}${name}.png`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setMode(page, mode) {
  await page.evaluate((want) => {
    const root = document.querySelector("[data-preview]");
    if (!root) return;
    if (root.getAttribute("data-mode") === want) return;
    const buttons = [...document.querySelectorAll("button")];
    const toggle = buttons.find((b) => /^(Light|Dark)$/.test(b.textContent.trim()));
    toggle?.click();
  }, mode);
  await sleep(900);
}

async function boardReady(page) {
  await page.goto(`${BASE}/preview/trade-ups`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector(".preview-card", { timeout: 60000 });
  // outcomes hydrate after the first paint
  await page.waitForFunction(
    () => document.querySelectorAll(".preview-skin--output").length > 0,
    { timeout: 60000 },
  ).catch(() => {});
  await sleep(2500);
}

const browser = await puppeteer.launch({
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
  defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 2 },
});

try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE:", m.text().slice(0, 200)); });

  await boardReady(page);
  await setMode(page, "dark");
  await page.screenshot({ path: shot("board-dark") });
  console.log("board-dark ok");

  await setMode(page, "light");
  await page.screenshot({ path: shot("board-light") });
  console.log("board-light ok");

  // expanded row, dark
  await setMode(page, "dark");
  // the card itself is the toggle now — no header button
  const expanded = await page.evaluate(() => {
    const card = document.querySelector(".preview-card");
    if (!card) return false;
    card.click();
    return true;
  });
  if (expanded) {
    await sleep(3500);
    await page.evaluate(() => {
      document.querySelector(".preview-card--expanded")?.scrollIntoView({ block: "start" });
    });
    await sleep(700);
    await page.screenshot({ path: shot("board-expanded") });
    console.log("board-expanded ok");

    await setMode(page, "light");
    await page.evaluate(() => {
      document.querySelector(".preview-card--expanded")?.scrollIntoView({ block: "start" });
    });
    await sleep(700);
    await page.screenshot({ path: shot("board-expanded-light") });
    console.log("board-expanded-light ok");
  } else {
    console.log("EXPAND BUTTON NOT FOUND");
  }

  // landing
  await page.goto(`${BASE}/preview`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await sleep(2500);
  await setMode(page, "dark");
  await page.screenshot({ path: shot("landing-laptop") });
  console.log("landing-laptop ok");

  // measurements
  await boardReady(page);
  const metrics = await page.evaluate(() => {
    const first = document.querySelector(".preview-card");
    const inTile = document.querySelector(".preview-skin--input");
    const outTile = document.querySelector(".preview-skin--output");
    const img = document.querySelector(".preview-skin img");
    const box = (el) => (el ? { w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) } : null);
    const ink = (tile) => {
      const label = tile?.querySelector(".preview-skin__label b");
      return label ? getComputedStyle(label).color : null;
    };
    return {
      cards: document.querySelectorAll(".preview-card").length,
      card: box(first),
      inTile: box(inTile),
      outTile: box(outTile),
      img: box(img),
      bodyText: document.body.innerText.slice(0, 400),
      hasContract: /\bcontracts?\b/i.test(document.body.innerText),
      inputInk: ink(inTile),
      outputInk: ink(outTile),
    };
  });
  console.log(JSON.stringify(metrics, null, 2));
} finally {
  await browser.close();
}
