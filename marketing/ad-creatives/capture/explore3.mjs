// Reconnaissance, pass 3: expanded card + evaluated calculator + skin page.
import { chromium } from "playwright";
import fs from "node:fs/promises";

const BASE = "https://tradeupbot.app";
const OUT = new URL("../.explore/", import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
const page = await ctx.newPage();
let api = 0;
page.on("response", (r) => { if (r.url().includes("/api/")) { api++; if (r.status() === 429) console.log("429", r.url()); } });

await page.goto(BASE + "/trade-ups", { waitUntil: "networkidle" });
await sleep(5000);
const cardInfo = await page.evaluate(() => {
  const btn = document.querySelector("button.sr-only[aria-expanded]");
  const card = btn?.parentElement;
  return { cardTag: card?.tagName, cardClass: card?.className, parentClass: card?.parentElement?.className, cardHtml: card?.outerHTML.slice(0, 6000) };
});
await fs.writeFile(OUT + "card.json", JSON.stringify(cardInfo, null, 2));
await page.evaluate(() => document.querySelector("button.sr-only[aria-expanded]")?.click());
await sleep(5000);
await page.screenshot({ path: OUT + "tu-expanded.png" });
await page.screenshot({ path: OUT + "tu-expanded-full.png", fullPage: true });
await fs.writeFile(OUT + "tu-expanded.txt", await page.evaluate(() => document.body.innerText));
await fs.writeFile(OUT + "tu-expanded.html", await page.evaluate(() => document.querySelector("main")?.outerHTML ?? document.body.outerHTML));
console.log("tu done, api", api, "url", page.url());
await sleep(10000);

await page.goto(BASE + "/calculator", { waitUntil: "networkidle" });
await sleep(3000);
await page.getByRole("button", { name: /load example/i }).click();
await sleep(2000);
await page.getByRole("button", { name: /^evaluate$/i }).click();
await page.waitForFunction(() => !/Evaluating/.test(document.body.innerText), null, { timeout: 60000 }).catch(() => console.log("eval timeout"));
await sleep(2000);
await page.screenshot({ path: OUT + "calc-result.png", fullPage: true });
await fs.writeFile(OUT + "calc-result.txt", await page.evaluate(() => document.body.innerText));
await fs.writeFile(OUT + "calc-result.html", await page.evaluate(() => document.querySelector("main")?.outerHTML ?? ""));
console.log("calc done, api", api);
await sleep(10000);

await page.goto(BASE + "/skins", { waitUntil: "networkidle" });
await sleep(5000);
await page.screenshot({ path: OUT + "skins-view.png" });
const links = await page.evaluate(() => [...document.querySelectorAll("a")].map((a) => a.getAttribute("href")).filter((h) => h && h.startsWith("/skins/")).slice(0, 30));
console.log(links);
const rows = await page.evaluate(() => [...document.querySelectorAll("[role=row], tr, button")].slice(0, 5).map((e) => e.outerHTML.slice(0, 500)));
await fs.writeFile(OUT + "skins-rows.json", JSON.stringify({ links, rows }, null, 2));
console.log("done, api", api);
await browser.close();
