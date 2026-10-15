#!/usr/bin/env node
// Read-only driver for tradeupbot.app. Never posts to /api/subscribe and never follows Stripe.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 TradeUpBotVerify";
const CHROME = process.env.CHROME_BIN || "/usr/local/bin/google-chrome";
const STATE = process.env.VERIFY_STATE || join(tmpdir(), "verify-tradeupbot-state.json");
const PORT = Number(process.env.VERIFY_CDP_PORT || 9333);

const SEO_ROUTES = [
  "/",
  "/trade-ups",
  "/best-cs2-trade-ups",
  "/trade-ups/tiers",
  "/trade-ups/tiers/knife",
  "/trade-ups/tiers/mil-spec",
  "/trade-ups/tiers/not-a-real-tier",
  "/calculator",
  "/faq",
  "/blog",
  "/pricing",
];

const INTENT_PREFIXES = ["/best-cs2-trade-ups", "/trade-ups/tiers"];

function outDir() {
  if (process.env.VERIFY_OUT) return process.env.VERIFY_OUT;
  if (existsSync("/opt/cursor/artifacts")) return "/opt/cursor/artifacts/verify-tradeupbot";
  return join(process.cwd(), ".verify-tradeupbot-artifacts");
}

function baseUrl() {
  const arg = process.argv.find((item) => item.startsWith("--base="));
  return (arg ? arg.slice("--base=".length) : "https://tradeupbot.app").replace(/\/$/, "");
}

function command() {
  return process.argv[2] || "doctor";
}

function writeJson(name, body) {
  const dir = outDir();
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(body, null, 2) + "\n");
  return path;
}

async function fetchText(url, { ua = BROWSER_UA, redirect = "follow", method = "GET" } = {}) {
  const started = Date.now();
  const response = await fetch(url, {
    method,
    redirect,
    headers: { "user-agent": ua, accept: "text/html,application/xhtml+xml,application/json" },
  });
  const text = await response.text();
  const headers = {};
  for (const key of ["content-type", "content-security-policy", "x-frame-options", "strict-transport-security", "location", "retry-after", "server"]) {
    const value = response.headers.get(key);
    if (value) headers[key] = value.slice(0, 500);
  }
  return { url, status: response.status, headers, text, ms: Date.now() - started };
}

function titleOf(html) {
  return html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? null;
}

function canonicalOf(html) {
  return html.match(/<link\s+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1]
    ?? html.match(/<link\s+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i)?.[1]
    ?? null;
}

function hasAssetsBundle(html) {
  return /\/assets\/[^"' ]+\.js/.test(html);
}

function jsonLdTypes(html) {
  const types = new Set();
  for (const match of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1]);
      const blocks = Array.isArray(parsed) ? parsed : [parsed];
      for (const block of blocks) {
        if (block && typeof block["@type"] === "string") types.add(block["@type"]);
        if (Array.isArray(block?.["@graph"])) {
          for (const node of block["@graph"]) {
            if (typeof node?.["@type"] === "string") types.add(node["@type"]);
          }
        }
      }
    } catch {
      types.add("invalid-json");
    }
  }
  return [...types];
}

function readState() {
  try {
    return JSON.parse(readFileSync(STATE, "utf8"));
  } catch {
    return {};
  }
}

