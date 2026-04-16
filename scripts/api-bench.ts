#!/usr/bin/env tsx
/**
 * TradeUpBot API Benchmark
 * Tests every route against the live production site and reports latency.
 *
 * Usage:
 *   npx tsx scripts/api-bench.ts
 *   npx tsx scripts/api-bench.ts --base=https://tradeupbot.app
 *   npx tsx scripts/api-bench.ts --base=http://localhost:3001
 */

const BASE = process.argv.find(a => a.startsWith("--base="))?.split("=")[1] ?? "https://tradeupbot.app";
const SLOW_MS = 1000;
const CRITICAL_MS = 5000;
const TIMEOUT_MS = 30_000;
const GOOGLEBOT_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

// ── Helpers ──────────────────────────────────────────────────────────────────

interface BenchResult {
  label: string;
  url: string;
  method: string;
  cold_ms: number;
  warm_ms: number | null;
  status: number;
  cached: boolean;
  size_bytes: number;
  error?: string;
  flags: string[];
}

async function hit(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string; label?: string; timeout?: number } = {}
): Promise<{ ms: number; status: number; cached: boolean; size_bytes: number; error?: string }> {
  const method = opts.method ?? "GET";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeout ?? TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers: {
        "User-Agent": "TradeUpBotBench/1.0",
        "Accept": "application/json, text/html, */*",
        ...(opts.headers ?? {}),
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
      },
      body: opts.body,
      signal: controller.signal,
    });
    const ms = Date.now() - t0;
    const text = await res.text();
    clearTimeout(timer);
    const cached = res.headers.get("x-cache") === "HIT";
    return { ms, status: res.status, cached, size_bytes: text.length };
  } catch (e: unknown) {
    clearTimeout(timer);
    const ms = Date.now() - t0;
    const msg = e instanceof Error ? e.message : String(e);
    return { ms, status: 0, cached: false, size_bytes: 0, error: msg.includes("abort") ? "TIMEOUT" : msg };
  }
}

async function bench(
  label: string,
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string; warmRepeat?: boolean } = {}
): Promise<BenchResult> {
  const cold = await hit(url, opts);
  let warm: { ms: number; status: number; cached: boolean; size_bytes: number; error?: string } | null = null;
  if (opts.warmRepeat !== false && !cold.error) {
    await new Promise(r => setTimeout(r, 80)); // brief pause
    warm = await hit(url, opts);
  }
  const flags: string[] = [];
  const ms = cold.ms;
  if (ms >= CRITICAL_MS) flags.push("CRITICAL");
  else if (ms >= SLOW_MS) flags.push("SLOW");
  if (cold.error) flags.push("ERROR");
  if (cold.status >= 400 && cold.status !== 404 && cold.status !== 403) flags.push(`HTTP_${cold.status}`);

  return {
    label,
    url,
    method: opts.method ?? "GET",
    cold_ms: cold.ms,
    warm_ms: warm?.ms ?? null,
    status: cold.status,
    cached: cold.cached,
    size_bytes: cold.size_bytes,
    error: cold.error,
    flags,
  };
}

// ── Test Cases ────────────────────────────────────────────────────────────────

// Realistic test data based on CS2 common skins and collections
const SAMPLE_COLLECTIONS = [
  "The Italy Collection",
  "The Dust Collection",
  "The Aztec Collection",
  "Operation Bravo Case",
  "Chroma Case",
];

const SAMPLE_SKINS = [
  "AK-47 | Redline",
  "AWP | Asiimov",
  "M4A4 | Howl",
  "Glock-18 | Fade",
];

const TRADE_UP_TYPES = [
  "covert_knife",
  "classified_covert",
  "restricted_classified",
  "milspec_restricted",
];

const B = BASE;

