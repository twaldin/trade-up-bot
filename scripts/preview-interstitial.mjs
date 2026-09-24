/**
 * Drives the Steam interstitial on /pricing and /trade-ups/:id in a real browser.
 * Asserts the Continue href, dismiss paths, focus return, GA4 events, and 390px layout.
 * Logged-in states are simulated by intercepting /api/auth/me (and /api/subscribe so no
 * checkout is ever created). Exits non-zero with INTERSTITIAL QA FAIL on any failure.
 *
 *   QA_OUT=/opt/cursor/artifacts/screenshots node scripts/preview-interstitial.mjs
 */
import puppeteer from "puppeteer";
import { mkdirSync } from "node:fs";

const BASE = process.env.QA_BASE ?? "http://127.0.0.1:5173";
const OUT = process.env.QA_OUT ?? "/tmp/preview-interstitial";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${message}`);
  if (!ok) failures.push(message);
};

const USERS = {
  free: { steam_id: "76561190000000001", display_name: "QA Free", avatar_url: "", tier: "free", is_admin: false, lifetime: false },
  pro: { steam_id: "76561190000000002", display_name: "QA Pro", avatar_url: "", tier: "pro", is_admin: false, lifetime: false },
  lifetime: { steam_id: "76561190000000003", display_name: "QA Lifetime", avatar_url: "", tier: "pro", is_admin: false, lifetime: true },
};

async function sharePath() {
  const res = await fetch(`${BASE}/api/trade-ups?sort=profit&order=desc&per_page=1&page=1`).catch(() => null);
  const data = res?.ok ? await res.json().catch(() => null) : null;
  const id = data?.trade_ups?.[0]?.id;
  return id ? `/trade-ups/${id}` : "/trade-ups/776913115";
}

const browser = await puppeteer.launch({
  headless: "new",
  protocolTimeout: 240000,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

/** Open a page as a given session: null = logged out, or a USERS key. */
async function openPage(path, { user = null, width = 1280, height = 900, mode = "dark", ref = null } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width, height });
  await page.setRequestInterception(true);
  const subscribeCalls = [];
  const portalCalls = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (/googletagmanager\.com|google-analytics\.com/.test(url.hostname)) {
      req.abort();
    } else if (url.pathname === "/api/auth/me") {
      req.respond({ status: 200, contentType: "application/json", body: JSON.stringify(user ? USERS[user] : null) });
    } else if (url.pathname === "/api/subscribe") {
      subscribeCalls.push(req.postData());
      // No url: the page stays put so the test can read begin_checkout and the modal state.
      req.respond({ status: 200, contentType: "application/json", body: "{}" });
    } else if (url.pathname === "/api/billing-portal") {
      portalCalls.push(req.method());
      req.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ url: `${BASE}/qa-portal-stub` }) });
    } else if (url.pathname.startsWith("/auth/steam")) {
      req.respond({ status: 200, contentType: "text/html", body: "<p>steam stub</p>" });
    } else {
      req.continue();
    }
  });
  await page.evaluateOnNewDocument((storedRef) => {
    if (storedRef) localStorage.setItem("tub_ref", storedRef);
  }, ref);
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle2", timeout: 90000 });
  if (mode === "light") {
    await page.evaluate(() => {
      const toggle = [...document.querySelectorAll(".preview-bar__actions button")].find((b) => b.textContent?.trim() === "Light");
      toggle?.click();
    });
    await sleep(200);
  }
  return { page, subscribeCalls, portalCalls };
}

/** GA4 events as index.html's gtag() queued them in dataLayer (gtag.js itself is blocked). */
const events = (page) => page.evaluate(() => (window.dataLayer ?? [])
  .filter((entry) => entry[0] === "event" && entry[1] !== "page_view")
  .map((entry) => [entry[1], entry[2]]));
const dialogOpen = (page) => page.evaluate(() => !!document.querySelector("dialog.preview-sheet[open]"));
const continueHref = (page) => page.$eval("dialog.preview-sheet .preview-sheet__go", (a) => a.getAttribute("href"));
const clickGoPro = (page) => page.evaluate(() => {
  const btn = [...document.querySelectorAll(".preview-plan--pro button")].find((b) => b.textContent?.trim() === "Go Pro");
  btn?.click();
  return !!btn;
});
const selectTab = (page, index) => page.evaluate((i) => document.querySelectorAll(".preview-tabs [role=tab]")[i].click(), index);

try {
  // ------------------------------------------------------------ /pricing logged out
  {
    const { page } = await openPage("/pricing");
    check(await clickGoPro(page), "pricing: Go Pro button present when logged out");
    await sleep(300);
    check(await dialogOpen(page), "pricing: Go Pro opens the modal");
    check(new URL(page.url()).pathname === "/pricing", "pricing: Go Pro does not navigate");
    check(await continueHref(page) === "/auth/steam?return=%2Fpricing", `pricing: Continue href is /auth/steam?return=%2Fpricing (got ${await continueHref(page)})`);
    const focus = await page.evaluate(() => document.activeElement?.classList.contains("preview-sheet__go"));
    check(focus, "pricing: initial focus is Continue with Steam");
    const aria = await page.$eval("dialog.preview-sheet", (d) => ({
      role: d.getAttribute("role"),
      modal: d.getAttribute("aria-modal"),
      title: document.getElementById(d.getAttribute("aria-labelledby") ?? "")?.textContent,
      body: !!document.getElementById(d.getAttribute("aria-describedby") ?? ""),
    }));
    check(aria.role === "dialog" && aria.modal === "true" && aria.title === "Go Pro" && aria.body, "pricing: dialog role/aria-modal/labelledby/describedby");
    const text = await page.$eval("dialog.preview-sheet", (d) => d.innerText);
    check(text.includes("$6.99/mo"), "pricing: monthly modal shows $6.99/mo");
    check(text.includes("Cancel anytime from Manage subscription."), "pricing: monthly modal shows the cancel line");
    await page.screenshot({ path: `${OUT}/interstitial-pricing-desktop-dark.png` });

    // Tab trap: Tab from the last control wraps to the first, Shift+Tab from the first wraps to the last.
    const order = await page.evaluate(() => [...document.querySelectorAll("dialog.preview-sheet a[href], dialog.preview-sheet button:not([disabled])")].map((el) => el.textContent?.trim() || el.getAttribute("aria-label")));
    for (let i = 0; i < order.length + 1; i += 1) await page.keyboard.press("Tab");
    const stillInside = await page.evaluate(() => !!document.activeElement?.closest("dialog.preview-sheet"));
    check(stillInside, `pricing: Tab stays trapped in the modal (${order.join(" · ")})`);

    await page.keyboard.press("Escape");
    await sleep(250);
    check(!(await dialogOpen(page)), "pricing: Esc closes the modal");
    const back = await page.evaluate(() => document.activeElement?.textContent?.trim());
    check(back === "Go Pro", `pricing: focus returns to Go Pro (got ${back})`);
    const ev = await events(page);
    check(JSON.stringify(ev) === JSON.stringify([
      ["pro_interstitial_view", { source_surface: "pricing_go_pro", intent: "pro", logged_in: false, billing: "monthly" }],
      ["interstitial_dismiss", { source_surface: "pricing_go_pro", intent: "pro", logged_in: false, method: "esc" }],
    ]), `pricing: esc events ${JSON.stringify(ev)}`);

    // Yearly tab: price follows, other dismiss paths, tab survives.
    await selectTab(page, 1);
    await clickGoPro(page);
    await sleep(250);
    const yearly = await page.$eval("dialog.preview-sheet", (d) => d.innerText);
    check(yearly.includes("$5/mo · billed $59.99/year"), "pricing: yearly modal shows $5/mo · billed $59.99/year");
    await page.click("dialog.preview-sheet .preview-sheet__x");
    await sleep(250);
    check(!(await dialogOpen(page)), "pricing: X closes the modal");
    const tabAfterX = await page.evaluate(() => document.querySelector(".preview-tabs [aria-selected=true]")?.textContent);
    check(tabAfterX?.startsWith("Yearly"), "pricing: billing tab stays Yearly after closing");

    await clickGoPro(page);
    await sleep(250);
    await page.mouse.click(8, 8);
    await sleep(250);
    check(!(await dialogOpen(page)), "pricing: backdrop click closes the modal");

    await selectTab(page, 2);
    await clickGoPro(page);
    await sleep(250);
    const lifetime = await page.$eval("dialog.preview-sheet", (d) => d.innerText);
    check(lifetime.includes("$74.99 one-time"), "pricing: lifetime modal shows $74.99 one-time");
    check(lifetime.includes("Lifetime Pro access for a single one-time payment.") && !lifetime.includes("Cancel anytime from Manage subscription."), "pricing: lifetime line replaces the cancel line");
    const notNow = await page.$$eval("dialog.preview-sheet button", (bs) => bs.findIndex((b) => b.textContent?.trim() === "Not now"));
    await page.evaluate((i) => document.querySelectorAll("dialog.preview-sheet button")[i].click(), notNow);
    await sleep(250);
    check(!(await dialogOpen(page)), "pricing: Not now closes the modal");
    check(new URL(page.url()).pathname === "/pricing", "pricing: still on /pricing after every dismiss");
    const all = (await events(page)).map(([name, p]) => `${name}:${p.method ?? p.billing ?? ""}`);
    check(JSON.stringify(all) === JSON.stringify([
      "pro_interstitial_view:monthly", "interstitial_dismiss:esc",
      "pro_interstitial_view:yearly", "interstitial_dismiss:close",
      "pro_interstitial_view:yearly", "interstitial_dismiss:backdrop",
      "pro_interstitial_view:lifetime", "interstitial_dismiss:cancel",
    ]), `pricing: one view + one dismiss per open ${JSON.stringify(all)}`);

    // Continue: fires steam_continue then sign_up_start once, then the browser follows the link.
    await selectTab(page, 0);
    await clickGoPro(page);
    await sleep(250);
    const before = (await events(page)).length;
    await Promise.all([page.waitForNavigation({ timeout: 15000 }).catch(() => null), page.click("dialog.preview-sheet .preview-sheet__go")]);
    check(new URL(page.url()).pathname === "/auth/steam" && new URL(page.url()).search === "?return=%2Fpricing", `pricing: Continue follows to ${page.url()}`);
    await page.close();
    console.log(`     (${before} events before continue)`);
  }

  // Continue fires steam_continue + sign_up_start before the browser follows the link.
  {
    const { page } = await openPage("/pricing");
    await clickGoPro(page);
    await sleep(250);
    await page.evaluate(() => {
      const a = document.querySelector("dialog.preview-sheet .preview-sheet__go");
      a.addEventListener("click", (e) => e.preventDefault());
      a.click();
    });
    const ev = await events(page);
    check(JSON.stringify(ev) === JSON.stringify([
      ["pro_interstitial_view", { source_surface: "pricing_go_pro", intent: "pro", logged_in: false, billing: "monthly" }],
      ["steam_continue", { source_surface: "pricing_go_pro", intent: "pro", logged_in: false, billing: "monthly" }],
      ["sign_up_start", { location: "pricing" }],
    ]), `pricing: continue events ${JSON.stringify(ev)}`);

    // Free "Get started" still goes straight to Steam with sign_up_start{pricing}.
    await page.evaluate(() => { window.dataLayer = window.dataLayer.filter((entry) => entry[0] !== "event"); });
    const [nav] = await Promise.all([
      page.waitForNavigation({ timeout: 15000 }).catch(() => null),
      page.evaluate(() => [...document.querySelectorAll(".preview-plan button")].find((b) => b.textContent?.trim() === "Get started")?.click()),
    ]);
    check(!!nav && new URL(page.url()).pathname === "/auth/steam", "pricing: Get started goes straight to Steam");
    await page.close();
  }

  // Stored ref rides along exactly like today.
  {
    const { page } = await openPage("/pricing", { ref: "abc" });
    await clickGoPro(page);
    await sleep(250);
    check(await continueHref(page) === "/auth/steam?return=%2Fpricing&ref=abc", `pricing: stored ref href ${await continueHref(page)}`);
    await page.close();
  }

  // Light mode and 390px captures.
  for (const mode of ["light", "dark"]) {
    const { page } = await openPage("/pricing", { mode });
    await clickGoPro(page);
    await sleep(300);
    if (mode === "light") await page.screenshot({ path: `${OUT}/interstitial-pricing-desktop-light.png` });
    await page.close();
    const mobile = await openPage("/pricing", { mode, width: 390, height: 844 });
    await clickGoPro(mobile.page);
    await sleep(300);
    const m = await mobile.page.evaluate(() => {
      const d = document.querySelector("dialog.preview-sheet");
      const card = d.querySelector(".preview-sheet__card");
      const buttons = [...d.querySelectorAll(".preview-sheet__actions .preview-btn")].map((b) => b.getBoundingClientRect());
      const rect = d.getBoundingClientRect();
      return {
        scrollX: document.documentElement.scrollWidth > window.innerWidth,
        left: rect.left,
        right: window.innerWidth - rect.right,
        height: rect.height,
        maxHeight: window.innerHeight * 0.9,
        buttons: buttons.map((b) => ({ w: Math.round(b.width), h: Math.round(b.height), top: Math.round(b.top) })),
        cardWidth: Math.round(card.getBoundingClientRect().width),
        scrollable: card.scrollHeight >= card.clientHeight,
        firstIsContinue: d.querySelector(".preview-sheet__actions .preview-btn")?.classList.contains("preview-sheet__go"),
      };
    });
    check(!m.scrollX, `390 ${mode}: no horizontal scroll`);
    check(Math.round(m.left) === 16 && Math.round(m.right) === 16, `390 ${mode}: 16px gutters (${m.left}/${m.right})`);
    check(m.height <= m.maxHeight + 1, `390 ${mode}: height ${Math.round(m.height)} ≤ 90dvh ${Math.round(m.maxHeight)}`);
    check(m.buttons.every((b) => b.h >= 44 && b.w >= m.cardWidth - 34), `390 ${mode}: buttons full-width and ≥44px ${JSON.stringify(m.buttons)}`);
    check(m.buttons.length === 2 && m.buttons[0].top < m.buttons[1].top && m.firstIsContinue, `390 ${mode}: buttons stacked, Continue first`);
    await mobile.page.screenshot({ path: `${OUT}/interstitial-pricing-390-${mode}.png` });
    // Every line of copy is reachable by scrolling inside the modal.
    await mobile.page.evaluate(() => { const c = document.querySelector(".preview-sheet__card"); c.scrollTop = c.scrollHeight; });
    await sleep(150);
    const reach = await mobile.page.evaluate(() => {
      const d = document.querySelector("dialog.preview-sheet").getBoundingClientRect();
      const last = document.querySelector(".preview-sheet__actions").getBoundingClientRect();
      return last.bottom <= d.bottom + 1;
    });
    check(reach, `390 ${mode}: actions reachable by scrolling inside the modal`);
    await mobile.page.close();
  }

  // ------------------------------------------------------------ /trade-ups/:id logged out
  const share = await sharePath();
  {
    const { page } = await openPage(share);
    await page.waitForSelector(".preview-panel button.preview-btn--lime", { timeout: 60000 });
    const label = await page.evaluate(() => [...document.querySelectorAll(".preview-panel button")].find((b) => b.textContent?.includes("Verify or claim"))?.textContent?.trim());
    check(label === "Verify or claim this trade-up", `share: trigger label (${label})`);
    await page.evaluate(() => [...document.querySelectorAll(".preview-panel button")].find((b) => b.textContent?.includes("Verify or claim"))?.click());
    await sleep(300);
    check(await dialogOpen(page), "share: trigger opens the claim modal");
    const expected = `/auth/steam?${new URLSearchParams({ return: share }).toString()}`;
    check(await continueHref(page) === expected, `share: Continue href ${await continueHref(page)} === ${expected}`);
    const text = await page.$eval("dialog.preview-sheet", (d) => d.innerText);
    check(text.includes("Verify and claim this trade-up") && text.includes("$6.99/mo"), "share: claim modal title + $6.99/mo");
    await page.screenshot({ path: `${OUT}/interstitial-share-desktop-dark.png` });
    await page.keyboard.press("Escape");
    await sleep(250);
    const ev = await events(page);
    const claimEvents = ev.filter(([name]) => name !== "tradeup_view");
    check(JSON.stringify(claimEvents) === JSON.stringify([
      ["claim_interstitial_view", { source_surface: "share_verify", intent: "claim", logged_in: false }],
      ["interstitial_dismiss", { source_surface: "share_verify", intent: "claim", logged_in: false, method: "esc" }],
    ]), `share: events ${JSON.stringify(claimEvents)}`);
    await page.close();

    const mobile = await openPage(share, { width: 390, height: 844, mode: "light" });
    await mobile.page.waitForSelector(".preview-panel button.preview-btn--lime", { timeout: 60000 });
    await mobile.page.evaluate(() => [...document.querySelectorAll(".preview-panel button")].find((b) => b.textContent?.includes("Verify or claim"))?.click());
    await sleep(300);
    const noScroll = await mobile.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    check(noScroll, "share 390: no horizontal scroll");
    await mobile.page.screenshot({ path: `${OUT}/interstitial-share-390-light.png` });
    await mobile.page.close();
  }

  // Logged in: the sign-in panel never renders, even before /api/auth/me resolves.
  {
    const page = await (await browser.createBrowserContext()).newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const url = new URL(req.url());
      if (/googletagmanager\.com|google-analytics\.com/.test(url.hostname)) req.abort();
      else if (url.pathname === "/api/auth/me") {
        setTimeout(() => req.respond({ status: 200, contentType: "application/json", body: JSON.stringify(USERS.pro) }), 2500);
      } else req.continue();
    });
    await page.evaluateOnNewDocument(() => {
      window.__sawSignIn = false;
      new MutationObserver(() => {
        if ([...document.querySelectorAll(".preview-panel")].some((p) => p.textContent?.includes("Sign in to verify"))) window.__sawSignIn = true;
      }).observe(document, { childList: true, subtree: true });
    });
    await page.goto(`${BASE}${share}`, { waitUntil: "networkidle2", timeout: 90000 });
    await sleep(500);
    check(!(await page.evaluate(() => window.__sawSignIn)), "share: logged-in user never sees the sign-in panel flash");
    await page.close();
  }

  // Logged in as Free: Go Pro goes straight to checkout, no modal, begin_checkout fires.
  {
    const { page, subscribeCalls } = await openPage("/pricing", { user: "free" });
    await clickGoPro(page);
    await sleep(500);
    check(subscribeCalls.length === 1 && subscribeCalls[0] === JSON.stringify({ plan: "pro" }), `free: Go Pro calls /api/subscribe ${JSON.stringify(subscribeCalls)}`);
    check(!(await dialogOpen(page)), "free: Go Pro opens no modal");
    const ev = await events(page);
    check(JSON.stringify(ev) === JSON.stringify([["begin_checkout", { item_name: "pro" }]]), `free: begin_checkout fires as before ${JSON.stringify(ev)}`);
    await page.close();
  }
  // Pro and lifetime: Manage subscription on /pricing opens the billing portal. Screenshot before the redirect.
  for (const user of ["pro", "lifetime"]) {
    for (const mode of ["dark", "light"]) {
      const shot = await openPage("/pricing", { user, mode, width: mode === "light" && user === "pro" ? 390 : 1280, height: mode === "light" && user === "pro" ? 844 : 900 });
      const shown = await shot.page.evaluate(() => [...document.querySelectorAll(".preview-plan--pro button")].some((b) => b.textContent?.trim() === "Manage subscription"));
      check(shown, `${user} ${mode}: /pricing shows Manage subscription`);
      await shot.page.screenshot({ path: `${OUT}/manage-subscription-pricing-${user}-${shot.page.viewport().width}-${mode}.png` });
      await shot.page.close();
    }
    const { page, portalCalls, subscribeCalls } = await openPage("/pricing", { user });
    const current = await page.evaluate(() => {
      const btn = [...document.querySelectorAll(".preview-plan--pro button")].find((b) => b.textContent?.trim() === "Current plan");
      btn?.click();
      return { disabled: !!btn?.disabled, text: btn?.textContent?.trim() ?? null };
    });
    await sleep(400);
    check(current.disabled && subscribeCalls.length === 0, `${user}: Current plan is disabled and does not start checkout`);
    await Promise.all([
      page.waitForNavigation({ timeout: 15000 }).catch(() => null),
      page.evaluate(() => [...document.querySelectorAll(".preview-plan--pro button")].find((b) => b.textContent?.trim() === "Manage subscription")?.click()),
    ]);
    check(portalCalls.length === 1 && portalCalls[0] === "POST", `${user}: Manage subscription POSTs /api/billing-portal`);
    check(subscribeCalls.length === 0, `${user}: Manage subscription does not start checkout`);
    check(new URL(page.url()).pathname === "/qa-portal-stub", `${user}: Manage subscription follows the portal url`);
    await page.close();
  }
  {
    const { page } = await openPage("/my-trade-ups", { user: "pro" });
    await page.waitForSelector(".preview-page__meta", { timeout: 30000 });
    const meta = await page.$eval(".preview-page__meta", (el) => el.textContent);
    check(meta?.includes("Manage subscription"), `pro: /my-trade-ups header shows Manage subscription (${meta})`);
    await page.screenshot({ path: `${OUT}/manage-subscription-account-dark.png` });
    await page.close();
    const free = await openPage("/pricing", { user: "free" });
    const freeManage = await free.page.evaluate(() => document.body.innerText.includes("Manage subscription\n") || [...document.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Manage subscription"));
    check(!freeManage, "free: no Manage subscription button");
    await free.page.close();
  }
} finally {
  await browser.close();
}

if (failures.length > 0) {
  console.error(`INTERSTITIAL QA FAIL (${failures.length})`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("interstitial QA ok");
