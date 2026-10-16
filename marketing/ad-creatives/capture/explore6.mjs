// Reconnaissance, pass 6: what a /skins/:slug detail looks like.
import { chromium } from "playwright";
import fs from "node:fs/promises";
const OUT = new URL("../.explore/", import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
const page = await ctx.newPage();
await page.goto("https://tradeupbot.app/skins/ak-47-nightwish", { waitUntil: "networkidle" });
await sleep(4000);
await page.screenshot({ path: OUT + "skin-full.png", fullPage: true });
await fs.writeFile(OUT + "skin-full.txt", await page.evaluate(() => document.body.innerText));
await fs.writeFile(OUT + "skin-full.html", await page.evaluate(() => document.body.outerHTML.slice(0, 60000)));
await b.close();