function writeState(next) {
  mkdirSync(dirname(STATE), { recursive: true });
  writeFileSync(STATE, JSON.stringify(next));
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function doctor() {
  const base = baseUrl();
  const checks = [];
  const notes = [];
  async function check(name, url, accept) {
    try {
      const result = await fetchText(url);
      const ok = accept(result);
      checks.push({ name, url, status: result.status, ms: result.ms, ok, contentType: result.headers["content-type"] ?? null });
      return result;
    } catch (error) {
      checks.push({ name, url, ok: false, error: String(error) });
      return null;
    }
  }

  const home = await check("home", `${base}/`, (result) => result.status === 200 && Boolean(titleOf(result.text)));
  await check("board", `${base}/trade-ups`, (result) => result.status === 200);
  await check("pricing", `${base}/pricing`, (result) => result.status === 200);
  const status = await check("api-status", `${base}/api/status`, (result) => result.status === 200 && (result.headers["content-type"] || "").includes("json"));
  await check("api-auth-me", `${base}/api/auth/me`, (result) => result.status === 200 && (result.headers["content-type"] || "").includes("json"));
  const missing = await check("api-unknown", `${base}/api/__pstack_missing__`, (result) => result.status === 404 && (result.headers["content-type"] || "").includes("json") && !result.text.includes("<!doctype html"));
  if (missing && !checks.find((item) => item.name === "api-unknown")?.ok) {
    notes.push({ id: "api-unknown", status: missing.status, contentType: missing.headers["content-type"] ?? null, snippet: missing.text.slice(0, 180) });
  }
  if (home) {
    const csp = [];
    notes.push({
      id: "home-headers",
      contentSecurityPolicy: home.headers["content-security-policy"] ?? null,
      xFrameOptions: home.headers["x-frame-options"] ?? null,
      strictTransportSecurity: home.headers["strict-transport-security"] ?? null,
      cspCountInBody: csp.length,
    });
  }
  if (status) notes.push({ id: "api-status-ms", ms: status.ms });

  const state = readState();
  const local = state.pid && alive(state.pid) ? { pid: state.pid, port: state.port } : null;
  const ok = checks.every((item) => item.ok);
  const path = writeJson("doctor.json", { base, ok, checks, notes, chrome: local, at: new Date().toISOString() });
  console.log(JSON.stringify({ ok, path, checks: checks.map((item) => ({ name: item.name, ok: item.ok, status: item.status, ms: item.ms })) }, null, 2));
  process.exit(ok ? 0 : 1);
}

async function crawler() {
  const base = baseUrl();
  const rows = [];
  const failures = [];
  for (const route of SEO_ROUTES) {
    const result = await fetchText(`${base}${route}`, { ua: GOOGLEBOT });
    const title = titleOf(result.text);
    const canonical = canonicalOf(result.text);
    const types = jsonLdTypes(result.text);
    const assets = hasAssetsBundle(result.text);
    const intent = INTENT_PREFIXES.some((prefix) => route === prefix || route.startsWith(`${prefix}/`));
    const row = { route, status: result.status, title, canonical, types, assets, ms: result.ms };
    rows.push(row);
    if (result.status !== 200 && route !== "/trade-ups/tiers/not-a-real-tier") failures.push(`${route} status ${result.status}`);
    if (route === "/trade-ups/tiers/not-a-real-tier") {
      row.badSlug = { status: result.status, title };
      continue;
    }
    if (!title) failures.push(`${route} missing title`);
    if (!canonical) failures.push(`${route} missing canonical`);
    if (intent && route !== "/trade-ups/tiers/not-a-real-tier") {
      if (!types.includes("FAQPage")) failures.push(`${route} missing FAQPage`);
      if (assets) failures.push(`${route} contains /assets bundle`);
    }
    if (route === "/trade-ups") {
      if (!types.includes("FAQPage")) failures.push("/trade-ups missing FAQPage");
      if (assets) failures.push("/trade-ups contains /assets bundle");
    }
    if (route === "/faq" && !types.includes("FAQPage")) {
      failures.push("/faq missing FAQPage");
    }
  }
  const ok = failures.length === 0;
  const path = writeJson("crawler.json", { base, ok, failures, rows, at: new Date().toISOString() });
  console.log(JSON.stringify({ ok, path, failures, rows: rows.map((row) => ({ route: row.route, status: row.status, types: row.types, assets: row.assets })) }, null, 2));
  process.exit(ok ? 0 : 1);
}

async function auth() {
  const base = baseUrl();
  const result = await fetchText(`${base}/auth/steam?return=/pricing`, { redirect: "manual" });
  const location = result.headers.location || "";
  const steam = /steamcommunity\.com|steampowered\.com/i.test(location);
  const ok = (result.status === 302 || result.status === 301) && steam;
  const path = writeJson("auth.json", {
    ok,
    status: result.status,
    location: location.slice(0, 300),
    followed: false,
    at: new Date().toISOString(),
  });
  console.log(JSON.stringify({ ok, path, status: result.status, steamHost: steam }, null, 2));
  process.exit(ok ? 0 : 1);
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.next = 1;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.id && this.pending.has(msg.id)) {
        const pending = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) pending.reject(new Error(JSON.stringify(msg.error)));
        else pending.resolve(msg.result);
        return;
      }
      const list = this.handlers.get(msg.method) || [];
      for (const handler of list) handler(msg);
    });
  }

  send(method, params = {}, sessionId, timeoutMs = 15000) {
    const id = this.next++;
    const payload = sessionId ? { id, method, params, sessionId } : { id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.ws.send(JSON.stringify(payload));
    });
  }

  on(method, handler) {
    const list = this.handlers.get(method) || [];
    list.push(handler);
    this.handlers.set(method, list);
  }
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function ensureChrome() {
  const state = readState();
  if (state.pid && alive(state.pid)) {
    try {
      await getJson(`http://127.0.0.1:${state.port}/json/version`);
      return state;
    } catch {
      // stale pid file
    }
  }
  const userDataDir = join(tmpdir(), `verify-tradeupbot-chrome-${process.pid}`);
  rmSync(userDataDir, { recursive: true, force: true });
  mkdirSync(userDataDir, { recursive: true });
  const proc = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-sandbox",
    "about:blank",
  ], { stdio: "ignore" });
  const next = { pid: proc.pid, port: PORT, userDataDir };
  writeState(next);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await getJson(`http://127.0.0.1:${PORT}/json/version`);
      return next;
    } catch {
      await delay(250);
    }
  }
  throw new Error(`Chrome did not open a DevTools port on ${PORT}. pid ${proc.pid}`);
}

