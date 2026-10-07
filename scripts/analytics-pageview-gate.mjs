/**
 * Headed Chromium gate for GA4 page_view hygiene.
 *
 * The app bundle (/src/main.tsx) is held for 3.5s. Collect hits are answered
 * locally. First loads of /, /trade-ups, /calculator, /pricing, and /faq must
 * send one page_view per property. Client navigations must send exactly one
 * page_view to G-2474G4P5QE and leave G-EKWRB4FE37 unchanged. auth, lid,
 * session_id, and upgraded must not reach page_location or the Referer.
 *
 *   npx tsx scripts/analytics-pageview-gate.mjs before
 *   npx tsx scripts/analytics-pageview-gate.mjs after
 *
 * `after` exits 1 when a check fails.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";
import { deferSameOriginSubresources } from "../shared/defer-same-origin-subresources.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LEGACY = "G-EKWRB4FE37";
const GA4 = "G-2474G4P5QE";
const BUNDLE_DELAY_MS = 3500;
const SPA_WINDOW_MS = 4000;
const label = process.argv[2] === "after" ? "after" : "before";
const expectFixed = label === "after";

const ONLY = process.env.GATE_ONLY ?? "";
const FIRST_LOADS = ["/", "/trade-ups", "/calculator", "/pricing", "/faq"];
const SPA = [
  { from: "/faq", to: "/pricing", selector: "footer.preview-footer a[href='/pricing']" },
  { from: "/trade-ups", to: "/calculator", selector: "a.o-nav-item[href='/calculator']" },
  { from: "/", to: "/pricing", selector: "footer.preview-footer a[href='/pricing']" },
];
const DIRTY = [
  "/?auth=failed",
  "/?auth=new&lid=123",
  "/?upgraded=1&session_id=cs_x",
];
const LEAKS = ["auth=", "lid=", "eid=", "session_id=", "upgraded=", "auth%3D", "lid%3D", "session_id%3D", "upgraded%3D"];

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

function startVite(port) {
  return spawn(process.execPath, [
    resolve(root, "node_modules/vite/bin/vite.js"),
    "--host", "127.0.0.1",
    "--port", String(port),
    "--strictPort",
  ], {
    cwd: root,
    env: { ...process.env, API_PROXY: "", BROWSER: "none", GA4_MEASUREMENT_ID: GA4 },
    stdio: ["ignore", "pipe", "pipe"],
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
    } catch { /* booting */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`vite did not answer at ${base}\n${log.slice(-2000)}`);
}

function prepareHtml(html) {
  // Vite's react-refresh import is requested by the preload scanner before the
  // strip. Production HTML does not include it. Stub the globals so the app
  // still renders, and so that request never carries auth or lid.
  const refreshStub = `<script>window.$RefreshReg$=function(){};window.$RefreshSig$=function(){return function(type){return type;};};</script>`;
  let next = html.replace(/<script type="module">\s*import\s*\{[\s\S]*?\}\s*from\s*"\/@react-refresh"[\s\S]*?<\/script>/g, refreshStub);
  if (!next.includes(GA4)) {
    const tags = [
      `<script>window.tubTracking={"ga4MeasurementId":"${GA4}"};</script>`,
      `<script>gtag('config','${GA4}',{page_location:window.__tubPageLocation||location.href});</script>`,
    ].join("");
    next = next.replace("</head>", `${tags}</head>`);
  }
  // Production build moves same-origin scripts to after the strip so the
  // preload scanner cannot send auth, lid, or session_id on the Referer.
  // Vite dev leaves them parser-visible; apply the same move here.
  return deferSameOriginSubresources(next);
}

function isCollect(url) {
  const host = url.hostname;
  return host === "www.google-analytics.com"
    || host === "analytics.google.com"
    || host.endsWith(".google-analytics.com")
    || url.pathname.includes("/g/collect")
    || url.pathname.includes("/collect");
}

