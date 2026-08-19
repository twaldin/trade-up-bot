/**
 * Click-through tour of every preview route in both modes. Shoots the pages the
 * QA skill asks for and reports leaked production chrome it finds in the DOM.
 */
import { mkdirSync } from "node:fs";
import puppeteer from "puppeteer";

const OUT = process.env.QA_OUT ?? "/opt/cursor/artifacts/screenshots";
const BASE = process.env.QA_BASE ?? "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const LEAKS = [
  "rounded-md", "rounded-lg", "rounded-xl", "rounded-full",
  "text-muted-foreground", "border-border", "bg-background", "bg-card",
  "text-foreground", "bg-muted", "text-primary", "bg-primary",
];

const ROUTES = [
  { path: "/", name: "landing", wait: ".preview-hero" },
  { path: "/trade-ups", name: "board", wait: ".preview-skin--output" },
  { path: "/skins", name: "skins", wait: ".preview-grid" },
  { path: "/collections", name: "collections", wait: ".preview-collection" },
  { path: "/collections/dreams-nightmares", name: "collection", wait: ".preview-allskins" },
  { path: "/calculator", name: "calculator", wait: ".preview-toolbar" },
  { path: "/account", name: "account", wait: ".preview-page" },
  { path: "/pricing", name: "pricing", wait: ".preview-plans" },
  { path: "/faq", name: "faq", wait: ".preview-faq" },
  { path: "/features", name: "features", wait: ".preview-doc" },
  { path: "/blog", name: "blog", wait: ".preview-posts" },
  { path: "/terms", name: "terms", wait: ".preview-doc" },
  { path: "/privacy", name: "privacy", wait: ".preview-doc" },
  { path: "/listing-sniper", name: "sniper", wait: ".preview-page" },
];

const browser = await puppeteer.launch({
  headless: "new",
  protocolTimeout: 240000,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
  defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 2 },
});

const problems = [];

async function setMode(page, want) {
  await page.evaluate((mode) => {
    const root = document.querySelector("[data-preview]");
    if (!root || root.getAttribute("data-mode") === mode) return;
    [...document.querySelectorAll("button")]
      .find((b) => /^(Light|Dark)$/.test(b.textContent.trim()))
      ?.click();
  }, want);
  await sleep(900);
}

async function auditChrome(page, label) {
  const found = await page.evaluate((leaks) => {
    const hits = new Set();
    for (const el of document.querySelectorAll("[data-preview] *")) {
      const cls = typeof el.className === "string" ? el.className : "";
      for (const leak of leaks) if (cls.split(/\s+/).includes(leak)) hits.add(leak);
    }
    // The Ledger lid and Orbit shell are a drawn device, not UI chrome: their
    // corners are industrial-design geometry and do not owe the control scale.
    const radii = new Set();
    for (const el of document.querySelectorAll("[data-preview] *")) {
      if (el.closest(".lg-port, .o-phone-port")) continue;
      const r = getComputedStyle(el).borderRadius;
      if (r && r !== "0px" && r !== "50%" && !["4px", "6px"].includes(r.split(" ")[0])) radii.add(r);
    }
    return { hits: [...hits], radii: [...radii].slice(0, 6) };
  }, LEAKS);
  if (found.hits.length) problems.push(`${label}: leaked classes ${found.hits.join(", ")}`);
  if (found.radii.length) problems.push(`${label}: non-token radius ${found.radii.join(", ")}`);
}

try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

  for (const route of ROUTES) {
    await page.goto(`${BASE}${route.path}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForSelector(route.wait, { timeout: 60000 }).catch(() => {
      problems.push(`${route.name}: never rendered ${route.wait}`);
    });
    await sleep(route.name === "board" ? 4000 : 2200);

    // The landing is one left-aligned editorial column: every section title,
    // lede and card group must share the hero's left rail at any width.
    if (route.name === "landing") {
      const rails = await page.evaluate(() => {
        const left = (sel) => {
          const el = document.querySelector(sel);
          return el ? Math.round(el.getBoundingClientRect().left) : null;
        };
        return {
          hero: left(".preview-hero h1"),
          bandKicker: left(".preview-section--band .o-kicker"),
          bandHeading: left(".preview-section--band h2"),
          bandLede: left(".preview-section--band .preview-section__lede"),
          cards: left(".preview-tiles"),
          how: left("#how h2"),
          faq: left("#faq h2"),
        };
      });
      const off = Object.entries(rails).filter(([, value]) => value !== rails.hero);
      if (off.length > 0) {
        problems.push(`landing left rail: hero at ${rails.hero}, off by ${JSON.stringify(off)}`);
      }
    }

    for (const mode of ["dark", "light"]) {
      await setMode(page, mode);
      await page.screenshot({ path: `${OUT}/tour-${route.name}-${mode}.png` });
      await auditChrome(page, `${route.name}/${mode}`);
    }
    console.log(`${route.name} ok`);
  }

  // currency menu open, both modes
  await page.goto(`${BASE}/trade-ups`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector(".preview-currency__trigger", { timeout: 30000 });
  await sleep(2500);
  for (const mode of ["dark", "light"]) {
    await setMode(page, mode);
    await page.$eval(".preview-currency__trigger", (el) => el.click());
    await sleep(500);
    const menu = await page.$(".preview-menu");
    if (!menu) problems.push(`currency/${mode}: menu did not open`);
    await page.screenshot({ path: `${OUT}/tour-currency-${mode}.png` });
    await auditChrome(page, `currency/${mode}`);
    await page.keyboard.press("Escape");
    await sleep(300);
  }
  console.log("currency ok");

  // a skin page reached from a board tile name
  await page.goto(`${BASE}/trade-ups`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector(".preview-skin__label", { timeout: 60000 });
  await sleep(3000);
  await page.$eval(".preview-skin__label", (el) => el.click());
  await sleep(3500);
  const url = page.url();
  if (!url.includes("/skins/")) problems.push(`skin name click went to ${url}`);
  const body = await page.evaluate(() => document.body.innerText);
  if (/skin not found/i.test(body)) problems.push("preview skin page says skin not found");
  if (/not in the live dataset/i.test(body)) problems.push("preview skin page could not resolve the slug");
  await page.screenshot({ path: `${OUT}/tour-skin-dark.png` });
  await setMode(page, "light");
  await page.screenshot({ path: `${OUT}/tour-skin-light.png` });
  console.log("skin page ok:", url);
} finally {
  await browser.close();
}

console.log(problems.length === 0 ? "\nTOUR PASS" : `\nTOUR FAIL:\n- ${problems.join("\n- ")}`);
process.exit(problems.length === 0 ? 0 : 1);