function internalUrl(url) {
  const parsed = new URL(url);
  parsed.searchParams.set("tub_internal", "1");
  return parsed.toString();
}

const DATA_LAYER_CAPTURE = `window.__cap=[];
window.dataLayer=window.dataLayer||[];
const __tubPush=Array.prototype.push;
window.dataLayer.push=function(){
  const item=arguments[0];
  try {
    const list=item&&typeof item.length==="number"&&!Array.isArray(item)?Array.from(item):Array.from(arguments);
    window.__cap.push(list.map((value)=>value&&typeof value==="object"?JSON.parse(JSON.stringify(value)):value));
  } catch(error) { window.__cap.push(["err", String(error)]); }
  return __tubPush.apply(this, arguments);
};`;

async function connectPage(startUrl, options = {}) {
  const state = await ensureChrome();
  const version = await getJson(`http://127.0.0.1:${state.port}/json/version`);
  const browser = new Cdp(await openSocket(version.webSocketDebuggerUrl));
  const created = await browser.send("Target.createTarget", { url: "about:blank" });
  const attached = await browser.send("Target.attachToTarget", { targetId: created.targetId, flatten: true });
  const sessionId = attached.sessionId;
  await browser.send("Page.enable", {}, sessionId);
  await browser.send("Runtime.enable", {}, sessionId);
  await browser.send("Network.enable", {}, sessionId);
  await browser.send("Network.setUserAgentOverride", { userAgent: BROWSER_UA }, sessionId);
  await browser.send("Network.setBlockedURLs", {
    urls: ["*google-analytics.com*", "*analytics.google.com*", "*googletagmanager.com*"],
  }, sessionId);
  const target = internalUrl(startUrl);
  const host = new URL(target).hostname;
  await browser.send("Network.setCookie", { name: "tub_internal", value: "1", domain: host, path: "/" }, sessionId);
  if (options.captureDataLayer) {
    await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: DATA_LAYER_CAPTURE }, sessionId);
  }
  const blocked = [];
  browser.on("Fetch.requestPaused", (msg) => {
    if (msg.sessionId && msg.sessionId !== sessionId) return;
    const url = msg.params?.request?.url || "";
    blocked.push({ url, method: msg.params?.request?.method });
    browser.send("Fetch.failRequest", { requestId: msg.params.requestId, errorReason: "Aborted" }, sessionId).catch(() => {});
  });
  await browser.send("Fetch.enable", {
    patterns: [
      { urlPattern: "*stripe.com*", requestStage: "Request" },
      { urlPattern: "*/api/subscribe*", requestStage: "Request" },
    ],
  }, sessionId);
  await browser.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `window.__tubGa=[];window.gtag=function(){window.__tubGa.push(Array.from(arguments));};window.__tubPx=[];window.fbq=function(){window.__tubPx.push(Array.from(arguments));};`,
  }, sessionId);
  await browser.send("Page.navigate", { url: target }, sessionId);
  return { browser, sessionId, blocked, state, target };
}

function openSocket(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener("open", () => resolve(ws));
    ws.addEventListener("error", () => reject(new Error(`DevTools socket failed for ${url}`)));
  });
}

