// One-off reconnaissance: screenshots + visible text of each public page so the
// capture script can target real selectors. Output: .explore/ (gitignored).
import { chromium } from "playwright";
import fs from "node:fs/promises";

const BASE = "https://tradeupbot.app";
const OUT = new URL("../.explore/", import.meta.url).pathname;
await fs.mkdir(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
const page = await ctx.newPage();
let apiCalls = 0;
page.on("response", (r) => {
  if (r.url().includes("/api/")) {
    apiCalls++;
    if (r.status() === 429) console.log("429", r.url());
  }
});

for (const p of ["/", "/calculator", "/trade-ups", "/skins", "/pricing"]) {
  await page.goto(BASE + p, { waitUntil: "networkidle", timeout: 60000 });
  await sleep(4000);
  const slug = p === "/" ? "home" : p.slice(1);
  await page.screenshot({ path: `${OUT}${slug}.png`, fullPage: true });
  await fs.writeFile(`${OUT}${slug}.txt`, await page.evaluate(() => document.body.innerText));
  console.log(p, "api calls so far", apiCalls);
  await sleep(5000);
}
await browser.close();
