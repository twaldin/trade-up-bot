// Records real footage + screenshots of the live public site and writes every
// figure that appears on screen to public/captures/facts.json.
//
//   node capture/capture.mjs                 # all takes
//   node capture/capture.mjs --only=d-board  # re-record specific takes (merges)
//
// Public API budget is ~120 req/min/IP: takes are spaced out and any take
// that sees a 429 is discarded and retried after a cool-down.
import { chromium, devices } from "playwright";
import fs from "node:fs";
import path from "node:path";
import {
  BLUR_INIT_SCRIPT, sleep, startRecording, moveMouse, centerOf, smoothScrollTo, smoothScrollBy, scrollTopInstant,
} from "./lib.mjs";

const BASE = "https://tradeupbot.app";
const OUT = path.resolve(new URL("../public/captures/", import.meta.url).pathname);
const FACTS = path.join(OUT, "facts.json");
const GAP_MS = 20000;
const COOLDOWN_MS = 70000;
fs.mkdirSync(OUT, { recursive: true });

const only = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7).split(",").filter(Boolean);
const facts = fs.existsSync(FACTS) ? JSON.parse(fs.readFileSync(FACTS, "utf8")) : { base: BASE, takes: {} };

// The screencast only delivers device-pixel frames when the browser itself runs
// at that scale, so each device class gets its own browser with a forced DSF.
const DEVICES = {
  desktop: {
    launch: ["--force-device-scale-factor=2", "--window-size=1600,1100"],
    context: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark" },
    screencast: { maxWidth: 2880, maxHeight: 1800 },
  },
  mobile: {
    launch: ["--force-device-scale-factor=3", "--window-size=600,1000"],
    context: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, colorScheme: "dark" },
    screencast: { maxWidth: 1170, maxHeight: 2532 },
  },
};

const txt = (s) => (s ?? "").replace(/\s+/g, " ").trim();

async function settle(page, ms = 2500) {
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await sleep(ms);
}

/** Screenshot of an element as it appears in the viewport (overlay blur included). */
async function shot(page, take, locator, name, pad = 0) {
  await locator.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
  await sleep(600);
  const b = await locator.boundingBox();
  const vp = page.viewportSize();
  const x = Math.max(0, b.x - pad);
  const y = Math.max(0, b.y - pad);
  const clip = { x, y, width: Math.min(vp.width - x, b.width + pad * 2), height: Math.min(vp.height - y, b.height + pad * 2) };
  const file = `${take.id}--${name}.png`;
  await page.screenshot({ path: path.join(OUT, file), clip });
  take.screenshots[name] = { file, cssWidth: Math.round(clip.width), cssHeight: Math.round(clip.height) };
}

async function viewportShot(page, take, name) {
  await sleep(500);
  const file = `${take.id}--${name}.png`;
  await page.screenshot({ path: path.join(OUT, file) });
  take.screenshots[name] = { file, cssWidth: page.viewportSize().width, cssHeight: page.viewportSize().height };
}

async function pointAt(page, rec, ptr, device, locator, { click = false, ms = 700 } = {}) {
  const c = await centerOf(locator);
  if (device === "desktop") {
    await moveMouse(page, rec, ptr, c.x, c.y, ms);
    await sleep(250);
    if (click) {
      rec.log({ type: "click", x: c.x, y: c.y });
      await page.mouse.click(c.x, c.y);
    }
  } else if (click) {
    rec.log({ type: "tap", x: c.x, y: c.y });
    await page.touchscreen.tap(c.x, c.y);
  }
  return c;
}

function boardCardFacts(card) {
  return card.evaluate((c) => {
    const t = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim() || null;
    return {
      skins: [...c.querySelectorAll(".preview-skin")].map((s) => ({
        kind: s.classList.contains("preview-skin--output") ? "output" : "input",
        price: t(s.querySelector(".preview-skin__lead")),
        float: t(s.querySelector(".preview-skin__float")),
        wear: t(s.querySelector(".preview-skin__wear")),
        weapon: t(s.querySelector(".preview-skin__label em")),
        name: t(s.querySelector(".preview-skin__label b")),
        delta: t(s.querySelector(".preview-skin__delta")),
        skinHref: s.querySelector(".preview-skin__label")?.getAttribute("href") ?? null,
        raw: s.innerText.replace(/\s+/g, " ").trim(),
      })),
      readouts: [...c.querySelectorAll(".preview-readout")].map((r) => ({
        label: t(r.querySelector("em")), value: t(r.querySelector("b")), note: t(r.querySelector("small")),
      })),
      cardline: t(c.querySelector(".preview-cardline")),
      verifyHref: [...c.querySelectorAll("a")].find((a) => /Verify \/ Claim/.test(a.textContent))?.href ?? null,
      text: c.innerText,
    };
  });
}