function eventsFromHit(rawUrl, body) {
  const url = new URL(rawUrl);
  const qs = url.searchParams;
  const baseTid = qs.get("tid") || "";
  const baseDl = qs.get("dl") || qs.get("ep.page_location") || "";
  const events = [];
  if (qs.get("en")) {
    events.push({ tid: baseTid, en: qs.get("en") || "", dl: baseDl });
  }
  if (!body) return events;
  for (const line of body.split(/\r?\n/)) {
    if (!line.includes("en=")) continue;
    const params = new URLSearchParams(line.replace(/^\??/, ""));
    const en = params.get("en");
    if (!en) continue;
    events.push({
      tid: params.get("tid") || baseTid,
      en,
      dl: params.get("dl") || params.get("ep.page_location") || baseDl,
    });
  }
  return events;
}

function pageViews(hits) {
  const grouped = { [LEGACY]: [], [GA4]: [] };
  for (const hit of hits) {
    for (const event of eventsFromHit(hit.url, hit.body)) {
      if (event.en !== "page_view") continue;
      if (!grouped[event.tid]) grouped[event.tid] = [];
      grouped[event.tid].push({ dl: event.dl, referer: hit.referer });
    }
  }
  return grouped;
}

function leakIn(value) {
  const text = value || "";
  return LEAKS.filter((token) => text.includes(token));
}

function leakSources(blobs) {
  const found = [];
  for (const blob of blobs) {
    const tokens = leakIn(blob.value);
    if (tokens.length > 0) found.push({ where: blob.where, tokens, sample: blob.value.slice(0, 400) });
  }
  return found;
}

mkdirSync("/opt/cursor/artifacts", { recursive: true });

const report = {
  label,
  bundleDelayMs: BUNDLE_DELAY_MS,
  headed: true,
  firstLoads: [],
  spa: [],
  dirty: [],
  gtagScripts: 0,
  failures: [],
};

function check(ok, message) {
  console.log(`${ok ? "ok  " : "FAIL"} ${message}`);
  if (!ok) report.failures.push(message);
}

let vite = null;
const browser = await puppeteer.launch({
  headless: false,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
});