async function evaluate(browser, sessionId, expression) {
  const result = await browser.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  if (result.exceptionDetails) {
    const text = result.exceptionDetails.exception?.description || result.exceptionDetails.text || "eval failed";
    throw new Error(text);
  }
  return result.result?.value;
}

async function waitFor(browser, sessionId, expression, timeoutMs) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    last = await evaluate(browser, sessionId, expression);
    if (last) return last;
    await delay(400);
  }
  throw new Error(`Timed out after ${timeoutMs}ms. Last value: ${JSON.stringify(last)}`);
}

async function shot(browser, sessionId, name) {
  const dir = outDir();
  mkdirSync(dir, { recursive: true });
  const image = await browser.send("Page.captureScreenshot", { format: "png" }, sessionId);
  const path = join(dir, name);
  writeFileSync(path, Buffer.from(image.data, "base64"));
  return path;
}

async function closeTarget(browser, sessionId) {
  const info = await browser.send("Target.getTargetInfo", {}, sessionId, 5000).catch(() => null);
  if (info?.targetInfo?.targetId) {
    await browser.send("Target.closeTarget", { targetId: info.targetInfo.targetId }, 5000).catch(() => {});
  }
  try { browser.ws.close(); } catch { /* already closed */ }
}

async function board() {
  const base = baseUrl();
  const page = await connectPage(`${base}/trade-ups`);
  const failures = [];
  try {
    const loaded = await waitFor(page.browser, page.sessionId, `(() => {
      const cards = document.querySelectorAll("article.preview-card").length;
      return cards > 0 ? { cards, title: document.title, href: location.href } : null;
    })()`, 25000);
    const beforeScroll = await evaluate(page.browser, page.sessionId, "window.scrollY");
    await evaluate(page.browser, page.sessionId, "window.scrollTo(0, 1400)");
    await delay(600);
    const afterScroll = await evaluate(page.browser, page.sessionId, "({ y: window.scrollY, cards: document.querySelectorAll('article.preview-card').length })");
    if (!(afterScroll.y > beforeScroll)) failures.push("scroll did not move the board");
    await evaluate(page.browser, page.sessionId, `(() => {
      const label = [...document.querySelectorAll("label.preview-field")].find((node) => node.querySelector("span")?.textContent?.trim() === "Tier");
      const select = label?.querySelector("select");
      if (!select) throw new Error("Tier select missing");
      select.value = "covert_knife";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return select.value;
    })()`);
    const filtered = await waitFor(page.browser, page.sessionId, `location.search.includes("type=covert_knife") ? location.href : null`, 10000);
    await shot(page.browser, page.sessionId, "board-filtered.png");
    await evaluate(page.browser, page.sessionId, "location.reload()");
    const reloaded = await waitFor(page.browser, page.sessionId, `(() => {
      if (!location.search.includes("type=covert_knife")) return null;
      const label = [...document.querySelectorAll("label.preview-field")].find((node) => node.querySelector("span")?.textContent?.trim() === "Tier");
      const select = label?.querySelector("select");
      return select && select.value === "covert_knife" ? { href: location.href, tier: select.value, cards: document.querySelectorAll("article.preview-card").length } : null;
    })()`, 25000);
    await evaluate(page.browser, page.sessionId, `(() => {
      const label = [...document.querySelectorAll("label.preview-field")].find((node) => (node.textContent || "").includes("Min"));
      const input = [...document.querySelectorAll("label.preview-field")].find((node) => /Min /.test(node.querySelector("span")?.textContent || ""))?.querySelector("input");
      if (!input) throw new Error("Min profit input missing");
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, "99999");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.blur();
      return true;
    })()`);
    let empty = null;
    try {
      empty = await waitFor(page.browser, page.sessionId, `(() => {
        const text = document.body.innerText;
        if (/Too many requests/i.test(text)) return { kind: "rate_limited", text: text.slice(0, 400) };
        if (/No trade-ups match these filters/i.test(text)) return { kind: "empty_filter" };
        return null;
      })()`, 15000);
    } catch (error) {
      failures.push(`empty-filter state not observed: ${error.message}`);
    }
    if (empty?.kind === "rate_limited") failures.push("impossible filter rendered the rate-limit copy");
    const screenshot = await shot(page.browser, page.sessionId, "board-empty.png");
    const ok = failures.length === 0;
    const path = writeJson("board.json", { ok, failures, loaded, afterScroll, filtered, reloaded, empty, screenshot, blocked: page.blocked, at: new Date().toISOString() });
    console.log(JSON.stringify({ ok, path, failures, cards: loaded.cards, filtered, empty }, null, 2));
    process.exitCode = ok ? 0 : 1;
  } finally {
    await closeTarget(page.browser, page.sessionId);
  }
}

