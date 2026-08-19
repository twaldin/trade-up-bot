/**
 * Phase-1 checks: output order matches the strip, expanding a mid-row card
 * fills its row instead of leaving a hole, the board pages in on scroll, and
 * the semantic search turns text into chips.
 */
import { mkdirSync } from "node:fs";
import puppeteer from "puppeteer";

const OUT = process.env.QA_OUT ?? "/opt/cursor/artifacts/screenshots";
const BASE = process.env.QA_BASE ?? "http://127.0.0.1:5173";
const ROOT = process.env.QA_ROOT ?? "/preview";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: "new", protocolTimeout: 240000,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
  defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 2 },
});
const failures = [];

try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => failures.push(`pageerror: ${e.message}`));
  await page.goto(`${BASE}${ROOT}/trade-ups`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector(".preview-skin--output", { timeout: 60000 });
  await sleep(4500);

  // 1. output tile order == tick order
  const order = await page.evaluate(() => {
    const card = document.querySelector(".preview-card");
    const tiles = [...(card?.querySelectorAll(".preview-skins--out .preview-skin__label b") ?? [])]
      .map((el) => el.textContent.trim());
    const ticks = [...(card?.querySelectorAll(".preview-strip__tick") ?? [])]
      .map((el) => ({ x: parseFloat(el.style.left), name: el.getAttribute("title")?.split(" · ")[0] }))
      .sort((a, b) => a.x - b.x)
      .map((row) => row.name);
    return { tiles, ticks };
  });
  console.log("tiles:", order.tiles.join(" | "));
  console.log("ticks:", order.ticks.join(" | "));
  const tickFinish = order.ticks.map((name) => (name ?? "").split("|").pop().trim());
  if (JSON.stringify(order.tiles) !== JSON.stringify(tickFinish)) {
    failures.push(`tile order ${order.tiles} != tick order ${tickFinish}`);
  }

  // 2. expand a mid-row card: its row must not leave a hole
  const geometry = await page.evaluate(async () => {
    const cards = [...document.querySelectorAll(".preview-card")];
    cards[1]?.click();
    await new Promise((r) => setTimeout(r, 1200));
    const after = [...document.querySelectorAll(".preview-card")];
    const expanded = document.querySelector(".preview-card--expanded");
    const rows = new Map();
    for (const card of after) {
      const box = card.getBoundingClientRect();
      const top = Math.round(box.top);
      rows.set(top, (rows.get(top) ?? 0) + 1);
    }
    const bento = document.querySelector(".preview-bento");
    const cols = getComputedStyle(bento).gridTemplateColumns.split(" ").length;
    // the expanded card owns its whole row; every other row must be full
    const expandedTop = expanded ? Math.round(expanded.getBoundingClientRect().top) : null;
    const short = [...rows.entries()].filter(([top, count]) => top !== expandedTop && count < cols);
    return { cols, expandedTop, rows: [...rows.entries()], shortRows: short, total: after.length };
  });
  console.log("grid:", JSON.stringify(geometry.rows), "cols", geometry.cols);
  if (!geometry.expandedTop) failures.push("expanding the second card did not expand anything");
  // only the final row may be short (it is the tail of the list)
  const tops = geometry.rows.map(([top]) => top).sort((a, b) => a - b);
  const lastTop = tops[tops.length - 1];
  const holes = geometry.shortRows.filter(([top]) => top !== lastTop);
  if (holes.length > 0) failures.push(`row gutter left behind at ${JSON.stringify(holes)}`);
  await page.screenshot({ path: `${OUT}/phase1-expand-fill.png` });

  // collapse again
  await page.evaluate(() => document.querySelector(".preview-collapse")?.click());
  await sleep(900);

  // 3. infinite scroll pages in
  const before = await page.$$eval(".preview-card", (els) => els.length);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.evaluate(() => {
    document.querySelector(".preview-console__main")?.scrollTo(0, 99999);
  });
  await sleep(5000);
  const after = await page.$$eval(".preview-card", (els) => els.length);
  console.log("cards before/after scroll:", before, after);
  if (after <= before) failures.push(`infinite scroll did not page in (${before} -> ${after})`);

  // 4. semantic chips
  await page.evaluate(() => {
    document.querySelector(".preview-console__main")?.scrollTo(0, 0);
    window.scrollTo(0, 0);
  });
  await page.click(".preview-search__input");
  await page.type(".preview-search__input", "covert <0.03 <$700", { delay: 25 });
  await sleep(1200);
  const chips = await page.$$eval(".preview-qchip", (els) =>
    els.map((el) => ({ label: el.querySelector("b")?.textContent, field: el.querySelector("em")?.textContent })));
  console.log("chips:", JSON.stringify(chips));
  if (chips.length !== 3) failures.push(`expected 3 chips, got ${chips.length}`);
  if (!chips.some((c) => c.field === "Max Price")) failures.push("no Max Price chip");
  if (!chips.some((c) => c.field === "Max Float")) failures.push("no Max Float chip");
  if (!chips.some((c) => c.field === "Tier")) failures.push("no Tier chip");
  await page.screenshot({ path: `${OUT}/phase1-search-chips.png` });

  // autocomplete with a picture
  await page.$eval(".preview-search__input", (el) => { el.value = ""; });
  await page.click(".preview-search__clear").catch(() => {});
  await page.click(".preview-search__input");
  await page.type(".preview-search__input", "nightwish", { delay: 30 });
  await sleep(2500);
  const hits = await page.$$eval(".preview-search__hit", (els) =>
    els.map((el) => ({ name: el.querySelector("span")?.textContent, img: !!el.querySelector("img") })));
  console.log("autocomplete:", JSON.stringify(hits.slice(0, 3)));
  if (hits.length === 0) failures.push("autocomplete offered nothing for 'nightwish'");
  await page.screenshot({ path: `${OUT}/phase1-autocomplete.png` });
} finally {
  await browser.close();
}

console.log(failures.length === 0 ? "\nPHASE1 PASS" : `\nPHASE1 FAIL:\n- ${failures.join("\n- ")}`);
process.exit(failures.length === 0 ? 0 : 1);
