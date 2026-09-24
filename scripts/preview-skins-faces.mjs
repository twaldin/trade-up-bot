/**
 * Regression probe for the art-less /skins first screen: every tile the grid
 * renders above the fold must get a Steam face once the faces route answers.
 */
import { mkdirSync } from "node:fs";
import puppeteer from "puppeteer";

const OUT = process.env.QA_OUT ?? "/tmp/qa-skins-faces";
const BASE = process.env.QA_BASE ?? "http://127.0.0.1:5173";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: "new", protocolTimeout: 240000,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1024, height: 720, deviceScaleFactor: 1 },
});
const failures = [];
try {
  const page = await browser.newPage();
  const batches = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.pathname !== "/api/preview/faces") return;
    batches.push((url.searchParams.get("names") ?? "").split("||").filter(Boolean));
  });

  await page.goto(`${BASE}/skins`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector(".preview-skin--card", { timeout: 60000 });
  await page.waitForNetworkIdle({ idleTime: 1500, timeout: 60000 }).catch(() => {});
  await sleep(1000);

  const state = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".preview-skin--card")];
    const fold = window.innerHeight;
    const above = cards.filter((card) => card.getBoundingClientRect().top < fold);
    const name = (card) => card.querySelector(".preview-skin__label b")?.textContent ?? "";
    return {
      tiles: cards.length,
      withArt: cards.filter((card) => card.querySelector(".preview-skin__art img")).length,
      aboveFold: above.length,
      aboveFoldWithArt: above.filter((card) => card.querySelector(".preview-skin__art img")).length,
      aboveFoldMissing: above.filter((card) => !card.querySelector(".preview-skin__art img")).map(name),
      first: cards.slice(0, 6).map(name),
    };
  });
  const requested = batches.flat();
  console.log("faces batches:", batches.map((b) => b.length).join(", ") || "none");
  console.log("Redline requested:", requested.includes("AK-47 | Redline"));
  console.log(JSON.stringify(state, null, 2));

  if (batches.some((b) => b.length > 80)) failures.push("a faces batch exceeds the server's 80-name cap");
  if (state.aboveFold === 0) failures.push("no tiles above the fold");
  if (state.aboveFoldWithArt < state.aboveFold) {
    failures.push(`${state.aboveFold - state.aboveFoldWithArt}/${state.aboveFold} above-fold tiles have no art`);
  }
  await page.screenshot({ path: `${OUT}/skins-above-fold.png` });
} finally {
  await browser.close();
}
console.log(failures.length === 0 ? "\nSKINS-FACES PASS" : `\nSKINS-FACES FAIL:\n- ${failures.join("\n- ")}`);
process.exit(failures.length === 0 ? 0 : 1);