async function tradeUp() {
  const base = baseUrl();
  const list = await fetchText(`${base}/api/trade-ups?per_page=1&sort=trade_up_score&order=desc`);
  const payload = JSON.parse(list.text);
  const id = payload.trade_ups?.[0]?.id;
  if (!id) throw new Error("No trade-up id in /api/trade-ups");
  const page = await connectPage(`${base}/trade-ups/${id}`);
  try {
    const seen = await waitFor(page.browser, page.sessionId, `(() => {
      const text = document.body.innerText;
      if (!text || text.length < 40) return null;
      const hasCost = /Cost/.test(text);
      return hasCost ? { href: location.href, title: document.title, hasCost, snippet: text.slice(0, 280) } : null;
    })()`, 25000);
    const bot = await fetchText(`${base}/trade-ups/${id}`, { ua: GOOGLEBOT });
    const screenshot = await shot(page.browser, page.sessionId, "trade-up.png");
    const ok = Boolean(seen?.hasCost) && bot.status === 200 && Boolean(titleOf(bot.text)) && Boolean(canonicalOf(bot.text));
    const path = writeJson("trade-up.json", {
      ok,
      id,
      seen,
      screenshot,
      bot: { status: bot.status, title: titleOf(bot.text), canonical: canonicalOf(bot.text), types: jsonLdTypes(bot.text), assets: hasAssetsBundle(bot.text) },
      at: new Date().toISOString(),
    });
    console.log(JSON.stringify({ ok, path, id, botStatus: bot.status }, null, 2));
    process.exitCode = ok ? 0 : 1;
  } finally {
    await closeTarget(page.browser, page.sessionId);
  }
}

async function pricing() {
  const base = baseUrl();
  const page = await connectPage(`${base}/pricing`);
  const failures = [];
  try {
    const button = await waitFor(page.browser, page.sessionId, `(() => {
      const node = [...document.querySelectorAll("button")].find((item) => /Go Pro|Current plan|Checking/.test(item.textContent || ""));
      if (!node) return null;
      const label = (node.textContent || "").trim();
      if (label === "Checking…") return null;
      return { label, disabled: node.disabled };
    })()`, 20000);
    if (button.label !== "Go Pro") failures.push(`expected Go Pro for a signed-out session, got ${button.label}`);
    const eventsBefore = await evaluate(page.browser, page.sessionId, "window.__tubGa");
    await evaluate(page.browser, page.sessionId, `(() => {
      const node = [...document.querySelectorAll("button")].find((item) => (item.textContent || "").trim() === "Go Pro");
      if (!node) throw new Error("Go Pro missing");
      node.click();
      return true;
    })()`);
    const dialog = await waitFor(page.browser, page.sessionId, `(() => {
      const link = [...document.querySelectorAll("a")].find((item) => (item.textContent || "").includes("Continue with Steam"));
      if (!link) return null;
      return { href: link.getAttribute("href"), text: link.textContent.trim() };
    })()`, 10000);
    await delay(500);
    const eventsAfter = await evaluate(page.browser, page.sessionId, "({ ga: window.__tubGa, px: window.__tubPx, href: location.href })");
    const began = JSON.stringify(eventsAfter.ga).includes("begin_checkout");
    const pixelCheckout = JSON.stringify(eventsAfter.px).includes("InitiateCheckout");
    if (began) failures.push("begin_checkout fired before /api/subscribe");
    if (pixelCheckout) failures.push("Meta InitiateCheckout fired");
    if (/stripe\.com/.test(eventsAfter.href)) failures.push("page navigated to Stripe");
    if (!dialog.href?.includes("/auth/steam")) failures.push(`Steam continue href was ${dialog.href}`);
    if (page.blocked.length > 0) failures.push(`blocked unexpected request ${page.blocked[0].url}`);
    const screenshot = await shot(page.browser, page.sessionId, "pricing-steam.png");
    const ok = failures.length === 0;
    const path = writeJson("pricing.json", { ok, failures, button, eventsBefore, dialog, eventsAfter, screenshot, blocked: page.blocked, at: new Date().toISOString() });
    console.log(JSON.stringify({ ok, path, failures, dialog }, null, 2));
    process.exitCode = ok ? 0 : 1;
  } finally {
    await closeTarget(page.browser, page.sessionId);
  }
}