// ---------------------------------------------------------------- takes

const TAKES = [];
const take = (id, device, url, run, after) => TAKES.push({ id, device, url, run, after });

for (const device of ["desktop", "mobile"]) {
  const p = device === "desktop" ? "d" : "m";
  const mobile = device === "mobile";

  take(`${p}-home`, device, "/", async ({ page, rec, t }) => {
    await sleep(2200);
    rec.mark("hero");
    await rec.rect("hero-h1", page.locator("h1").first());
    const wyg = page.getByText("What you see is what you pay").first();
    await smoothScrollTo(page, wyg, "start", 1800);
    rec.mark("what-you-get");
    await sleep(2000);
    const verifyCopy = page.getByText("Verify re-checks every input", { exact: false }).first();
    await smoothScrollTo(page, verifyCopy, "center", 1600);
    rec.mark("verify-copy");
    await rec.rect("verify-card", verifyCopy.locator("xpath=.."));
    await sleep(2400);
    t.facts.hero = await page.evaluate(() => {
      const h1 = document.querySelector("h1");
      return { h1: h1?.textContent?.trim(), block: (h1?.parentElement?.innerText ?? "").slice(0, 1200) };
    });
    t.facts.verifyCopy = txt(await verifyCopy.textContent());
  }, async ({ page, t }) => {
    const verifyCopy = page.getByText("Verify re-checks every input", { exact: false }).first();
    await shot(page, t, verifyCopy.locator("xpath=../.."), "what-you-get", 12);
    await scrollTopInstant(page);
    await viewportShot(page, t, "hero");
  });

  take(`${p}-board`, device, "/trade-ups", async ({ page, rec, ctx, ptr, t }) => {
    await sleep(1800);
    rec.mark("board");
    const card = page.locator("article.preview-card").first();
    const line = card.locator(".preview-cardline");
    if (mobile) {
      await smoothScrollTo(page, card, "start", 1500);
      rec.mark("card-in-view");
      await rec.rect("card", card);
      await sleep(900);
    }
    await pointAt(page, rec, ptr, device, line, { click: true, ms: 900 });
    rec.mark("expanded");
    await sleep(1600);
    await rec.rect("flow", card.locator(".preview-flow").first());
    await rec.rect("outputs", card.locator(".preview-flow__side").nth(1));
    await rec.rect("inputs", card.locator(".preview-flow__side").nth(0));
    const out0 = card.locator(".preview-skin--output").first();
    await rec.rect("output0", out0);
    Object.assign(t.facts, await boardCardFacts(card));
    await pointAt(page, rec, ptr, device, out0.locator(".preview-skin__float"), { ms: 800 });
    rec.mark("output-float");
    await sleep(2400);
    const readouts = card.locator(".preview-readouts");
    await smoothScrollTo(page, readouts, "center", 1600);
    await rec.rect("readouts", readouts);
    await pointAt(page, rec, ptr, device, readouts.locator(".preview-readout").nth(1), { ms: 700 });
    rec.mark("readouts");
    await sleep(2600);
    const listings = card.locator(".preview-expand__listings");
    await smoothScrollTo(page, listings, mobile ? "start" : "center", 1700);
    await rec.rect("listings", listings);
    rec.mark("listings");
    await pointAt(page, rec, ptr, device, listings.locator(".preview-listing").nth(4), { ms: 800 });
    await sleep(2200);
    const verify = card.getByRole("link", { name: /Verify \/ Claim trade-up/ });
    await smoothScrollTo(page, verify, "center", 1500);
    await rec.rect("verify", verify);
    await rec.rect("listings-at-verify", listings);
    await pointAt(page, rec, ptr, device, verify, { ms: 700 });
    rec.mark("verify-button");
    await sleep(1300);
    const popupP = ctx.waitForEvent("page", { timeout: 8000 }).catch(() => null);
    await pointAt(page, rec, ptr, device, verify, { click: true, ms: 200 });
    rec.mark("verify-click");
    const popup = await popupP;
    await sleep(1400);
    if (popup) await popup.close();
  }, async ({ page, t }) => {
    const card = page.locator("article.preview-card").first();
    await shot(page, t, card.locator(".preview-flow").first(), "flow", 8);
    await shot(page, t, card.locator(".preview-flow__side").nth(1), "outputs", 8);
    await shot(page, t, card.locator(".preview-skin--output").first(), "output0", 6);
    await shot(page, t, card.locator(".preview-readouts"), "readouts", 8);
    const listings = card.locator(".preview-expand__listings");
    await shot(page, t, listings, "listings", 8);
    t.facts.listingsText = await listings.innerText();
    t.facts.listings = await listings.evaluate((el) => [...el.querySelectorAll(".preview-listing")].map((a) => ({
      n: a.querySelector(".preview-listing__n")?.textContent.trim(),
      name: a.querySelector(".preview-listing__name")?.innerText.replace(/\s+/g, " ").trim(),
      market: a.querySelector(".preview-chip")?.textContent.trim(),
      float: a.querySelector(".preview-listing__float")?.textContent.trim(),
      price: a.querySelector(".preview-listing__price")?.textContent.trim(),
      href: a.getAttribute("href"),
    })));
  });

  take(`${p}-tradeup`, device, null, async ({ page, rec, ptr, t }) => {
    await sleep(2000);
    rec.mark("page");
    t.facts.title = txt(await page.locator("h1").first().textContent());
    const signin = page.getByText(/Verify[^.]*Pro/).first();
    t.facts.signinBanner = txt(await signin.textContent());
    await rec.rect("title", page.locator("h1").first());
    await rec.rect("signin", signin.locator("xpath=.."));
    await pointAt(page, rec, ptr, device, page.getByRole("link", { name: /Sign in with Steam/ }).first(), { ms: 900 });
    rec.mark("signin");
    await sleep(2600);
    const readouts = page.locator(".preview-readouts").first();
    await smoothScrollTo(page, readouts, "center", 1700);
    await rec.rect("readouts", readouts);
    rec.mark("scrolled");
    await sleep(2200);
  }, async ({ page, t }) => {
    await scrollTopInstant(page);
    await viewportShot(page, t, "top");
    await shot(page, t, page.getByText(/Verify[^.]*Pro/).first().locator("xpath=.."), "signin", 6);
  });

  take(`${p}-calculator`, device, "/calculator", async ({ page, rec, ptr, t }) => {
    await sleep(1600);
    rec.mark("empty");
    await pointAt(page, rec, ptr, device, page.getByRole("button", { name: /load example/i }), { click: true, ms: 900 });
    rec.mark("loaded");
    await sleep(2200);
    await rec.rect("inputs", page.getByText("Inputs", { exact: true }).first().locator("xpath=../.."));
    await pointAt(page, rec, ptr, device, page.getByRole("button", { name: /^evaluate$/i }), { click: true, ms: 700 });
    rec.mark("evaluate");
    await page.waitForFunction(() => !/Evaluating/.test(document.body.innerText) && /Expected value/.test(document.body.innerText), null, { timeout: 60000 });
    rec.mark("result");
    await sleep(800);
    const ev = page.getByText("Expected value", { exact: true }).first();
    await smoothScrollTo(page, ev, "center", 1500);
    await rec.rect("result", ev.locator("xpath=../.."));
    await pointAt(page, rec, ptr, device, page.getByText("Profit", { exact: true }).first(), { ms: 700 });
    rec.mark("result-in-view");
    await sleep(2800);
    t.facts.text = await page.locator("main").innerText();
    const lines = t.facts.text.split("\n").map((s) => s.trim()).filter(Boolean);
    const after = (label) => lines[lines.indexOf(label) + 1] ?? null;
    t.facts.result = { cost: after("Cost"), expectedValue: after("Expected value"), profit: after("Profit") };
  }, async ({ page, t }) => {
    const ev = page.getByText("Expected value", { exact: true }).first();
    await shot(page, t, ev.locator("xpath=../.."), "result", 8);
    await viewportShot(page, t, "viewport");
  });

  take(`${p}-skins`, device, "/skins", async ({ page, rec, ptr, t }) => {
    const board = facts.takes[`${p}-board`]?.facts;
    const out = board?.skins?.find((s) => s.kind === "output");
    const slug = out?.skinHref ?? "/skins/ak-47-nightwish";
    const query = out?.name ?? "Nightwish";
    t.facts.skinSlug = slug;
    await sleep(1800);
    rec.mark("grid");
    await smoothScrollBy(page, mobile ? 900 : 500, 1500);
    await smoothScrollTo(page, 0, "start", 1200);
    const search = page.getByPlaceholder(/Search skins/i).first();
    await pointAt(page, rec, ptr, device, search, { click: true, ms: 800 });
    await search.pressSequentially(query, { delay: 140 });
    rec.mark("searched");
    await sleep(2600);
    const tile = page.locator(`a[href="${slug}"]`).first();
    if (await tile.count()) await pointAt(page, rec, ptr, device, tile, { click: true, ms: 800 });
    const chartTitle = page.getByText("Float against price", { exact: true }).first();
    const rendered = await chartTitle.waitFor({ timeout: 7000 }).then(() => true).catch(() => false);
    if (!rendered) {
      t.facts.detailNote = "SPA click did not render the detail view; loaded the skin URL directly.";
      await page.goto(BASE + slug, { waitUntil: "domcontentloaded" });
      await chartTitle.waitFor({ timeout: 30000 });
    }
    await settle(page, 2200);
    rec.mark("detail");
    await rec.rect("price-by-condition", page.getByText("Price by condition", { exact: true }).first().locator("xpath=../.."));
    t.facts.detailUrl = page.url();
    t.facts.detailText = (await page.locator("main").innerText()).slice(0, 2500);
    await sleep(1400);
    const chart = chartTitle.locator("xpath=../..");
    await smoothScrollTo(page, chart, "center", 1700);
    await rec.rect("chart", chart);
    rec.mark("chart");
    await sleep(3200);
    const live = page.getByText("Live listings", { exact: true }).first();
    await smoothScrollTo(page, live, "start", 1700);
    await rec.rect("live-listings", live.locator("xpath=../.."));
    rec.mark("live-listings");
    await sleep(2200);
  }, async ({ page, t }) => {
    await shot(page, t, page.getByText("Float against price", { exact: true }).first().locator("xpath=../.."), "chart", 8);
    await shot(page, t, page.getByText("Price by condition", { exact: true }).first().locator("xpath=../.."), "price-by-condition", 8);
    await scrollTopInstant(page);
    await viewportShot(page, t, "detail-top");
  });

  take(`${p}-faq`, device, "/faq", async ({ page, rec, ptr, t }) => {
    await sleep(1600);
    rec.mark("faq");
    const q = page.getByText("What marketplace fees does TradeUpBot account for?", { exact: true }).first();
    await smoothScrollTo(page, q, mobile ? "start" : "center", 1600);
    await pointAt(page, rec, ptr, device, q, { click: true, ms: 800 });
    rec.mark("fees-open");
    await sleep(900);
    const ans = page.getByText("TradeUpBot applies each marketplace", { exact: false }).first();
    await rec.rect("fee-question", q);
    await rec.rect("fee-answer", ans);
    await sleep(3000);
    t.facts.feeAnswer = txt(await ans.textContent());
    t.facts.feeQuestion = txt(await q.textContent());
  }, async ({ page, t }) => {
    const ans = page.getByText("TradeUpBot applies each marketplace", { exact: false }).first();
    await shot(page, t, ans.locator("xpath=.."), "fee-answer", 10);
  });

  take(`${p}-pricing`, device, "/pricing", async ({ page, rec, ptr, t }) => {
    await sleep(1600);
    rec.mark("pricing");
    const readPro = () => page.evaluate(() => {
      const heads = [...document.querySelectorAll("h2,h3,h4,p,span,div")].filter((e) => e.childElementCount === 0 && e.textContent.trim() === "Pro");
      for (const h of heads) {
        const card = h.closest("div")?.parentElement;
        const m = card?.innerText.match(/\$\d+(?:\.\d{2})?(?:\s*\/\s*\w+)?/);
        if (m) return { price: m[0], card: card.innerText.slice(0, 600) };
      }
      return null;
    });
    const pro = page.getByText("Pro", { exact: true }).first();
    await rec.rect("pro", pro.locator("xpath=../.."));
    await pointAt(page, rec, ptr, device, pro, { ms: 900 });
    t.facts.monthly = await readPro();
    rec.mark("monthly");
    await sleep(2200);
    for (const [label, key] of [[/^Yearly/, "yearly"], [/^Lifetime/, "lifetime"], [/^Monthly/, "monthlyAgain"]]) {
      const btn = page.getByRole("button", { name: label }).first();
      if (!(await btn.count())) continue;
      await pointAt(page, rec, ptr, device, btn, { click: true, ms: 700 });
      rec.mark(key);
      await sleep(1600);
      t.facts[key] = await readPro();
    }
    t.facts.text = (await page.locator("body").innerText()).slice(0, 5000);
  }, async ({ page, t }) => {
    const cancel = page.getByText("Can I cancel anytime?", { exact: true }).first();
    if (await cancel.count()) {
      await cancel.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await cancel.click();
      await sleep(900);
      t.facts.cancelAnswer = txt(await cancel.locator("xpath=../..").innerText());
    }
    await scrollTopInstant(page);
    await viewportShot(page, t, "top");
    await shot(page, t, page.getByText("Pro", { exact: true }).first().locator("xpath=../.."), "pro-card", 8);
  });
}

