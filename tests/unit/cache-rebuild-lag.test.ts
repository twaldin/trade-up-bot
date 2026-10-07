import { monitorEventLoopDelay } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { REBUILD_FETCH_SIZE } from "../../server/engine/event-loop.js";
import { buildPriceCache, resetPriceCacheForTests } from "../../server/engine/pricing.js";

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
    const pool = {
      query: async (sql: string, params?: unknown[]) => {
        const text = String(sql);
        if (text.includes("UNION ALL")) {
          pages++;
          const after = params?.[0];
          const limit = params?.[1];
          const start = typeof after === "string" ? Number(after) + 1 : 0;
          if (typeof limit !== "number" || !(limit > 0 && limit < N)) {
            fullScan = true;
            return {
              rows: Array.from({ length: N }, (_, id) => ({
                skin_name: "Buff Skin",
                float_value: 0.2,
                price_cents: 100,
                source: "buff",
                listing_id: String(id),
              })),
            };
          }
          const count = Math.min(limit, Math.max(0, N - start));
          const rows = [];
          for (let i = 0; i < count; i++) {
            const id = start + i;
            rows.push({
              skin_name: "Buff Skin",
              float_value: 0.2,
              price_cents: 100,
              source: "buff",
              listing_id: String(id),
            });
          }
          return { rows };
        }
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
  return pages > Math.ceil(N / REBUILD_FETCH_SIZE);
}
