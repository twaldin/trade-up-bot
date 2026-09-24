#!/usr/bin/env tsx
/**
 * Replays a first-session board visit the way the console client does it:
 * list page → per-row outcomes/inputs hydrate (only when the list row came
 * back without them) → one faces batch. Reports requests and wall time per
 * page so QA can compare request fan-out against the 120/min per-IP limiter.
 *
 * Usage:
 *   npx tsx scripts/board-session-bench.ts                         # live site, 4 pages
 *   npx tsx scripts/board-session-bench.ts --base=http://localhost:3001 --pages=6
 */

const BASE = process.argv.find((a) => a.startsWith("--base="))?.split("=")[1] ?? "https://tradeupbot.app";
const PAGES = Number(process.argv.find((a) => a.startsWith("--pages="))?.split("=")[1] ?? 4);
const PER_PAGE = 12;

interface Row { id: number; outcomes?: { skin_name: string }[]; inputs?: { skin_name: string }[] }

let requests = 0;
let limited = 0;

async function get(path: string): Promise<{ status: number; body: unknown; ms: number; cache: string | null; bytes: number }> {
  requests++;
  const t0 = performance.now();
  const res = await fetch(`${BASE}${path}`, { headers: { "User-Agent": "TradeUpBotBoardBench/1.0" } });
  const text = await res.text();
  const ms = performance.now() - t0;
  if (res.status === 429) limited++;
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, ms, cache: res.headers.get("x-cache"), bytes: text.length };
}

function rowsOf(body: unknown): Row[] {
  if (!body || typeof body !== "object" || !("trade_ups" in body)) return [];
  const rows = body.trade_ups;
  return Array.isArray(rows) ? rows : [];
}

const query = `per_page=${PER_PAGE}&sort=trade_up_score&order=desc&include=outcomes,inputs`;
console.log(`Board session bench → ${BASE}  (${PAGES} pages × ${PER_PAGE})\n`);
console.log("page  list_ms  x-cache    list_kB  hydrate_reqs  page_reqs  page_wall_ms");

const sessionStart = performance.now();
for (let page = 1; page <= PAGES; page++) {
  const before = requests;
  const t0 = performance.now();
  const list = await get(`/api/trade-ups?${query}&page=${page}`);
  const rows = rowsOf(list.body);
  const hydrated = await Promise.all(rows.map(async (row) => {
    const [outcomes, inputs] = await Promise.all([
      row.outcomes && row.outcomes.length > 0
        ? Promise.resolve(row.outcomes)
        : get(`/api/trade-up/${row.id}/outcomes`).then((r) => (r.body as { outcomes?: Row["outcomes"] })?.outcomes ?? []),
      row.inputs && row.inputs.length > 0
        ? Promise.resolve(row.inputs)
        : get(`/api/trade-up/${row.id}/inputs`).then((r) => (r.body as { inputs?: Row["inputs"] })?.inputs ?? []),
    ]);
    return { ...row, outcomes, inputs };
  }));
  const hydrateReqs = requests - before - 1;
  const names = [...new Set(hydrated.flatMap((r) => [...(r.inputs ?? []), ...(r.outcomes ?? [])].map((x) => x.skin_name)))];
  if (names.length > 0) await get(`/api/preview/faces?names=${encodeURIComponent(names.join("||"))}`);
  const wall = performance.now() - t0;
  console.log(
    `${String(page).padEnd(6)}${list.ms.toFixed(0).padStart(7)}  ${(list.cache ?? "-").padEnd(9)}  ${(list.bytes / 1024).toFixed(1).padStart(7)}  ${String(hydrateReqs).padStart(12)}  ${String(requests - before).padStart(9)}  ${wall.toFixed(0).padStart(12)}`,
  );
}
const total = performance.now() - sessionStart;
console.log(`\nTotal: ${requests} requests in ${total.toFixed(0)}ms (${limited} × 429). Per-IP budget is 120/min.`);