try {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  vite = startVite(port);
  await waitForHost(base, vite);
  console.log(`vite ${base} (${label})`);

  async function openPage() {
    const page = await browser.newPage();
    const hits = [];
    const referers = [];
    await page.setViewport({ width: 1280, height: 800 });
    await page.setRequestInterception(true);
    page.on("pageerror", (err) => console.error("pageerror", err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") console.error("console", msg.text());
    });
    page.on("request", async (req) => {
      try {
        const url = new URL(req.url());
        const referer = req.headers().referer || "";
        if (url.hostname === "127.0.0.1" && url.pathname !== "/" && referer) {
          referers.push({ path: url.pathname, referer });
        }
        if (url.hostname.includes("googletagmanager.com") && url.pathname.includes("/gtag/js")) {
          report.gtagScripts += 1;
        }
        if (isCollect(url) && /google|doubleclick/.test(url.hostname)) {
          hits.push({ url: req.url(), referer, body: req.postData() || "", at: Date.now() });
          await req.respond({ status: 204, body: "" });
          return;
        }
        if (url.pathname === "/src/main.tsx") {
          await new Promise((r) => setTimeout(r, BUNDLE_DELAY_MS));
          await req.continue();
          return;
        }
        if (url.pathname.startsWith("/api/")) {
          await req.respond({ status: 200, contentType: "application/json", body: "null" });
          return;
        }
        if (req.resourceType() === "document" && req.method() === "GET") {
          const res = await fetch(req.url());
          const html = prepareHtml(await res.text());
          await req.respond({ status: 200, contentType: "text/html; charset=utf-8", body: html });
          return;
        }
        await req.continue();
      } catch (err) {
        try { await req.continue(); } catch { /* already handled */ }
        console.error("request", err instanceof Error ? err.message : err);
      }
    });
    return { page, hits, referers };
  }

  async function load(path) {
    const session = await openPage();
    await session.page.goto(`${base}${path}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await session.page.waitForSelector("footer.preview-footer a[href='/pricing'], a.o-nav-item[href='/calculator']", { timeout: 25_000 });
    await new Promise((r) => setTimeout(r, 1000));
    return session;
  }

  for (const path of (ONLY === "spa" || ONLY === "dirty" ? [] : FIRST_LOADS)) {
    const session = await load(path);
    try {
      const views = pageViews(session.hits);
      const row = {
        path,
        legacy: views[LEGACY].length,
        ga4: views[GA4].length,
        locations: {
          [LEGACY]: views[LEGACY].map((hit) => hit.dl),
          [GA4]: views[GA4].map((hit) => hit.dl),
        },
      };
      report.firstLoads.push(row);
      console.log(`load ${path} legacy=${row.legacy} ga4=${row.ga4}`);
      if (expectFixed) {
        check(row.legacy === 1, `${path} first load: one legacy page_view (got ${row.legacy})`);
        check(row.ga4 === 1, `${path} first load: one G-2474G4P5QE page_view (got ${row.ga4})`);
      }
    } finally {
      await session.page.close();
    }
  }

  for (const spec of (ONLY === "first" || ONLY === "dirty" ? [] : SPA)) {
    const session = await load(spec.from);
    try {
      const before = pageViews(session.hits);
      const marked = session.hits.length;
      await Promise.all([
        session.page.waitForFunction((dest) => location.pathname === dest, { timeout: 10_000 }, spec.to),
        session.page.click(spec.selector),
      ]);
      await new Promise((r) => setTimeout(r, SPA_WINDOW_MS));
      const added = pageViews(session.hits.slice(marked));
      const href = await session.page.evaluate(() => location.href);
      const row = {
        from: spec.from,
        to: spec.to,
        legacyBefore: before[LEGACY].length,
        ga4Before: before[GA4].length,
        legacyAdded: added[LEGACY].length,
        ga4Added: added[GA4].length,
        ga4Locations: added[GA4].map((hit) => hit.dl),
        href,
      };
      report.spa.push(row);
      console.log(`spa ${spec.from} -> ${spec.to} legacy+${row.legacyAdded} ga4+${row.ga4Added} ${JSON.stringify(row.ga4Locations)}`);
      if (expectFixed) {
        check(row.ga4Added === 1, `${spec.from} -> ${spec.to}: one page_view to ${GA4} (got ${row.ga4Added})`);
        check(row.legacyAdded === 0, `${spec.from} -> ${spec.to}: legacy page_view unchanged (got +${row.legacyAdded})`);
        check(row.ga4Locations.length === 1 && row.ga4Locations[0].endsWith(spec.to), `${spec.from} -> ${spec.to}: page_location ends with ${spec.to} (${row.ga4Locations.join(", ")})`);
      }
    } finally {
      await session.page.close();
    }
  }

  for (const path of (ONLY === "first" || ONLY === "spa" ? [] : DIRTY)) {
    const session = await load(path);
    try {
      const href = await session.page.evaluate(() => location.href);
      const views = pageViews(session.hits);
      const blobs = [
        { where: "href", value: href },
        ...session.hits.flatMap((hit) => [
          { where: "collect-url", value: hit.url },
          { where: "collect-body", value: hit.body },
          { where: "collect-referer", value: hit.referer },
          ...eventsFromHit(hit.url, hit.body).map((event) => ({ where: `dl:${event.tid}:${event.en}`, value: event.dl })),
        ]),
        ...session.referers.map((item) => ({ where: `referer:${item.path}`, value: item.referer })),
      ];
      const sources = leakSources(blobs);
      const leaked = [...new Set(sources.flatMap((source) => source.tokens))];
      const row = { path, href, leaked, sources, legacy: views[LEGACY].length, ga4: views[GA4].length };
      report.dirty.push(row);
      console.log(`dirty ${path} href=${href} leaked=${leaked.join(",") || "none"}`);
      if (expectFixed) {
        check(leaked.length === 0, `${path} stays out of page_location and Referer`);
        check(!href.includes("auth=") && !href.includes("lid=") && !href.includes("session_id=") && !href.includes("upgraded="), `${path} leaves a clean address bar (${href})`);
      }
    } finally {
      await session.page.close();
    }
  }
} finally {
  await browser.close();
  if (vite && !vite.killed) vite.kill("SIGTERM");
}

const out = `/opt/cursor/artifacts/analytics-pageview-${label}.json`;
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`wrote ${out}`);
console.log(JSON.stringify({
  firstLoads: report.firstLoads,
  spa: report.spa,
  dirty: report.dirty.map((row) => ({ path: row.path, leaked: row.leaked, href: row.href, sources: row.sources })),
  gtagScripts: report.gtagScripts,
  failures: report.failures,
}, null, 2));

if (expectFixed && report.failures.length > 0) process.exit(1);
