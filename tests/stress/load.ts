/**
 * Stress test: concurrent HTTP load against the trade-up bot API.
 *
 * Usage:
 *   npx tsx tests/stress/load.ts                    # localhost:3001
 *   npx tsx tests/stress/load.ts https://tradeupbot.app  # production
 *
 * Runs 200 total requests (50 concurrent) against GET /api/trade-ups
 * and GET /api/global-stats, measuring P50/P95/P99 response times.
 */

const BASE_URL = process.argv[2] || "http://localhost:3001";
const TOTAL_REQUESTS = 200;
const CONCURRENCY = 50;

interface RequestResult {
  url: string;
  status: number;
  durationMs: number;
  error?: string;
}

const ENDPOINTS = [
  "/api/trade-ups?type=covert_knife&per_page=10",
  "/api/trade-ups?type=classified_covert&per_page=10",
  "/api/trade-ups?type=covert_knife&per_page=50&sort=roi&order=desc",
  "/api/trade-ups?type=covert_knife&per_page=10&include_stale=true",
  "/api/global-stats",
];

async function makeRequest(url: string): Promise<RequestResult> {
  const start = performance.now();
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(30000),
    });
    const durationMs = performance.now() - start;
    // Consume body to properly complete the request
    await res.text();
    return { url, status: res.status, durationMs };
  } catch (e) {
    const durationMs = performance.now() - start;
    return { url, status: 0, durationMs, error: (e as Error).message };
  }
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function runBatch(urls: string[]): Promise<RequestResult[]> {
  return Promise.all(urls.map(url => makeRequest(url)));
}

async function main() {
  console.log(`\nStress Test: ${BASE_URL}`);
  console.log(`  Total requests: ${TOTAL_REQUESTS}`);
  console.log(`  Concurrency:    ${CONCURRENCY}`);
  console.log(`  Endpoints:      ${ENDPOINTS.length} variants\n`);

  // Warm up with a single request
  const warmup = await makeRequest(`${BASE_URL}/api/trade-ups?type=covert_knife&per_page=1`);
  if (warmup.error) {
    console.error(`Cannot reach ${BASE_URL}: ${warmup.error}`);
    console.error("Make sure the API server is running.");
    process.exit(1);
  }
  console.log(`Warmup: ${warmup.status} in ${warmup.durationMs.toFixed(0)}ms\n`);

  const allResults: RequestResult[] = [];
  const totalStart = performance.now();

  // Send requests in batches of CONCURRENCY
  for (let sent = 0; sent < TOTAL_REQUESTS; sent += CONCURRENCY) {
    const batchSize = Math.min(CONCURRENCY, TOTAL_REQUESTS - sent);
    const urls: string[] = [];
    for (let i = 0; i < batchSize; i++) {
      const endpoint = ENDPOINTS[(sent + i) % ENDPOINTS.length];
      urls.push(`${BASE_URL}${endpoint}`);
    }

    const batchResults = await runBatch(urls);
    allResults.push(...batchResults);

    const batchErrors = batchResults.filter(r => r.error || r.status >= 500).length;
    const batchAvg = batchResults.reduce((s, r) => s + r.durationMs, 0) / batchResults.length;
    process.stdout.write(
      `  Batch ${Math.floor(sent / CONCURRENCY) + 1}: ${batchResults.length} requests, ` +
      `avg ${batchAvg.toFixed(0)}ms, ${batchErrors} errors\n`
    );
  }

  const totalDuration = performance.now() - totalStart;

  // ─── Analyze Results ─────────────────────────────────────────────────

  const durations = allResults.map(r => r.durationMs).sort((a, b) => a - b);
  const errors = allResults.filter(r => r.error || r.status >= 500);
  const statusCounts = new Map<number, number>();
  for (const r of allResults) {
    statusCounts.set(r.status, (statusCounts.get(r.status) ?? 0) + 1);
  }

  console.log("\n─── Results ───────────────────────────────────────────");
  console.log(`  Total time:     ${(totalDuration / 1000).toFixed(1)}s`);
  console.log(`  Throughput:     ${(TOTAL_REQUESTS / (totalDuration / 1000)).toFixed(1)} req/s`);
  console.log(`  P50:            ${percentile(durations, 50).toFixed(0)}ms`);
  console.log(`  P95:            ${percentile(durations, 95).toFixed(0)}ms`);
  console.log(`  P99:            ${percentile(durations, 99).toFixed(0)}ms`);
  console.log(`  Min:            ${durations[0].toFixed(0)}ms`);
  console.log(`  Max:            ${durations[durations.length - 1].toFixed(0)}ms`);
  console.log(`  Error rate:     ${errors.length}/${TOTAL_REQUESTS} (${(errors.length / TOTAL_REQUESTS * 100).toFixed(1)}%)`);

  console.log("\n  Status codes:");
  for (const [status, count] of [...statusCounts.entries()].sort((a, b) => a[0] - b[0])) {
    const label = status === 0 ? "ERR" : String(status);
    console.log(`    ${label}: ${count}`);
  }

  // ─── Per-endpoint breakdown ───────────────────────────────────────────

  console.log("\n  Per-endpoint breakdown:");
  for (const endpoint of ENDPOINTS) {
    const endpointResults = allResults.filter(r => r.url.endsWith(endpoint));
    if (endpointResults.length === 0) continue;
    const endpointDurations = endpointResults.map(r => r.durationMs).sort((a, b) => a - b);
    const endpointErrors = endpointResults.filter(r => r.error || r.status >= 500).length;
    console.log(
      `    ${endpoint.substring(0, 55).padEnd(55)} ` +
      `P50=${percentile(endpointDurations, 50).toFixed(0)}ms ` +
      `P95=${percentile(endpointDurations, 95).toFixed(0)}ms ` +
      `err=${endpointErrors}`
    );
  }

  console.log();

  // Exit with error code if error rate > 5%
  if (errors.length / TOTAL_REQUESTS > 0.05) {
    console.error("FAIL: Error rate exceeds 5%");
    process.exit(1);
  }

  // Warn if P95 > 5s
  const p95 = percentile(durations, 95);
  if (p95 > 5000) {
    console.warn(`WARN: P95 response time is ${p95.toFixed(0)}ms (target: <5000ms)`);
  }

  console.log("PASS");
}

main().catch(e => {
  console.error("Stress test failed:", e);
  process.exit(1);
});