async function analytics() {
  const base = baseUrl();
  const home = await fetchText(`${base}/`, { ua: BROWSER_UA });
  const ids = [...home.text.matchAll(/G-[A-Z0-9]+/g)].map((match) => match[1]);
  const uniqueIds = [...new Set(ids)];
  const pixel = /fbq\(\s*['"]init['"]/.test(home.text) || /connect\.facebook\.net/.test(home.text);
  const assetSrc = home.text.match(/\/assets\/[^"' ]+\.js/)?.[0] ?? null;
  let bundle = { claim: false, verify: false, begin: false };
  if (assetSrc) {
    const js = await fetchText(`${base}${assetSrc}`, { ua: BROWSER_UA });
    bundle = {
      src: assetSrc,
      claim: js.text.includes("claim_trade_up"),
      verify: js.text.includes("verify_complete"),
      begin: js.text.includes("begin_checkout"),
    };
  }
  const failures = [];
  if (!uniqueIds.includes("G-2474G4P5QE") && !home.text.includes("G-2474G4P5QE")) {
    // The property id may be injected as tubTracking rather than a second gtag config.
  }
  const tub = home.text.match(/tubTracking=(\{[^<]+\})/)?.[1] ?? null;
  if (pixel) failures.push("Meta Pixel snippet is present");
  if (!bundle.claim || !bundle.verify || !bundle.begin) failures.push("bundle is missing claim_trade_up, verify_complete, or begin_checkout");
  const page = await connectPage(`${base}/pricing`);
  try {
    await waitFor(page.browser, page.sessionId, `(() => {
      const node = [...document.querySelectorAll("button")].find((item) => /Go Pro|Current plan/.test(item.textContent || ""));
      return node && !/Checking/.test(node.textContent || "") ? true : null;
    })()`, 20000);
    await evaluate(page.browser, page.sessionId, `(() => { const node = [...document.querySelectorAll("button")].find((item) => (item.textContent || "").includes("Go Pro")); node?.click(); return true; })()`);
    await delay(800);
    const events = await evaluate(page.browser, page.sessionId, "({ ga: window.__tubGa, px: window.__tubPx, href: location.href })");
    if (JSON.stringify(events.ga).includes("begin_checkout")) failures.push("begin_checkout fired without a 2xx subscribe");
    if (JSON.stringify(events.px).includes("InitiateCheckout") || JSON.stringify(events.px).includes("PageView") && pixel) {
      failures.push("pixel event recorded while Meta must stay a no-op");
    }
    const ok = failures.length === 0;
    const path = writeJson("analytics.json", { ok, failures, uniqueIds, tub, pixel, bundle, events, blocked: page.blocked, at: new Date().toISOString() });
    console.log(JSON.stringify({ ok, path, failures, uniqueIds, pixel, bundle }, null, 2));
    process.exitCode = ok ? 0 : 1;
  } finally {
    await closeTarget(page.browser, page.sessionId);
  }
}

function cleanup() {
  const state = readState();
  let killed = null;
  if (state.pid && alive(state.pid)) {
    process.kill(state.pid, "SIGTERM");
    killed = state.pid;
  }
  if (state.userDataDir) rmSync(state.userDataDir, { recursive: true, force: true });
  rmSync(STATE, { force: true });
  const evidence = outDir();
  console.log(JSON.stringify({ killed, evidenceKept: evidence, evidenceExists: existsSync(evidence) }, null, 2));
}

function countEvents(cap, name) {
  return (cap || []).filter((row) => Array.isArray(row) && row[0] === "event" && row[1] === name).length;
}

async function signup() {
  const base = baseUrl();
  const page = await connectPage(`${base}/?auth=new`, { captureDataLayer: true });
  const failures = [];
  try {
    const first = await waitFor(page.browser, page.sessionId, `(() => {
      const cap = window.__cap || [];
      const hit = cap.some((row) => Array.isArray(row) && row[0] === "event" && row[1] === "sign_up");
      return hit ? { href: location.href, cap } : null;
    })()`, 15000);
    const me = await evaluate(page.browser, page.sessionId, `fetch("/api/auth/me", { credentials: "include" }).then((res) => res.json())`);
    const newAccount = me && typeof me === "object" && (me.new_account === true || me.auth === "new");
    if (!newAccount) failures.push("sign_up fired without a server-consumed new-account flag on /api/auth/me");
    if (countEvents(first.cap, "sign_up") !== 1) failures.push(`expected one sign_up on auth=new, saw ${countEvents(first.cap, "sign_up")}`);
    await page.browser.send("Page.navigate", { url: internalUrl(`${base}/`) }, page.sessionId);
    await delay(2500);
    const second = await evaluate(page.browser, page.sessionId, "({ href: location.href, cap: window.__cap || [] })");
    if (countEvents(second.cap, "sign_up") !== 0) failures.push("a reload without auth=new fired sign_up");
    await page.browser.send("Page.navigate", { url: internalUrl(`${base}/?auth=return`) }, page.sessionId);
    const returned = await waitFor(page.browser, page.sessionId, `(() => {
      const cap = window.__cap || [];
      const login = cap.some((row) => Array.isArray(row) && row[0] === "event" && row[1] === "login");
      return login ? { href: location.href, cap } : null;
    })()`, 15000);
    if (countEvents(returned.cap, "sign_up") !== 0) failures.push("auth=return also fired sign_up");
    const ok = failures.length === 0;
    const path = writeJson("signup.json", {
      ok,
      failures,
      me,
      first: { href: first.href, signUp: countEvents(first.cap, "sign_up") },
      second: { href: second.href, signUp: countEvents(second.cap, "sign_up") },
      returned: { href: returned.href, signUp: countEvents(returned.cap, "sign_up"), login: countEvents(returned.cap, "login") },
      blockedAnalytics: true,
      at: new Date().toISOString(),
    });
    console.log(JSON.stringify({ ok, path, failures, me }, null, 2));
    process.exitCode = ok ? 0 : 1;
  } finally {
    await closeTarget(page.browser, page.sessionId);
  }
}

async function timedGet(url, ua) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": ua, accept: "text/html,application/json" },
    });
    const text = await response.text();
    return {
      url,
      status: response.status,
      ms: Date.now() - started,
      contentType: response.headers.get("content-type"),
      robots: response.headers.get("x-robots-tag"),
      canonical: canonicalOf(text),
      title: titleOf(text),
      aborted: false,
    };
  } catch (error) {
    return { url, status: null, ms: Date.now() - started, aborted: true, error: String(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function ids() {
  const base = baseUrl();
  const probes = [
    ["api-abc", `${base}/api/trade-ups/abc`, BROWSER_UA],
    ["api-overflow", `${base}/api/trade-ups/2147483648`, BROWSER_UA],
    ["api-wide", `${base}/api/trade-ups/999999999999`, BROWSER_UA],
    ["bot-abc", `${base}/trade-ups/abc`, GOOGLEBOT],
    ["bot-overflow", `${base}/trade-ups/2147483648`, GOOGLEBOT],
    ["bot-wide", `${base}/trade-ups/999999999999`, GOOGLEBOT],
  ];
  const rows = [];
  const failures = [];
  for (const [name, url, ua] of probes) {
    const row = { name, ...(await timedGet(url, ua)) };
    rows.push(row);
    const fast404 = row.status === 404 && row.ms < 8000 && !row.aborted;
    if (!fast404) failures.push(`${name} status ${row.status ?? "abort"} in ${row.ms}ms`);
    if (name.startsWith("bot-") && row.canonical === "https://tradeupbot.app/") {
      failures.push(`${name} canonical is the homepage`);
    }
  }
  const ok = failures.length === 0;
  const path = writeJson("ids.json", { ok, failures, rows, at: new Date().toISOString() });
  console.log(JSON.stringify({ ok, path, failures, rows: rows.map((row) => ({ name: row.name, status: row.status, ms: row.ms, canonical: row.canonical ?? null, aborted: row.aborted })) }, null, 2));
  process.exit(ok ? 0 : 1);
}

const commands = { doctor, crawler, auth, board, "trade-up": tradeUp, pricing, analytics, signup, ids, cleanup };

const fn = commands[command()];
if (!fn) {
  console.error(`Unknown command ${command()}. Use doctor, crawler, board, trade-up, pricing, auth, analytics, signup, ids, or cleanup.`);
  process.exit(2);
}
await fn();
