/**
 * The live board only has two-outcome trade-ups today, so this drives the same
 * page with a mocked /outcomes response to check how the strip behaves when the
 * ticks crowd. Test-side only — no product code is changed.
 */
import { mkdirSync } from "node:fs";
import puppeteer from "puppeteer";

const OUT = process.env.QA_OUT ?? "/tmp/qa-many";
const BASE = process.env.QA_BASE ?? "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const NAMES = [
  ["AK-47 | Nightwish", 5960],
  ["MP9 | Starlight Protector", 6022],
  ["AK-47 | Head Shot", 4100],
  ["Glock-18 | Water Elemental", 3200],
  ["AWP | Wildfire", 9800],
  ["M4A4 | The Emperor", 7400],
  ["USP-S | Kill Confirmed", 2600],
  ["AK-47 | Redline", 1500],
];

const browser = await puppeteer.launch({
  headless: "new",
  protocolTimeout: 240000,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
  defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 2 },
});

try {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (/\/api\/trade-up\/\d+\/outcomes/.test(req.url())) {
      const outcomes = NAMES.map(([skin_name, price], i) => ({
        skin_id: `mock-${i}`,
        skin_name,
        collection_name: "The Dreams & Nightmares Collection",
        probability: [0.30, 0.22, 0.16, 0.12, 0.08, 0.06, 0.04, 0.02][i],
        predicted_float: 0.2 + i * 0.03,
        predicted_condition: "Field-Tested",
        estimated_price_cents: price,
        sell_marketplace: "csfloat",
      }));
      req.respond({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ outcomes }),
      });
      return;
    }
    req.continue();
  });

  await page.goto(`${BASE}/preview/trade-ups`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector(".preview-strip__face", { timeout: 60000 });
  await sleep(4500);

  const info = await page.evaluate(() => {
    const strip = document.querySelector(".preview-strip");
    const faces = [...(strip?.querySelectorAll(".preview-strip__face") ?? [])];
    const box = strip?.getBoundingClientRect();
    return {
      faces: faces.length,
      crowded: strip?.classList.contains("is-crowded") ?? false,
      stripHeight: box ? Math.round(box.height) : null,
      insideWell: faces.every((f) => {
        const r = f.getBoundingClientRect();
        return box && r.left >= box.left - 1 && r.right <= box.right + 1;
      }),
      opacities: [...new Set(faces.map((f) => getComputedStyle(f).opacity))],
    };
  });
  console.log(JSON.stringify(info, null, 2));

  await page.screenshot({ path: `${OUT}/many-dark.png` });

  // hover the middle face: it must come forward
  await page.$$eval(".preview-strip__face", (els) => {
    els[Math.floor(els.length / 2)]?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
  });
  await sleep(600);
  await page.screenshot({ path: `${OUT}/many-hover.png` });

  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Light")?.click();
  });
  await sleep(1000);
  await page.screenshot({ path: `${OUT}/many-light.png` });
  console.log("shots in", OUT);
} finally {
  await browser.close();
}