// ---------------------------------------------------------------- runner

async function runTake(browser, def) {
  const dev = DEVICES[def.device];
  const ctx = await browser.newContext(dev.context);
  await ctx.addInitScript(BLUR_INIT_SCRIPT);
  const page = await ctx.newPage();
  const stats = { api: 0, r429: 0 };
  ctx.on("response", (r) => {
    if (!r.url().includes("/api/")) return;
    stats.api++;
    if (r.status() === 429) stats.r429++;
  });
  let url = def.url;
  if (!url) {
    const boardId = def.id.replace("-tradeup", "-board");
    url = facts.takes[boardId]?.facts?.verifyHref;
    if (!url) throw new Error(`${def.id}: no trade-up URL from ${boardId}`);
  } else {
    url = BASE + url;
  }
  const t = {
    id: def.id, device: def.device, url, viewport: dev.context.viewport, dpr: dev.context.deviceScaleFactor,
    capturedAt: new Date().toISOString(), screenshots: {}, facts: {},
  };
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await settle(page, 3000);
  const ptr = { x: Math.round(t.viewport.width * 0.62), y: Math.round(t.viewport.height * 0.55) };
  if (def.device === "desktop") await page.mouse.move(ptr.x, ptr.y);
  const rec = await startRecording(page, { id: def.id, outDir: OUT, ...dev.screencast });
  try {
    await def.run({ page, ctx, rec, ptr, t });
    await sleep(600);
  } finally {
    Object.assign(t, await rec.stop());
  }
  t.events = rec.events;
  t.markers = rec.markers;
  t.rects = rec.rects;
  if (def.after) await def.after({ page, t });
  t.api = stats;
  await ctx.close();
  return { t, stats };
}

