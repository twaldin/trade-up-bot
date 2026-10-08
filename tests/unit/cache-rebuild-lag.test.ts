import { monitorEventLoopDelay } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { buildPriceCache, FLOAT_CEILING_FETCH_BATCH, resetPriceCacheForTests } from "../../server/engine/pricing.js";

const N = 1_000_000;

describe("calculator rebuild event-loop lag", () => {
  afterEach(() => {
    resetPriceCacheForTests();
    vi.restoreAllMocks();
  });

  it("stays under 100ms while paging a million ceiling rows", async () => {
    resetPriceCacheForTests();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    let fullScan = false;
    let pages = 0;
    let offset = 0;
    const client = {
      query: async (sql: string) => {
        const text = String(sql).trim();
        if (/^(BEGIN|COMMIT|ROLLBACK|CLOSE)\b/i.test(text)) return { rows: [] };
        if (/^DECLARE\b/i.test(text)) {
          if (!text.includes("COALESCE(l.source, 'csfloat')") || text.includes("UNION") || /\bLIMIT\b/i.test(text)) {
            fullScan = true;
          }
          offset = 0;
          return { rows: [] };
        }
        if (/^FETCH\b/i.test(text)) {
          pages++;
          const match = /^FETCH\s+(\d+)\s+FROM\b/i.exec(text);
          const limit = match ? Number(match[1]) : 0;
          if (!(limit > 0 && limit < N)) {
            fullScan = true;
            return { rows: [] };
          }
          const count = Math.min(limit, Math.max(0, N - offset));
          const rows = [];
          for (let i = 0; i < count; i++) {
            rows.push({
              skin_name: "Buff Skin",
              float_value: 0.2,
              price_cents: 100,
              source: "buff",
            });
          }
          offset += count;
          return { rows };
        }
        throw new Error(`unexpected cursor sql: ${text.slice(0, 120)}`);
      },
      release: () => {},
    };
    const pool = {
      connect: async () => client,
      query: async (sql: string) => {
        const text = String(sql);
        if (text.includes("source = 'csfloat_ref' AND volume")) {
          return {
            rows: [{
              skin_name: "AK-47 | Redline",
              condition: "Field-Tested",
              min_price_cents: 1500,
              median_price_cents: 1500,
              volume: 10,
            }],
          };
        }
        return { rows: [] };
      },
    };

    const histogram = monitorEventLoopDelay({ resolution: 10 });
    histogram.enable();
    await delay(20);
    await buildPriceCache(pool as pg.Pool, true);
    await delay(40);
    const maxMs = histogram.max / 1e6;
    histogram.disable();
    console.info(`event-loop max lag during ceiling rebuild: ${maxMs.toFixed(1)} ms over ${pages} pages`);

    expect(fullScan).toBe(false);
    expect(pages).toBeGreaterThan(1);
    expect(limitWasPaged(pages)).toBe(true);
    expect(histogram.max).toBeGreaterThan(0);
    expect(maxMs).toBeLessThan(100);
  }, 30_000);
});

function limitWasPaged(pages: number): boolean {
  return pages > Math.ceil(N / FLOAT_CEILING_FETCH_BATCH);
}
