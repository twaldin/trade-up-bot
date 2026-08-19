/**
 * Regression probe for the stall Tim hit: hang every faces route and confirm
 * the board still paints outcomes and clears its loading state.
 */
import { mkdirSync } from "node:fs";
import puppeteer from "puppeteer";

const OUT = process.env.QA_OUT ?? "/tmp/qa-faces-down";
const BASE = process.env.QA_BASE ?? "http://127.0.0.1:5173";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: "new", protocolTimeout: 240000,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 2 },
});
const failures = [];
try {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  let hung = 0;
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("/api/preview/faces") || /\/skins\/[a-z0-9-]+$/.test(new URL(url).pathname)) {
      hung += 1;
      return; // never respond, never abort: the worst case
    }
    req.continue();
  });

  const started = Date.now();
  await page.goto(`${BASE}/preview/trade-ups`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector(".preview-card", { timeout: 60000 });
  await page.waitForFunction(
    () => document.querySelectorAll(".preview-skin--output").length > 0,
    { timeout: 30000 },
  ).catch(() => failures.push("outcomes never rendered while faces hung"));
  const elapsed = Date.now() - started;

  const state = await page.evaluate(() => ({
    outputs: document.querySelectorAll(".preview-skin--output").length,
    strips: document.querySelectorAll(".preview-strip__tick").length,
    stillLoadingBoard: document.body.innerText.includes("Loading trade-ups"),
    stillLoadingOutcomes: document.body.innerText.includes("Outcomes loading"),
    placeholders: document.querySelectorAll(".preview-skin__ph").length,
  }));
  console.log("hung face requests:", hung, "ms to outcomes:", elapsed);
  console.log(JSON.stringify(state, null, 2));
  if (state.outputs === 0) failures.push("no output tiles");
  if (state.strips === 0) failures.push("no payoff ticks");
  if (state.stillLoadingBoard) failures.push("board still says Loading trade-ups");
  if (state.stillLoadingOutcomes) failures.push("card still says Outcomes loading");
  await page.screenshot({ path: `${OUT}/faces-down.png` });
} finally {
  await browser.close();
}
console.log(failures.length === 0 ? "\nFACES-DOWN PASS" : `\nFACES-DOWN FAIL:\n- ${failures.join("\n- ")}`);
process.exit(failures.length === 0 ? 0 : 1);
