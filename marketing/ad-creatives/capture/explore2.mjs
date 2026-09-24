// Reconnaissance, pass 2: interactive states + computed theme tokens.
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

await page.goto(BASE + "/calculator", { waitUntil: "networkidle" });
await sleep(3000);
const tokens = await page.evaluate(() => {
  const cs = getComputedStyle(document.documentElement);
  const vars = {};
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        const t = rule.cssText;
        const m = t.match(/--[a-z0-9-]+:\s*[^;]+/gi);
        if (m && /^(:root|\.dark|html|\[data|\.pv|body)/.test(rule.selectorText || "")) {
          for (const d of m) { const [k, ...v] = d.split(":"); vars[(rule.selectorText || "") + " " + k.trim()] = v.join(":").trim(); }
        }
      }
    } catch {}
  }
  const body = getComputedStyle(document.body);
  return { htmlClass: document.documentElement.className, bodyClass: document.body.className, bg: body.backgroundColor, color: body.color, font: body.fontFamily, vars };
});
await fs.writeFile(OUT + "tokens.json", JSON.stringify(tokens, null, 2));

await page.getByRole("button", { name: /load example/i }).click();
await sleep(2500);
await page.screenshot({ path: OUT + "calc-loaded.png", fullPage: true });
await page.getByRole("button", { name: /^evaluate$/i }).click();
await sleep(6000);
await page.screenshot({ path: OUT + "calc-eval.png", fullPage: true });
await fs.writeFile(OUT + "calc-eval.txt", await page.evaluate(() => document.body.innerText));
console.log("calc done, api", api);
await sleep(8000);

await page.goto(BASE + "/trade-ups", { waitUntil: "networkidle" });
await sleep(5000);
await page.screenshot({ path: OUT + "tu-view.png" });
const exp = page.getByRole("button", { name: /expand the/i }).first();
await exp.click();
await sleep(5000);
await page.screenshot({ path: OUT + "tu-expanded.png", fullPage: true });
await fs.writeFile(OUT + "tu-expanded.txt", await page.evaluate(() => document.body.innerText));
const html = await page.evaluate(() => document.querySelector("main")?.outerHTML.slice(0, 200000) ?? "");
await fs.writeFile(OUT + "tu-expanded.html", html);
console.log("tu done, api", api);
await sleep(8000);

await page.goto(BASE + "/skins", { waitUntil: "networkidle" });
await sleep(4000);
const links = await page.evaluate(() => [...document.querySelectorAll("a[href*='/skins/']")].slice(0, 20).map((a) => a.getAttribute("href")));
console.log(links);
await fs.writeFile(OUT + "skin-links.json", JSON.stringify(links));
await sleep(6000);
if (links[0]) {
  await page.goto(BASE + links[0], { waitUntil: "networkidle" });
  await sleep(5000);
  await page.screenshot({ path: OUT + "skin-detail.png", fullPage: true });
  await fs.writeFile(OUT + "skin-detail.txt", await page.evaluate(() => document.body.innerText));
}
console.log("done, api", api);
await browser.close();
