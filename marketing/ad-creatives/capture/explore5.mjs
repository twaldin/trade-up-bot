// Reconnaissance, pass 5: 390px mobile layout.
import { chromium, devices } from "playwright";
import fs from "node:fs/promises";

const BASE = "https://tradeupbot.app";
const OUT = new URL("../.explore/", import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["iPhone 13"], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: "dark" });
const page = await ctx.newPage();
let api = 0;
page.on("response", (r) => { if (r.url().includes("/api/")) { api++; if (r.status() === 429) console.log("429", r.url()); } });

await page.goto(BASE + "/trade-ups", { waitUntil: "networkidle" });
await sleep(5000);
await page.screenshot({ path: OUT + "m-tu.png" });
await page.evaluate(() => document.querySelector("button.sr-only[aria-expanded]")?.click());
await sleep(3000);
await page.screenshot({ path: OUT + "m-tu-exp.png", fullPage: true });
const cardTop = await page.evaluate(() => {
  const c = document.querySelector("article.preview-card");
  const r = c?.getBoundingClientRect();
  return { top: r?.top, h: r?.height, cls: c?.className, clickable: !!c?.onclick };
});
console.log("card", cardTop, "api", api);
await sleep(10000);
await page.goto(BASE + "/calculator", { waitUntil: "networkidle" });
await sleep(3000);
await page.screenshot({ path: OUT + "m-calc.png", fullPage: true });
await sleep(8000);
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await sleep(4000);
await page.screenshot({ path: OUT + "m-home.png" });
console.log("api", api);
await browser.close();
