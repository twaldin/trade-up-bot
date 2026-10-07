/**
 * R1: each remaining upgrade control fires one upgrade_cta_click and one
 * page_view, and stays inside the client router.
 *
 * gtag.js is blocked, so this script records the one history page_view the
 * live containers send. An app-emitted page_view on the same click makes the
 * count 2 and fails. A full document load drops the alive marker and fails.
 *
 *   node scripts/upgrade-cta-r1.mjs
 *   QA_BASE=http://127.0.0.1:5173 node scripts/upgrade-cta-r1.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const shots = "/opt/cursor/artifacts/screenshots";
mkdirSync(shots, { recursive: true });

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GA4 = "G-2474G4P5QE";
const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const FREE = { steam_id: "76561190000000001", display_name: "QA Free", avatar_url: "", tier: "free", is_admin: false, lifetime: false };
const TRADE_UP = {
  id: 1,
  type: "classified_covert",
  total_cost_cents: 1000,
  expected_value_cents: 1200,
  profit_cents: 200,
  roi_percentage: 20,
  created_at: "2026-10-01T00:00:00.000Z",
  is_theoretical: false,
  inputs: [],
  outcomes: [],
  chance_to_profit: 0,
  best_case_cents: 0,
  worst_case_cents: 0,
  listing_status: "active",
};
const LIST = { trade_ups: [], tier: "free", total: 0, total_profitable: 0 };

const VIEWPORTS = [
  { name: "1280", width: 1280, height: 800, mobile: false },
  { name: "390", width: 390, height: 844, mobile: true },
];

const CASES = [
  {
    name: "landing compare plans",
    path: "/",
    user: null,
    selector: 'a.preview-btn--lime[href="/pricing"]',
    cta: "landing_plan_tile",
    verify: false,
    destination: "/pricing",
  },
  {
    name: "nav pricing",
    path: "/",
    user: null,
    selector: 'nav[aria-label="Product"] a[href="/pricing"]',
    cta: "nav_pricing",
    verify: false,
    destination: "/pricing",
  },
  {
    name: "footer pricing",
    path: "/",
    user: null,
    selector: "footer.preview-footer a[href='/pricing']",
    cta: "nav_pricing",
    verify: false,
    destination: "/pricing",
  },
  {
    name: "free verify chip",
    path: "/trade-ups/1",
    user: FREE,
    selector: ".preview-page__meta a.preview-btn",
    cta: "share_bar",
    verify: true,
    destination: "/pricing",
  },
];

const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${message}`);
  if (!ok) failures.push(message);
};

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

async function waitForHost(base, child) {
  const started = Date.now();
  let log = "";
  child.stdout?.on("data", (chunk) => { log += chunk; });
  child.stderr?.on("data", (chunk) => { log += chunk; });
  while (Date.now() - started < 60_000) {
    if (child.exitCode != null) throw new Error(`vite exited ${child.exitCode}\n${log}`);
    try {
      const res = await fetch(base);
      if (res.ok) return;
    } catch { /* still booting */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`vite did not answer at ${base}\n${log.slice(-2000)}`);
}

function startVite(port) {
  const child = spawn(process.execPath, [
    resolve(root, "node_modules/vite/bin/vite.js"),
    "--host", "127.0.0.1",
    "--port", String(port),
    "--strictPort",
  ], {
    cwd: root,
    env: { ...process.env, API_PROXY: "", BROWSER: "none" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return child;
}

async function openPage(browser, base, { path, user, width, height, mobile }) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  if (mobile) await page.setUserAgent(MOBILE_UA);
  await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile });
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    let url;
    try { url = new URL(req.url()); } catch { req.continue(); return; }
    if (/google-analytics|googletagmanager|analytics\.google|facebook\.net|facebook\.com|stripe\.com/.test(url.hostname)) {
      req.abort();
      return;
    }
    if (url.pathname.startsWith("/auth/steam") || url.pathname === "/api/subscribe") {
      req.abort();
      return;
    }
    if (url.pathname === "/api/auth/me") {
      req.respond({ status: 200, contentType: "application/json", body: JSON.stringify(user) });
      return;
    }
    if (/^\/api\/trade-ups\/\d+$/.test(url.pathname)) {
      req.respond({ status: 200, contentType: "application/json", body: JSON.stringify(TRADE_UP) });
      return;
    }
    if (url.pathname.startsWith("/api/trade-ups")) {
      req.respond({ status: 200, contentType: "application/json", body: JSON.stringify(LIST) });
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      req.respond({ status: 200, contentType: "application/json", body: "{}" });
      return;
    }
    req.continue();
  });
  await page.evaluateOnNewDocument((measurementId) => {
    window.tubTracking = { ga4MeasurementId: measurementId };
    const wrap = (name) => {
      const orig = history[name];
      history[name] = function (state, title, url) {
        const before = location.pathname;
        const result = orig.apply(this, arguments);
        let next = location.pathname;
        if (typeof url === "string" && url.length > 0) {
          try { next = new URL(url, location.origin).pathname; } catch { /* keep location */ }
        }
        if (next !== before) {
          window.dataLayer = window.dataLayer || [];
          window.dataLayer.push(["event", "page_view", { page_path: next, source: "history" }]);
        }
        return result;
      };
    };
    wrap("pushState");
    wrap("replaceState");
  }, GA4);
  await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  return { context, page };
}

