/**
 * Drive the kit my-trade-ups page with intercepted live-shaped payloads so we
 * can screenshot claims (board cards), purchased, history, and the sell confirm
 * without a signed-in Pro session.
 */
import { mkdirSync } from "node:fs";
import puppeteer from "puppeteer";

const OUT = process.env.QA_OUT ?? "/opt/cursor/artifacts/screenshots";
const BASE = process.env.QA_BASE ?? "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const USER = {
  steam_id: "76561198000000000",
  display_name: "tim",
  avatar_url: "",
  tier: "pro",
  is_admin: false,
};

const CLAIM = {
  id: 13901,
  type: "classified_covert",
  total_cost_cents: 110452,
  expected_value_cents: 164853,
  profit_cents: 54401,
  roi_percentage: 49.25,
  chance_to_profit: 0.72,
  best_case_cents: 81200,
  worst_case_cents: -18400,
  created_at: "2026-08-18T12:00:00.000Z",
  claimed_by_me: true,
  inputs: [
    { listing_id: "csf-1", skin_id: "s1", skin_name: "AK-47 | Redline", collection_name: "The Phoenix Collection", price_cents: 11045, float_value: 0.1523, condition: "Field-Tested", source: "csfloat" },
    { listing_id: "csf-2", skin_id: "s1", skin_name: "AK-47 | Redline", collection_name: "The Phoenix Collection", price_cents: 11045, float_value: 0.1611, condition: "Field-Tested", source: "csfloat" },
    { listing_id: "csf-3", skin_id: "s2", skin_name: "M4A1-S | Atomic Alloy", collection_name: "The Huntsman Collection", price_cents: 11046, float_value: 0.0744, condition: "Minimal Wear", source: "skinport" },
    { listing_id: "csf-4", skin_id: "s2", skin_name: "M4A1-S | Atomic Alloy", collection_name: "The Huntsman Collection", price_cents: 11046, float_value: 0.0812, condition: "Minimal Wear", source: "dmarket" },
    { listing_id: "csf-5", skin_id: "s1", skin_name: "AK-47 | Redline", collection_name: "The Phoenix Collection", price_cents: 11045, float_value: 0.1488, condition: "Field-Tested", source: "csfloat" },
    { listing_id: "csf-6", skin_id: "s1", skin_name: "AK-47 | Redline", collection_name: "The Phoenix Collection", price_cents: 11045, float_value: 0.1702, condition: "Field-Tested", source: "buff" },
    { listing_id: "csf-7", skin_id: "s2", skin_name: "M4A1-S | Atomic Alloy", collection_name: "The Huntsman Collection", price_cents: 11045, float_value: 0.0901, condition: "Minimal Wear", source: "csfloat" },
    { listing_id: "csf-8", skin_id: "s1", skin_name: "AK-47 | Redline", collection_name: "The Phoenix Collection", price_cents: 11045, float_value: 0.1555, condition: "Field-Tested", source: "skinport" },
    { listing_id: "csf-9", skin_id: "s2", skin_name: "M4A1-S | Atomic Alloy", collection_name: "The Huntsman Collection", price_cents: 11045, float_value: 0.0688, condition: "Minimal Wear", source: "csfloat" },
    { listing_id: "csf-10", skin_id: "s1", skin_name: "AK-47 | Redline", collection_name: "The Phoenix Collection", price_cents: 11045, float_value: 0.1620, condition: "Field-Tested", source: "dmarket" },
  ],
  outcomes: [
    { skin_id: "o1", skin_name: "AK-47 | Fire Serpent", collection_name: "The Bravo Collection", probability: 0.4, predicted_float: 0.1422, predicted_condition: "Field-Tested", estimated_price_cents: 191600 },
    { skin_id: "o2", skin_name: "M4A4 | X-Ray", collection_name: "The Havoc Collection", probability: 0.35, predicted_float: 0.0881, predicted_condition: "Minimal Wear", estimated_price_cents: 148200 },
    { skin_id: "o3", skin_name: "AWP | Redline", collection_name: "The Phoenix Collection", probability: 0.25, predicted_float: 0.2104, predicted_condition: "Field-Tested", estimated_price_cents: 92000 },
  ],
};

const PURCHASED = {
  id: 77,
  user_id: USER.steam_id,
  trade_up_id: 13901,
  status: "purchased",
  snapshot_inputs: CLAIM.inputs.map((row) => ({
    skin_name: row.skin_name,
    collection_name: row.collection_name,
    price_cents: row.price_cents,
    float_value: row.float_value,
    condition: row.condition,
    source: row.source,
    stattrak: false,
  })),
  snapshot_outcomes: CLAIM.outcomes.map((out) => ({
    skin_name: out.skin_name,
    skin_id: out.skin_id,
    probability: out.probability,
    price_cents: out.estimated_price_cents,
    condition: out.predicted_condition,
    predicted_float: out.predicted_float,
  })),
  total_cost_cents: 110452,
  expected_value_cents: 164853,
  roi_percentage: 49.25,
  chance_to_profit: 0.72,
  best_case_cents: 81200,
  worst_case_cents: -18400,
  type: "classified_covert",
  purchased_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  executed_at: null,
  sold_at: null,
  outcome_skin_id: null,
  outcome_skin_name: null,
  outcome_condition: null,
  outcome_float: null,
  sold_price_cents: null,
  sold_marketplace: null,
  actual_profit_cents: null,
};

const EXECUTED = {
  ...PURCHASED,
  id: 78,
  status: "executed",
  purchased_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
  executed_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  outcome_skin_id: "o1",
  outcome_skin_name: "AK-47 | Fire Serpent",
  outcome_condition: "Field-Tested",
  outcome_float: 0.1422,
};