async function runAll(): Promise<BenchResult[]> {
  const results: BenchResult[] = [];

  // ── STATUS / MONITORING ───────────────────────────────────────────────────
  console.log("▶ Status/monitoring endpoints...");
  results.push(await bench("status", `${B}/api/status`));
  results.push(await bench("global-stats", `${B}/api/global-stats`));
  results.push(await bench("daemon-log", `${B}/api/daemon-log`));
  results.push(await bench("daemon-cycles", `${B}/api/daemon-cycles`));
  results.push(await bench("daemon-cycles (limit=10)", `${B}/api/daemon-cycles?limit=10`));
  results.push(await bench("daemon-stats", `${B}/api/daemon-stats`));
  results.push(await bench("daemon-events", `${B}/api/daemon-events`));
  results.push(await bench("daemon-events (since=1h)", `${B}/api/daemon-events?since=${new Date(Date.now() - 3600_000).toISOString()}`));

  // ── TRADE-UPS: Filter options ─────────────────────────────────────────────
  console.log("▶ Filter options...");
  results.push(await bench("filter-options (cold)", `${B}/api/filter-options`));
  results.push(await bench("filter-options (warm)", `${B}/api/filter-options`));

  // ── TRADE-UPS: Main list — no filters ────────────────────────────────────
  console.log("▶ Trade-ups list (no filter)...");
  results.push(await bench("trade-ups default (p1)", `${B}/api/trade-ups`));
  results.push(await bench("trade-ups default (p5)", `${B}/api/trade-ups?page=5`));
  results.push(await bench("trade-ups default (p50)", `${B}/api/trade-ups?page=50`));

  // ── TRADE-UPS: by type ────────────────────────────────────────────────────
  console.log("▶ Trade-ups by type...");
  for (const type of TRADE_UP_TYPES) {
    results.push(await bench(`trade-ups type=${type}`, `${B}/api/trade-ups?type=${type}`));
    results.push(await bench(`trade-ups type=${type} sort=roi`, `${B}/api/trade-ups?type=${type}&sort=roi`));
  }

  // ── TRADE-UPS: by collection ─────────────────────────────────────────────
  console.log("▶ Trade-ups with collection filter (KNOWN SLOW)...");
  for (const col of SAMPLE_COLLECTIONS) {
    results.push(await bench(
      `trade-ups collection=${col.substring(0, 20)}`,
      `${B}/api/trade-ups?collection=${encodeURIComponent(col)}`,
      { warmRepeat: true }
    ));
  }

  // ── TRADE-UPS: by skin (KNOWN TIMEOUT) ───────────────────────────────────
  console.log("▶ Trade-ups with skin filter (KNOWN TIMEOUT ~12s)...");
  for (const skin of SAMPLE_SKINS) {
    results.push(await bench(
      `trade-ups skin=${skin.substring(0, 20)}`,
      `${B}/api/trade-ups?skin=${encodeURIComponent(skin)}`,
      { warmRepeat: false, timeout: 20_000 }
    ));
  }

  // ── TRADE-UPS: combined filters ───────────────────────────────────────────
  console.log("▶ Trade-ups combined filters...");
  results.push(await bench(
    "trade-ups type+min_profit",
    `${B}/api/trade-ups?type=classified_covert&min_profit=100&sort=roi&order=desc`
  ));
  results.push(await bench(
    "trade-ups type+max_cost",
    `${B}/api/trade-ups?type=milspec_restricted&max_cost=1000`
  ));
  results.push(await bench(
    "trade-ups type+min_roi",
    `${B}/api/trade-ups?type=restricted_classified&min_roi=10`
  ));

  // ── TRADE-UP: single by ID ────────────────────────────────────────────────
  console.log("▶ Trade-up by ID...");
  // Use a few small IDs that likely exist
  for (const id of [1, 100, 1000, 10000]) {
    results.push(await bench(`trade-up/:id (${id})`, `${B}/api/trade-ups/${id}`));
  }

  // ── TRADE-UP: inputs + outcomes ───────────────────────────────────────────
  console.log("▶ Trade-up inputs + outcomes...");
  for (const id of [1, 100, 1000]) {
    results.push(await bench(`trade-up inputs (${id})`, `${B}/api/trade-up/${id}/inputs`));
    results.push(await bench(`trade-up outcomes (${id})`, `${B}/api/trade-up/${id}/outcomes`));
  }

  // ── PRICE DETAILS ─────────────────────────────────────────────────────────
  console.log("▶ Price details...");
  const priceTests: [string, string][] = [
    ["AK-47 | Redline", "Field-Tested"],
    ["AWP | Asiimov", "Field-Tested"],
    ["M4A4 | Howl", "Minimal Wear"],
    ["Glock-18 | Fade", "Factory New"],
  ];
  for (const [skin, condition] of priceTests) {
    results.push(await bench(
      `price-details ${skin.substring(0, 15)} ${condition}`,
      `${B}/api/price-details?skin_name=${encodeURIComponent(skin)}&condition=${encodeURIComponent(condition)}`
    ));
  }

  // ── OUTCOME STATS ─────────────────────────────────────────────────────────
  console.log("▶ Outcome stats...");
  results.push(await bench(
    "outcome-stats (2 skins)",
    `${B}/api/outcome-stats?skins=${encodeURIComponent("AK-47 | Redline||AWP | Asiimov")}`
  ));
  results.push(await bench(
    "outcome-stats (5 skins)",
    `${B}/api/outcome-stats?skins=${encodeURIComponent("AK-47 | Redline||AWP | Asiimov||M4A4 | Howl||Glock-18 | Fade||Desert Eagle | Blaze")}`
  ));

  // ── SKIN DATA ─────────────────────────────────────────────────────────────
  console.log("▶ Skin data (list)...");
  results.push(await bench("skin-data default (Covert)", `${B}/api/skin-data?rarity=Covert`));
  results.push(await bench("skin-data all", `${B}/api/skin-data?rarity=all`));
  results.push(await bench("skin-data Classified", `${B}/api/skin-data?rarity=Classified`));
  results.push(await bench("skin-data knife_glove", `${B}/api/skin-data?rarity=knife_glove`));
  results.push(await bench("skin-data p2", `${B}/api/skin-data?rarity=Covert&page=2`));

  for (const col of SAMPLE_COLLECTIONS.slice(0, 3)) {
    results.push(await bench(
      `skin-data collection=${col.substring(0, 20)}`,
      `${B}/api/skin-data?rarity=all&collection=${encodeURIComponent(col)}`
    ));
  }
  results.push(await bench("skin-data search=AK", `${B}/api/skin-data?rarity=all&search=AK`));

  // ── SKIN DETAIL ───────────────────────────────────────────────────────────
  console.log("▶ Skin detail...");
  for (const skin of SAMPLE_SKINS) {
    results.push(await bench(
      `skin-detail ${skin.substring(0, 20)}`,
      `${B}/api/skin-data/${encodeURIComponent(skin)}`
    ));
  }
  // Doppler (has extra phase queries)
  results.push(await bench(
    "skin-detail Doppler",
    `${B}/api/skin-data/${encodeURIComponent("Karambit | Doppler")}`
  ));

  // ── SKIN SUGGESTIONS ──────────────────────────────────────────────────────
  console.log("▶ Skin suggestions...");
  results.push(await bench("skin-suggestions (ak)", `${B}/api/skin-suggestions?q=ak`));
  results.push(await bench("skin-suggestions (awp asp)", `${B}/api/skin-suggestions?q=awp+asp`));
  results.push(await bench("skin-suggestions (karambit)", `${B}/api/skin-suggestions?q=kara`));

  // ── DATA FRESHNESS ────────────────────────────────────────────────────────
  console.log("▶ Data freshness...");
  results.push(await bench("data-freshness Covert", `${B}/api/data-freshness?tab=Covert`));
  results.push(await bench("data-freshness knife_glove", `${B}/api/data-freshness?tab=knife_glove`));
  results.push(await bench(
    "data-freshness with since",
    `${B}/api/data-freshness?tab=Covert&since=${new Date(Date.now() - 3600_000).toISOString()}`
  ));

  // ── SLUG RESOLVERS ────────────────────────────────────────────────────────
  console.log("▶ Slug resolvers...");
  results.push(await bench("collection-by-slug (dust)", `${B}/api/collection-by-slug/the-dust-collection`));
  results.push(await bench("collection-by-slug (italy)", `${B}/api/collection-by-slug/the-italy-collection`));
  results.push(await bench("skin-by-slug (ak-redline)", `${B}/api/skin-by-slug/ak-47-redline`));
  results.push(await bench("skin-by-slug (awp-asiimov)", `${B}/api/skin-by-slug/awp-asiimov`));

  // ── COLLECTIONS ───────────────────────────────────────────────────────────
  console.log("▶ Collections...");
  results.push(await bench("collections list", `${B}/api/collections`));
  results.push(await bench("collection detail (Italy)", `${B}/api/collection/${encodeURIComponent("The Italy Collection")}`));
  results.push(await bench("collection detail (Chroma)", `${B}/api/collection/${encodeURIComponent("Chroma Case")}`));

  // ── SNAPSHOTS ─────────────────────────────────────────────────────────────
  console.log("▶ Snapshots...");
  results.push(await bench("snapshots (24h)", `${B}/api/snapshots`));
  results.push(await bench("snapshots (1h)", `${B}/api/snapshots?hours=1`));

  // ── CALCULATOR ────────────────────────────────────────────────────────────
  console.log("▶ Calculator...");
  results.push(await bench("calculator search (ak)", `${B}/api/calculator/search?q=ak-47`));
  results.push(await bench("calculator search (awp)", `${B}/api/calculator/search?q=awp`));

  // ── LISTING SNIPER ────────────────────────────────────────────────────────
  console.log("▶ Listing sniper...");
  results.push(await bench("listing-sniper/filter-options", `${B}/api/listing-sniper/filter-options`));
  results.push(await bench("listing-sniper (default)", `${B}/api/listing-sniper`));
  results.push(await bench("listing-sniper (sort=diff_cents)", `${B}/api/listing-sniper?sort=diff_cents&order=desc`));
  results.push(await bench(
    "listing-sniper (skin filter)",
    `${B}/api/listing-sniper?skin=${encodeURIComponent("AK-47 | Redline")}`
  ));

  // ── CLAIMS (unauthenticated — expect 401/403) ─────────────────────────────
  console.log("▶ Claims (unauthenticated)...");
  results.push(await bench("claims list (anon)", `${B}/api/claims`));

  // ── SSR / CRAWLER PAGES ───────────────────────────────────────────────────
  console.log("▶ SSR pages (Googlebot UA)...");
  const gbOpts = { headers: { "User-Agent": GOOGLEBOT_UA, "Accept": "text/html" }, warmRepeat: true };
  results.push(await bench("SSR /trade-ups (crawler)", `${B}/trade-ups`, gbOpts));
  results.push(await bench("SSR /collections (crawler)", `${B}/collections`, gbOpts));
  results.push(await bench("SSR /skins (crawler)", `${B}/skins`, gbOpts));
  results.push(await bench("SSR /blog (crawler)", `${B}/blog`, gbOpts));
  results.push(await bench("SSR /blog/how-cs2-trade-ups-work", `${B}/blog/how-cs2-trade-ups-work`, gbOpts));

  // Collection SSR pages
  const collSlugs = ["the-italy-collection", "the-dust-collection", "the-aztec-collection"];
  for (const slug of collSlugs) {
    results.push(await bench(`SSR /collections/${slug}`, `${B}/collections/${slug}`, gbOpts));
    results.push(await bench(`SSR /trade-ups/collection/${slug}`, `${B}/trade-ups/collection/${slug}`, gbOpts));
  }

  // Skin SSR pages
  const skinSlugs = ["ak-47-redline", "awp-asiimov", "glock-18-fade"];
  for (const slug of skinSlugs) {
    results.push(await bench(`SSR /skins/${slug}`, `${B}/skins/${slug}`, gbOpts));
  }

  // Trade-up detail SSR
  results.push(await bench("SSR /trade-ups/1 (crawler)", `${B}/trade-ups/1`, gbOpts));
  results.push(await bench("SSR /trade-ups/100 (crawler)", `${B}/trade-ups/100`, gbOpts));

  // ── SITEMAP ───────────────────────────────────────────────────────────────
  console.log("▶ Sitemaps...");
  const sitemapOpts = { headers: { "Accept": "text/xml" }, warmRepeat: false };
  results.push(await bench("sitemap.xml", `${B}/sitemap.xml`, sitemapOpts));
  results.push(await bench("sitemap-static.xml", `${B}/sitemap-static.xml`, sitemapOpts));
  results.push(await bench("sitemap-collections.xml", `${B}/sitemap-collections.xml`, sitemapOpts));
  results.push(await bench("sitemap-skins.xml", `${B}/sitemap-skins.xml`, sitemapOpts));
  results.push(await bench("sitemap-tradeups.xml", `${B}/sitemap-tradeups.xml`, sitemapOpts));
  results.push(await bench("sitemap-collection-tradeups.xml", `${B}/sitemap-collection-tradeups.xml`, sitemapOpts));

  return results;
}