const browsers = {};
const browserFor = async (device) =>
  (browsers[device] ??= await chromium.launch({ channel: "chromium", args: DEVICES[device].launch }));
const todo = TAKES.filter((d) => only.length === 0 || only.includes(d.id));
for (let i = 0; i < todo.length; i++) {
  const def = todo[i];
  const browser = await browserFor(def.device);
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`[${new Date().toISOString()}] take ${def.id} (attempt ${attempt})`);
    try {
      const { t, stats } = await runTake(browser, def);
      console.log(`  api=${stats.api} 429=${stats.r429} duration=${t.duration}s frames=${t.frames} ${t.width}x${t.height}`);
      if (stats.r429 > 0) {
        console.log(`  got 429 — cooling down ${COOLDOWN_MS / 1000}s and retrying`);
        await sleep(COOLDOWN_MS);
        continue;
      }
      facts.takes[def.id] = t;
      facts.capturedAt = new Date().toISOString();
      fs.writeFileSync(FACTS, JSON.stringify(facts, null, 2));
      break;
    } catch (e) {
      console.log(`  failed: ${e.message.split("\n")[0]}`);
      await sleep(COOLDOWN_MS / 2);
    }
  }
  if (i < todo.length - 1) await sleep(GAP_MS);
}
for (const b of Object.values(browsers)) await b.close();
console.log("done");
