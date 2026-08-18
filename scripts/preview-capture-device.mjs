/**
 * Refreshes the landing device stills from the running preview host so the
 * laptop and phone always show the board that actually shipped.
 *
 * Run after the board is final:
 *   node scripts/preview-capture-device.mjs
 */
import { mkdirSync } from "node:fs";
import puppeteer from "puppeteer";

const BASE = process.env.QA_BASE ?? "http://127.0.0.1:5173";
const OUT = "public/preview";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SHOTS = [
  { name: "desktop", width: 1440, height: 936 },
  { name: "mobile", width: 390, height: 844 },
];

mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
});

try {
  for (const shot of SHOTS) {
    const page = await browser.newPage();
    await page.setViewport({ width: shot.width, height: shot.height, deviceScaleFactor: 2 });
    await page.goto(`${BASE}/preview/trade-ups`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForSelector(".preview-skin--output", { timeout: 60000 });
    await sleep(4000);

    for (const mode of ["dark", "light"]) {
      await page.evaluate((want) => {
        const root = document.querySelector("[data-preview]");
        if (!root || root.getAttribute("data-mode") === want) return;
        [...document.querySelectorAll("button")]
          .find((b) => /^(Light|Dark)$/.test(b.textContent.trim()))
          ?.click();
      }, mode);
      await sleep(1200);
      const path = `${OUT}/board-${shot.name}-${mode}.webp`;
      await page.screenshot({ path, type: "webp", quality: 92 });
      console.log("wrote", path);
    }
    await page.close();
  }
} finally {
  await browser.close();
}