// ── Output ────────────────────────────────────────────────────────────────────

function formatMs(ms: number): string {
  if (ms >= CRITICAL_MS) return `\x1b[31m${ms}ms\x1b[0m`; // red
  if (ms >= SLOW_MS) return `\x1b[33m${ms}ms\x1b[0m`;     // yellow
  return `\x1b[32m${ms}ms\x1b[0m`;                          // green
}

function printTable(results: BenchResult[]): void {
  // Sort slowest cold time first
  const sorted = [...results].sort((a, b) => b.cold_ms - a.cold_ms);

  const SLOW = sorted.filter(r => r.cold_ms >= SLOW_MS || r.flags.includes("ERROR"));
  const OK = sorted.filter(r => r.cold_ms < SLOW_MS && !r.flags.includes("ERROR"));

  console.log("\n" + "═".repeat(100));
  console.log("  TRADEUPBOT API BENCHMARK RESULTS");
  console.log("  Base: " + BASE + "   " + new Date().toISOString());
  console.log("═".repeat(100));

  console.log("\n🔴 SLOW / ERROR (>1s or error):\n");
  if (SLOW.length === 0) {
    console.log("  None! Everything under 1s.");
  } else {
    printRows(SLOW);
  }

  console.log("\n✅ FAST (<1s):\n");
  printRows(OK);

  // Summary
  const critical = results.filter(r => r.cold_ms >= CRITICAL_MS).length;
  const slow = results.filter(r => r.cold_ms >= SLOW_MS && r.cold_ms < CRITICAL_MS).length;
  const errors = results.filter(r => r.flags.includes("ERROR")).length;
  const fast = results.filter(r => r.cold_ms < SLOW_MS && !r.flags.includes("ERROR")).length;
  const total = results.length;
  const avgMs = Math.round(results.reduce((s, r) => s + r.cold_ms, 0) / total);

  console.log("\n" + "─".repeat(100));
  console.log(`  Total: ${total}  |  Critical(>5s): ${critical}  |  Slow(1-5s): ${slow}  |  Errors: ${errors}  |  Fast: ${fast}  |  Avg: ${avgMs}ms`);
  console.log("─".repeat(100) + "\n");
}

