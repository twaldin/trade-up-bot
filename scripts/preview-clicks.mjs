/** Drives the preview board clicks the QA skill requires and reports the URLs. */
import puppeteer from "puppeteer";

const BASE = process.env.QA_BASE ?? "http://127.0.0.1:5173";
const MARKETS = /csfloat\.com|dmarket\.com|skinport\.com|buff\.market/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1600, height: 1000 },
});

const opened = [];
const failures = [];

try {
  const page = await browser.newPage();
  browser.on("targetcreated", async (target) => {
    if (target.type() === "page") opened.push(target.url());
  });
  await page.goto(`${BASE}/preview/trade-ups`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector(".preview-skin--output", { timeout: 60000 });
  await sleep(2500);

  // 1. input tile -> live listing URLs
  const before = opened.length;
  await page.click(".preview-card .preview-skin--input");
  await sleep(1800);
  const inputUrls = opened.slice(before);
  console.log(`input click opened ${inputUrls.length}:`);
  inputUrls.forEach((u) => console.log("  ", u));
  if (inputUrls.length === 0) failures.push("input tile opened nothing");
  if (inputUrls.some((u) => !MARKETS.test(u))) failures.push(`input tile left the marketplaces: ${inputUrls.find((u) => !MARKETS.test(u))}`);
  if (inputUrls.some((u) => u.startsWith(BASE))) failures.push("input tile opened a local URL");

  // 2. output tile -> marketplace or prod skin page, and it must resolve
  const outHref = await page.$eval(".preview-card .preview-skin--output", (el) => el.href);
  console.log("output href:", outHref);
  if (outHref.startsWith(BASE)) failures.push("output tile points at the preview origin");
  const outRes = await page.goto(outHref, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => null);
  const outStatus = outRes?.status() ?? 0;
  const outBody = await page.evaluate(() => document.body.innerText.slice(0, 400)).catch(() => "");
  console.log("output status:", outStatus);
  if (outStatus >= 400) failures.push(`output href returned ${outStatus}`);
  if (/skin not found/i.test(outBody)) failures.push("output href says skin not found");

  // 3. expand -> verify/claim + listing rows
  await page.goto(`${BASE}/preview/trade-ups`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector(".preview-card", { timeout: 60000 });
  await sleep(2500);
  await page.evaluate(() => { document.querySelector(".preview-card")?.click(); });
  await sleep(3000);
  const expandInfo = await page.evaluate(() => {
    const card = document.querySelector(".preview-card--expanded");
    return {
      hasStrip: !!card?.querySelector(".preview-strip--tall"),
      hasWaterfall: !!card?.querySelector(".preview-wf"),
      hasCdf: !!card?.querySelector(".preview-cdf"),
      listings: card?.querySelectorAll(".preview-listing").length ?? 0,
      listingHrefs: [...(card?.querySelectorAll(".preview-listing") ?? [])].slice(0, 3).map((a) => a.href),
      verify: card?.querySelector(".preview-btn--lime")?.href ?? null,
      inputTiles: card?.querySelectorAll(".preview-expand__inputs .preview-skin").length ?? 0,
    };
  });
  console.log("expanded:", JSON.stringify(expandInfo, null, 2));
  if (!expandInfo.hasStrip) failures.push("expanded is missing the larger payoff strip");
  if (!expandInfo.hasWaterfall) failures.push("expanded is missing the EV waterfall");
  if (!expandInfo.hasCdf) failures.push("expanded is missing the CDF");
  if (expandInfo.listings === 0) failures.push("expanded is missing listings");
  if (!/^https:\/\/tradeupbot\.app\/trade-ups\/\d+$/.test(expandInfo.verify ?? "")) {
    failures.push(`verify/claim href wrong: ${expandInfo.verify}`);
  }
  for (const href of expandInfo.listingHrefs) {
    if (!MARKETS.test(href)) failures.push(`listing row is not a marketplace URL: ${href}`);
  }

  // 4. no local /skins anywhere on the board
  const localSkins = await page.evaluate(() =>
    [...document.querySelectorAll("a[href]")]
      .map((a) => a.getAttribute("href"))
      .filter((h) => h && h.startsWith("/skins/")));
  if (localSkins.length > 0) failures.push(`local /skins hrefs: ${localSkins.slice(0, 3).join(", ")}`);

  // 5. copy check
  const copy = await page.evaluate(() => document.body.innerText);
  if (/\bcontracts?\b/i.test(copy)) failures.push("the word contract is on the preview surface");
} finally {
  await browser.close();
}

console.log(failures.length === 0 ? "\nCLICK QA PASS" : `\nCLICK QA FAIL:\n- ${failures.join("\n- ")}`);
process.exit(failures.length === 0 ? 0 : 1);
