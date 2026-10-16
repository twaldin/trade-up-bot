// Reconnaissance, pass 4: fee copy + where "Verify / Claim trade-up" leads.
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

await page.goto(BASE + "/faq", { waitUntil: "networkidle" });
await sleep(3000);
await fs.writeFile(OUT + "faq.txt", await page.evaluate(() => document.body.innerText));
await page.screenshot({ path: OUT + "faq.png", fullPage: true });
await sleep(6000);

await page.goto(BASE + "/trade-ups", { waitUntil: "networkidle" });
await sleep(5000);
await page.evaluate(() => document.querySelector("button.sr-only[aria-expanded]")?.click());
await sleep(3000);
const vc = page.getByText(/Verify \/ Claim trade-up/).first();
const info = await vc.evaluate((el) => {
  const a = el.closest("a, button");
  return { tag: a?.tagName, href: a?.getAttribute("href"), html: a?.outerHTML.slice(0, 800) };
});
console.log(info);
await vc.scrollIntoViewIfNeeded();
await sleep(1000);
await page.screenshot({ path: OUT + "tu-verify-btn.png" });
const [popup] = await Promise.all([ctx.waitForEvent("page", { timeout: 8000 }).catch(() => null), vc.click()]);
await sleep(6000);
const target = popup ?? page;
console.log("after click url", target.url(), "api", api);
await target.screenshot({ path: OUT + "verify-target.png", fullPage: true });
await fs.writeFile(OUT + "verify-target.txt", await target.evaluate(() => document.body.innerText));
await browser.close();