function printRows(rows: BenchResult[]): void {
  const header = `  ${"LABEL".padEnd(42)} ${"COLD".padStart(8)} ${"WARM".padStart(8)}  ${"STATUS".padStart(6)}  FLAGS`;
  console.log(header);
  console.log("  " + "─".repeat(96));
  for (const r of rows) {
    const label = r.label.length > 41 ? r.label.substring(0, 38) + "..." : r.label.padEnd(42);
    const cold = formatMs(r.cold_ms).padStart(8 + 10); // ANSI adds chars
    const warmRaw = r.warm_ms !== null ? `${r.warm_ms}ms` : "n/a";
    const warm = (r.warm_ms !== null && r.warm_ms >= SLOW_MS
      ? `\x1b[33m${warmRaw}\x1b[0m`
      : warmRaw).padStart(8);
    const status = String(r.status || "ERR").padStart(6);
    const flags = r.flags.length ? " ⚠️  " + r.flags.join(", ") : "";
    const cached = r.cached ? " [CACHE HIT]" : "";
    const err = r.error ? ` ← ${r.error}` : "";
    console.log(`  ${label} ${cold} ${warm}  ${status}${cached}${flags}${err}`);
  }
}

// ── JSON export ───────────────────────────────────────────────────────────────

function exportJson(results: BenchResult[]): void {
  const outPath = new URL("../bench-results.json", import.meta.url).pathname;
  const data = {
    base: BASE,
    ran_at: new Date().toISOString(),
    slow_threshold_ms: SLOW_MS,
    critical_threshold_ms: CRITICAL_MS,
    results: results.sort((a, b) => b.cold_ms - a.cold_ms),
  };
  import("fs").then(fs => {
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
    console.log(`  JSON results written to bench-results.json`);
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log(`\n🏁 Starting benchmark against ${BASE}...\n`);
const results = await runAll();
printTable(results);
exportJson(results);

// Print focused slow endpoint analysis
const slowEndpoints = results.filter(r => r.cold_ms >= 2000).sort((a, b) => b.cold_ms - a.cold_ms);
if (slowEndpoints.length > 0) {
  console.log("\n📋 ENDPOINTS OVER 2s (need EXPLAIN ANALYZE):\n");
  for (const r of slowEndpoints) {
    console.log(`  ${r.cold_ms}ms  ${r.method} ${r.url}`);
  }
  console.log();
}