async function readLayer(page) {
  return page.evaluate(() => {
    const layer = window.dataLayer || [];
    const mark = window.__r1Mark ?? 0;
    const events = [];
    for (let i = mark; i < layer.length; i += 1) {
      const entry = layer[i];
      if (!entry || entry[0] !== "event") continue;
      const params = entry[2] || {};
      events.push({
        name: entry[1],
        cta: params.cta ?? null,
        surface: params.surface ?? null,
        source: params.source ?? null,
        page_path: params.page_path ?? null,
      });
    }
    const link = document.querySelector(window.__r1Selector);
    const box = link ? link.getBoundingClientRect() : null;
    return {
      events,
      alive: window.__r1Alive === 1,
      path: location.pathname,
      discover: link ? link.getAttribute("data-discover") : null,
      label: link ? (link.textContent || "").trim() : "",
      width: box ? box.width : 0,
      height: box ? box.height : 0,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  });
}

let vite = null;
const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

try {
  const base = process.env.QA_BASE ?? `http://127.0.0.1:${await freePort()}`;
  if (!process.env.QA_BASE) {
    const port = new URL(base).port;
    vite = startVite(port);
    await waitForHost(base, vite);
    console.log(`vite ${base}`);
  }

  for (const viewport of VIEWPORTS) {
    for (const spec of CASES) {
      const label = `${viewport.name} ${spec.name}`;
      const { context, page } = await openPage(browser, base, { ...spec, ...viewport });
      try {
        await page.waitForSelector(spec.selector, { timeout: 20_000 });
        await page.evaluate((selector) => {
          window.__r1Alive = 1;
          window.__r1Selector = selector;
          window.__r1Mark = (window.dataLayer || []).length;
        }, spec.selector);
        const beforeBox = await page.$eval(spec.selector, (el) => {
          const box = el.getBoundingClientRect();
          return { width: box.width, height: box.height, text: (el.textContent || "").trim() };
        });
        const sourceOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
        const shot = `${shots}/r1-${viewport.name}-${spec.name.replace(/\s+/g, "-")}.png`;
        const handle = await page.$(spec.selector);
        if (handle) await handle.screenshot({ path: shot });
        console.log(`${label} target ${Math.round(beforeBox.width)}x${Math.round(beforeBox.height)} "${beforeBox.text}"`);
        if (viewport.name === "390") {
          check(beforeBox.width >= 44 && beforeBox.height >= 44, `${label}: target ${Math.round(beforeBox.width)}x${Math.round(beforeBox.height)} is at least 44px`);
          check(!sourceOverflow, `${label}: no horizontal overflow before navigation`);
        }
        await Promise.all([
          page.waitForFunction((destination) => location.pathname === destination, { timeout: 10_000 }, spec.destination),
          page.click(spec.selector),
        ]);
        const after = await readLayer(page);
        const upgrades = after.events.filter((event) => event.name === "upgrade_cta_click");
        const views = after.events.filter((event) => event.name === "page_view");
        const verifies = after.events.filter((event) => event.name === "verify_click");
        check(after.alive, `${label}: document stayed loaded`);
        check(after.path === spec.destination, `${label}: path ${after.path} is ${spec.destination}`);
        check(upgrades.length === 1 && upgrades[0].cta === spec.cta, `${label}: one upgrade_cta_click ${spec.cta} (got ${JSON.stringify(upgrades)})`);
        check(views.length === 1 && views[0].page_path === spec.destination, `${label}: one page_view to ${spec.destination} (got ${JSON.stringify(views)})`);
        check(spec.verify ? verifies.length === 1 && verifies[0].surface === "share_bar" : verifies.length === 0, `${label}: verify_click count ${verifies.length}`);
        if (viewport.name === "390") {
          check(!after.overflow, `${label}: no horizontal overflow`);
        }
      } catch (err) {
        check(false, `${label}: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
  if (vite && !vite.killed) vite.kill("SIGTERM");
}

if (failures.length > 0) {
  console.error(`UPGRADE CTA FAIL (${failures.length})`);
  process.exit(1);
}
console.log("UPGRADE CTA OK");
