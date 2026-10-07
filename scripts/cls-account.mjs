/**
 * Signed-in /my-trade-ups CLS harness.
 * PerformanceObserver layout-shift in Playwright Chromium, mocked APIs.
 *
 * Usage: node /tmp/cls-account.mjs [--shots]
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import puppeteer from "puppeteer";

const BASE = process.env.CLS_BASE || "http://127.0.0.1:5173";
const SHOTS = process.argv.includes("--shots");
const OUT = process.env.CLS_OUT || "/tmp/cls-after";

const USER = {
  steam_id: "76561198000000001",
  display_name: "Ada",
  avatar_url: "",
  tier: "pro",
  is_admin: false,
};

const STATS = {
  all_time_profit_cents: 18420,
  total_executed: 6,
  total_sold: 4,
  win_count: 3,
  win_rate: 75,
  avg_roi: 12.4,
};

function tradeUp(id) {
  const inputs = Array.from({ length: 10 }, (_, i) => ({
    listing_id: `csfloat-${id}-${i}`,
    skin_id: "skin-1",
    skin_name: "AK-47 | Redline",
    collection_name: "The Phoenix Collection",
    price_cents: 450 + i,
    float_value: 0.1523,
    condition: "Field-Tested",
    source: "csfloat",
    stattrak: false,
  }));
  return {
    id,
    type: "classified_covert",
    inputs,
    outcomes: [{
      skin_id: "out-1",
      skin_name: "AK-47 | Fire Serpent",
      collection_name: "The Phoenix Collection",
      probability: 1,
      predicted_float: 0.1523,
      predicted_condition: "Field-Tested",
      estimated_price_cents: 12000,
    }],
    total_cost_cents: 5000,
    expected_value_cents: 12000,
    profit_cents: 7000,
    roi_percentage: 140,
    chance_to_profit: 1,
    best_case_cents: 7000,
    worst_case_cents: 7000,
    created_at: "2026-08-01T00:00:00.000Z",
    claimed_by_me: true,
    claim_expires_at: "2026-10-07T18:30:00.000Z",
  };
}

const VIEWPORTS = [
  { width: 360, height: 844 },
  { width: 375, height: 844 },
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
];
const DELAYS = (process.env.CLS_DELAYS || "500,2000,5000").split(",").map((value) => Number(value));
const CASES = (process.env.CLS_CASES || "empty,claims,error").split(",");

function json(body, status = 200) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

async function measure(browser, { width, height, delay, list }) {
  const page = await browser.newPage({ viewport: { width, height } });
  const hits = [];
  await page.addInitScript(() => {
    const shifts = [];
    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const sources = [];
        const raw = entry.sources || [];
        for (const source of raw) {
          const node = source.node;
          const cls = node && typeof node.className === "string" ? node.className : "";
          sources.push({
            name: node ? node.nodeName : "",
            id: node && node.id ? node.id : "",
            cls: String(cls).slice(0, 160),
            text: node && node.textContent ? String(node.textContent).replace(/\s+/g, " ").slice(0, 80) : "",
            prev: source.previousRect
              ? { y: Math.round(source.previousRect.y), h: Math.round(source.previousRect.height) }
              : null,
            curr: source.currentRect
              ? { y: Math.round(source.currentRect.y), h: Math.round(source.currentRect.height) }
              : null,
          });
        }
        shifts.push({ value: entry.value, start: Math.round(entry.startTime), hadInput: entry.hadRecentInput, sources });
      }
    });
    obs.observe({ type: "layout-shift", buffered: true });
    window.__clsShifts = shifts;
  });

  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname + url.search;
    if (!path.startsWith("/api/") && !path.startsWith("/__face")) {
      await route.continue();
      return;
    }
    hits.push(path.split("?")[0]);
    if (path.startsWith("/api/auth/me")) {
      await route.fulfill(json(USER));
      return;
    }
    if (path.startsWith("/api/my-trade-ups/stats")) {
      await new Promise((r) => setTimeout(r, delay));
      await route.fulfill(list === "error" ? json({ error: "nope" }, 500) : json(STATS));
      return;
    }
    if (path.includes("my_claims=true")) {
      await new Promise((r) => setTimeout(r, delay));
      await route.fulfill(list === "error"
        ? json({ error: "nope" }, 500)
        : json({ trade_ups: list === "claims" ? [tradeUp(41)] : [], tier: "pro" }));
      return;
    }
    if (path.startsWith("/api/claims")) {
      await route.fulfill(json({ claims: list === "claims" ? [{ id: 1, trade_up_id: 41, expires_at: "2026-10-07T18:30:00.000Z" }] : [] }));
      return;
    }
    if (path.startsWith("/api/preview/faces")) {
      await route.fulfill(json({ faces: { "AK-47 | Redline": null, "AK-47 | Fire Serpent": null } }));
      return;
    }
    await route.fulfill(json({}));
  });

  await page.goto(`${BASE}/my-trade-ups`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(200);
  const early = await page.evaluate(() => {
    const box = (sel) => {
      const node = document.querySelector(sel);
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { y: Math.round(rect.y), h: Math.round(rect.height) };
    };
    return {
      stats: box(".preview-stats"),
      tabs: box(".preview-tabs"),
      slot: box(".preview-account__slot"),
      toolbar: box(".preview-toolbar"),
      footer: box(".preview-console__legal"),
      head: box(".preview-page__head"),
    };
  });
  if (SHOTS && delay === 2000) {
    await page.waitForTimeout(250);
    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: `${OUT}/${width}-${list}-loading.png` });
  }
  await page.waitForTimeout(delay + 1200);
  if (SHOTS && delay === 2000) {
    await page.screenshot({ path: `${OUT}/${width}-${list}-loaded.png` });
  }
  const report = await page.evaluate(() => {
    const shifts = window.__clsShifts || [];
    const quiet = shifts.filter((row) => !row.hadInput).sort((a, b) => a.start - b.start);
    const score = quiet.reduce((sum, row) => sum + row.value, 0);
    let session = 0;
    let windowSum = 0;
    let windowStart = 0;
    let last = -1e9;
    for (const row of quiet) {
      if (windowSum === 0 || row.start - last >= 1000 || row.start - windowStart >= 5000) {
        windowSum = row.value;
        windowStart = row.start;
      } else {
        windowSum += row.value;
      }
      last = row.start;
      if (windowSum > session) session = windowSum;
    }
    const footer = document.querySelector(".preview-console__legal");
    const stats = document.querySelector(".preview-stats");
    const tabs = document.querySelector(".preview-tabs");
    const slot = document.querySelector(".preview-account__slot");
    const box = (node) => {
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { y: Math.round(rect.y), h: Math.round(rect.height), bottom: Math.round(rect.bottom) };
    };
    return {
      score,
      session,
      shifts,
      footer: box(footer),
      stats: box(stats),
      tabs: box(tabs),
      slot: box(slot),
      dash: stats ? (stats.textContent || "").includes("—") : false,
      error: (document.body.textContent || "").includes("Could not load trade-ups."),
      innerHeight: window.innerHeight,
    };
  });
  await page.close();
  return {
    width,
    height,
    delay,
    list,
    cls: Number(report.score.toFixed(4)),
    session: Number(report.session.toFixed(4)),
    shifts: report.shifts,
    footer: report.footer,
    stats: report.stats,
    tabs: report.tabs,
    slot: report.slot,
    dash: report.dash,
    error: report.error,
    innerHeight: report.innerHeight,
    early,
    hits: [...new Set(hits)],
  };
}

const browser = await chromium.launch({
  executablePath: puppeteer.default?.executablePath?.() || puppeteer.executablePath(),
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const rows = [];
try {
  for (const vp of VIEWPORTS) {
    for (const delay of DELAYS) {
      for (const list of CASES) {
        const row = await measure(browser, { ...vp, delay, list });
        rows.push(row);
        const top = row.shifts
          .filter((s) => !s.hadInput && s.value >= 0.001)
          .sort((a, b) => b.value - a.value)
          .slice(0, 2)
          .map((s) => `${s.value.toFixed(3)}@${s.start} ${s.sources.map((src) => `${src.cls || src.name} ${src.prev?.y}/${src.prev?.h}->${src.curr?.y}/${src.curr?.h}`).join(" | ")}`)
          .join(" || ");
        const detail = process.env.CLS_DEBUG ? ` early ${JSON.stringify(row.early)} late stats ${JSON.stringify(row.stats)} ${top}` : "";
        const errorNote = row.list === "error" ? ` slot ${row.slot?.h ?? "?"} dash ${row.dash} msg ${row.error}` : "";
        console.log(`${row.width}x${row.height} ${row.delay}ms ${row.list} sum ${row.cls} session ${row.session}${errorNote}${detail}`);
      }
    }
  }
} finally {
  await browser.close();
}

console.log("\nTABLE");
console.log("width\tdelay\tlist\tsum\tsession");
for (const row of rows) console.log(`${row.width}\t${row.delay}\t${row.list}\t${row.cls}\t${row.session}`);