const SOLD = {
  ...EXECUTED,
  id: 79,
  status: "sold",
  sold_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  sold_price_cents: 191600,
  sold_marketplace: "csfloat",
  actual_profit_cents: 81148,
};

const STATS = {
  all_time_profit_cents: 81148,
  total_executed: 2,
  total_sold: 1,
  win_count: 1,
  win_rate: 100,
  avg_roi: 73.5,
};

function json(body) {
  return { status: 200, contentType: "application/json", body: JSON.stringify(body) };
}

async function setMode(page, want) {
  await page.evaluate((mode) => {
    const root = document.querySelector("[data-preview]");
    if (!root || root.getAttribute("data-mode") === mode) return;
    [...document.querySelectorAll("button")]
      .find((b) => /^(Light|Dark)$/.test(b.textContent.trim()))
      ?.click();
  }, want);
  await sleep(700);
}

const browser = await puppeteer.launch({
  headless: "new",
  protocolTimeout: 240000,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
  defaultViewport: { width: 1440, height: 1100, deviceScaleFactor: 2 },
});

const problems = [];

try {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("/api/auth/me")) return req.respond(json(USER));
    if (url.includes("/api/my-trade-ups/stats")) return req.respond(json(STATS));
    if (url.includes("/api/trade-ups?") && url.includes("my_claims=true")) {
      return req.respond(json({ trade_ups: [CLAIM], total: 1 }));
    }
    if (url.includes("/api/my-trade-ups?status=purchased")) {
      return req.respond(json({ trade_ups: [PURCHASED] }));
    }
    if (url.includes("/api/my-trade-ups?status=executed,sold")) {
      return req.respond(json({ trade_ups: [EXECUTED, SOLD] }));
    }
    if (url.includes("/api/preview/faces")) {
      return req.continue();
    }
    if (url.includes("/api/")) {
      return req.respond(json({}));
    }
    return req.continue();
  });

  await page.goto(`${BASE}/my-trade-ups`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector(".preview-card", { timeout: 30000 });
  await sleep(2500);

  const claimsInfo = await page.evaluate(() => ({
    stubChip: [...document.querySelectorAll(".preview-chip")].some((el) => el.textContent.trim() === "claim"),
    stubListing: !!document.querySelector(".preview-listing"),
    cards: document.querySelectorAll(".preview-card").length,
    tabs: [...document.querySelectorAll(".o-tab")].map((el) => el.textContent.trim()),
    sold: document.body.innerText.includes("Sold"),
    realized: document.body.innerText.includes("Realized profit"),
    sidebar: [...document.querySelectorAll(".o-nav-item")].map((el) => el.textContent.trim()),
  }));
  if (claimsInfo.stubChip) problems.push("claims tab still paints the stub claim chip");
  if (claimsInfo.stubListing) problems.push("claims tab still paints preview-listing stub rows");
  if (claimsInfo.cards < 1) problems.push("claims tab has no kit board card");
  if (!claimsInfo.tabs.some((t) => t.startsWith("Active Claims"))) problems.push("missing Active Claims tab");
  if (!claimsInfo.sidebar.includes("My trade-ups")) problems.push("sidebar is not labeled My trade-ups");

  await setMode(page, "dark");
  await page.screenshot({ path: `${OUT}/account-claims-dark.png`, fullPage: true });
  await setMode(page, "light");
  await page.screenshot({ path: `${OUT}/account-claims-light.png`, fullPage: true });

  await page.evaluate(() => {
    [...document.querySelectorAll(".o-tab")].find((el) => el.textContent.includes("Purchased"))?.click();
  });
  await page.waitForSelector(".o-table", { timeout: 15000 });
  await sleep(1200);
  await page.screenshot({ path: `${OUT}/account-purchased-light.png`, fullPage: true });
  await setMode(page, "dark");
  await page.screenshot({ path: `${OUT}/account-purchased-dark.png`, fullPage: true });

  await page.evaluate(() => {
    [...document.querySelectorAll(".o-tab")].find((el) => el.textContent.includes("History"))?.click();
  });
  await page.waitForFunction(() => document.body.innerText.includes("Mark Sold"), { timeout: 15000 });
  await sleep(1200);
  await page.screenshot({ path: `${OUT}/account-history-dark.png`, fullPage: true });

  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((el) => el.textContent.trim() === "Mark Sold")?.click();
  });
  await page.waitForSelector(".preview-confirm", { timeout: 10000 });
  const priceInput = await page.$(".preview-confirm input[type='number']");
  await priceInput.click({ clickCount: 3 });
  await priceInput.type("1916.00");
  await page.waitForFunction(() => document.body.innerText.includes("ROI"), { timeout: 5000 });
  await sleep(400);
  await page.screenshot({ path: `${OUT}/account-sell-confirm-dark.png`, fullPage: true });
  await setMode(page, "light");
  await page.screenshot({ path: `${OUT}/account-sell-confirm-light.png`, fullPage: true });
  await page.screenshot({ path: `${OUT}/account-history-light.png`, fullPage: true });

  const signedOut = await browser.newPage();
  await signedOut.goto(`${BASE}/account`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await signedOut.waitForFunction(() => document.body.innerText.includes("Sign in to see claims and Pro delivery."), { timeout: 20000 });
  await sleep(800);
  const redirected = signedOut.url().includes("/my-trade-ups");
  if (!redirected) problems.push(`/account did not redirect (${signedOut.url()})`);
  await signedOut.screenshot({ path: `${OUT}/account-signed-out-dark.png`, fullPage: true });

  console.log("claims:", JSON.stringify(claimsInfo));
} finally {
  await browser.close();
}

console.log(problems.length === 0 ? "\nACCOUNT QA PASS" : `\nACCOUNT QA FAIL:\n- ${problems.join("\n- ")}`);
process.exit(problems.length === 0 ? 0 : 1);
