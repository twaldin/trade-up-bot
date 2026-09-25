// Two real Chrome documents, one browser context, one shared localStorage and Web Lock.
// Holds GET /api/checkout-session/:id until both pages have entered the claim path,
// then asserts a single purchase. Fails on the pre-lock check-then-set implementation.
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const require = createRequire(import.meta.url);
const esbuild = require("esbuild");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SESSION = "cs_test_two_tabs";

const bundled = await esbuild.build({
  absWorkingDir: root,
  entryPoints: ["src/lib/purchase.ts"],
  bundle: true,
  format: "iife",
  globalName: "TubPurchase",
  platform: "browser",
  write: false,
  logLevel: "silent",
});
const purchaseJs = bundled.outputFiles[0].text;

function listen(handler) {
  const server = createServer(handler);
  return new Promise((resolveListen) => {
    server.listen(0, "127.0.0.1", () => resolveListen(server));
  });
}

async function runTrial(browser, stripLocks) {
  let lockEntries = 0;
  let claimEntries = 0;
  let fetches = 0;
  const releaseBoth = [];
  const bothEntered = () => (lockEntries >= 2 || (lockEntries === 0 && claimEntries >= 2))
    ? Promise.resolve()
    : new Promise((resolveEntered) => { releaseBoth.push(resolveEntered); });
  const noteEntry = () => {
    if (lockEntries >= 2 || (lockEntries === 0 && claimEntries >= 2)) {
      for (const release of releaseBoth.splice(0)) release();
    }
  };

  const server = await listen(async (req, res) => {
    const url = req.url ?? "/";
    if (url.startsWith("/api/checkout-session/")) {
      fetches += 1;
      const ready = await Promise.race([
        bothEntered().then(() => true),
        new Promise((resolveReady) => { setTimeout(() => resolveReady(false), 8000); }),
      ]);
      if (!ready) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "tabs did not both enter", lockEntries, claimEntries }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ transaction_id: SESSION, value: 6.99, currency: "USD" }));
      return;
    }
    if (url === "/__entered-lock") {
      lockEntries += 1;
      noteEntry();
      res.writeHead(204);
      res.end();
      return;
    }
    if (url === "/__entered-claim") {
      claimEntries += 1;
      noteEntry();
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html>
<script>
window.__ga = [];
window.__px = [];
window.gtag = function () { window.__ga.push(Array.from(arguments)); };
window.fbq = function () { window.__px.push(Array.from(arguments)); };
window.tubTracking = { ga4MeasurementId: "G-NEWPROP123", metaPixelId: "123456789012345" };
</script>
<script>${purchaseJs}</script>`);
  });

  const { port } = server.address();
  const context = await browser.createBrowserContext();
  try {
    const arm = (page) => page.evaluateOnNewDocument((strip) => {
      const notify = (path) => { void fetch(path, { method: "POST", keepalive: true }); };
      const origGet = Storage.prototype.getItem;
      let noted = false;
      Storage.prototype.getItem = function (key) {
        if (!noted && typeof key === "string" && key.startsWith("tub_purchase_")) {
          noted = true;
          notify("/__entered-claim");
        }
        return origGet.call(this, key);
      };
      if (strip) {
        Object.defineProperty(navigator, "locks", { configurable: true, get() { return undefined; } });
        return;
      }
      const orig = navigator.locks.request.bind(navigator.locks);
      navigator.locks.request = function (name, options, callback) {
        notify("/__entered-lock");
        return typeof options === "function" ? orig(name, options) : orig(name, options, callback);
      };
    }, stripLocks);

    const pageA = await context.newPage();
    const pageB = await context.newPage();
    await Promise.all([arm(pageA), arm(pageB)]);
    await Promise.all([
      pageA.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" }),
      pageB.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" }),
    ]);
    const started = await Promise.all([pageA, pageB].map((page) => page.evaluate(async (id) => {
      try {
        await window.TubPurchase.reportPurchase("pro", id);
        return "ok";
      } catch (err) {
        return String(err);
      }
    }, SESSION)));
    if (started.some((status) => status !== "ok")) {
      throw new Error(`reportPurchase failed (${stripLocks ? "no locks" : "locks"}): ${started.join(" | ")}`);
    }
    const counts = await Promise.all([pageA, pageB].map((page) => page.evaluate(() => ({
      ga: window.__ga.filter((args) => args[0] === "event" && args[1] === "purchase").length,
      px: window.__px.filter((args) => args[0] === "track" && args[1] === "Purchase").length,
    }))));
    return {
      stripLocks,
      fetches,
      ga: counts.reduce((sum, row) => sum + row.ga, 0),
      px: counts.reduce((sum, row) => sum + row.px, 0),
    };
  } finally {
    await context.close();
    await new Promise((resolveClose) => { server.close(resolveClose); });
  }
}

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

try {
  const withLocks = await runTrial(browser, false);
  const withoutLocks = await runTrial(browser, true);
  const trials = [withLocks, withoutLocks];
  for (const trial of trials) {
    const label = trial.stripLocks ? "locks deleted" : "navigator.locks";
    if (trial.ga !== 1 || trial.px > 1 || trial.fetches !== 1) {
      console.error(`${label}: ga=${trial.ga} pixel=${trial.px} fetches=${trial.fetches}`);
      process.exit(1);
    }
    console.log(`${label}: ga=${trial.ga} pixel=${trial.px} fetches=${trial.fetches}`);
  }
} finally {
  await browser.close();
}
