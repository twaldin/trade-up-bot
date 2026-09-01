import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { makeTradeUp } from "../helpers/fixtures.js";
import {
  EMPTY_FILTER_COPY,
  LOAD_ERROR_COPY,
  RATE_LIMIT_COPY,
  RATE_LIMIT_MESSAGE,
  applyBoardFetch,
  backoffMs,
  boardEmptyKind,
  emptyStateCopy,
  parseTradeUpsResponse,
  runBoardFetchLoop,
} from "../../src/lib/trade-ups-board.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(__dir, "../../src/pages/TradeUpsPage.tsx"), "utf-8");

const RATE_LIMIT_BODY = { message: RATE_LIMIT_MESSAGE };

function emptySnapshot() {
  return { tradeUps: [] as ReturnType<typeof makeTradeUp>[], total: 0, totalProfitable: 0, loadKind: "ok" as const };
}

describe("parseTradeUpsResponse", () => {
  it("treats the live ~42-byte 429 body as rate-limited, not an empty page", () => {
    const result = parseTradeUpsResponse(429, false, RATE_LIMIT_BODY);
    expect(result.kind).toBe("rate_limited");
    expect(JSON.stringify(RATE_LIMIT_BODY).length).toBeLessThan(80);
    expect("trade_ups" in RATE_LIMIT_BODY).toBe(false);
  });

  it("treats status 429 with a non-JSON / empty body as rate-limited", () => {
    expect(parseTradeUpsResponse(429, false, null).kind).toBe("rate_limited");
    expect(parseTradeUpsResponse(429, false, "Too Many Requests").kind).toBe("rate_limited");
  });

  it("does not treat a 200 empty list as rate-limited", () => {
    const result = parseTradeUpsResponse(200, true, { trade_ups: [], total: 0 });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.payload.trade_ups).toEqual([]);
  });

  it("rejects a 200 without trade_ups so missing fields cannot become []", () => {
    expect(parseTradeUpsResponse(200, true, { message: RATE_LIMIT_MESSAGE }).kind).toBe("rate_limited");
    expect(parseTradeUpsResponse(200, true, { total: 12 }).kind).toBe("error");
    expect(parseTradeUpsResponse(500, false, { error: "boom" }).kind).toBe("error");
  });
});

describe("applyBoardFetch — keep last good rows", () => {
  const row = makeTradeUp({ id: 42, profit_cents: 150 });
  const prev = { tradeUps: [row], total: 17, totalProfitable: 4, loadKind: "ok" as const };

  it("keeps last good rows on 429 and does not replace them with []", () => {
    const next = applyBoardFetch(prev, parseTradeUpsResponse(429, false, RATE_LIMIT_BODY));
    expect(next.tradeUps).toEqual([row]);
    expect(next.tradeUps).not.toEqual([]);
    expect(next.total).toBe(17);
    expect(next.totalProfitable).toBe(4);
    expect(next.loadKind).toBe("rate_limited");
  });

  it("keeps last good rows on other non-OK responses", () => {
    const next = applyBoardFetch(prev, parseTradeUpsResponse(503, false, { error: "unavailable" }));
    expect(next.tradeUps).toEqual([row]);
    expect(next.loadKind).toBe("error");
  });

  it("replaces rows only when the response is OK and has trade_ups", () => {
    const fresh = makeTradeUp({ id: 99 });
    const next = applyBoardFetch(prev, parseTradeUpsResponse(200, true, {
      trade_ups: [fresh],
      total: 3,
      total_profitable: 2,
    }));
    expect(next.tradeUps).toEqual([fresh]);
    expect(next.total).toBe(3);
    expect(next.totalProfitable).toBe(2);
    expect(next.loadKind).toBe("ok");
  });

  it("allows a real empty filter result to clear the list", () => {
    const next = applyBoardFetch(prev, parseTradeUpsResponse(200, true, { trade_ups: [], total: 0 }));
    expect(next.tradeUps).toEqual([]);
    expect(next.loadKind).toBe("ok");
  });
});

describe("429 ≠ empty filter", () => {
  it("maps a 429 with no last-good rows to the rate-limit state, not empty-filter copy", () => {
    const next = applyBoardFetch(emptySnapshot(), parseTradeUpsResponse(429, false, RATE_LIMIT_BODY));
    const kind = boardEmptyKind({
      loading: false,
      tradeUps: next.tradeUps,
      loadKind: next.loadKind,
    });
    expect(kind).toBe("rate_limited");
    expect(kind).not.toBe("empty_filter");
    expect(emptyStateCopy(kind)).toBe(RATE_LIMIT_COPY);
    expect(emptyStateCopy(kind)).not.toBe(EMPTY_FILTER_COPY);
    expect(emptyStateCopy("empty_filter")).toBe(EMPTY_FILTER_COPY);
  });

  it("does not paint empty-filter when last-good rows exist after a 429", () => {
    const row = makeTradeUp({ id: 7 });
    const next = applyBoardFetch(
      { tradeUps: [row], total: 1, totalProfitable: 1, loadKind: "ok" },
      parseTradeUpsResponse(429, false, RATE_LIMIT_BODY),
    );
    expect(boardEmptyKind({
      loading: false,
      tradeUps: next.tradeUps,
      loadKind: next.loadKind,
    })).toBe("none");
    expect(next.tradeUps).toHaveLength(1);
  });

  it("still uses empty-filter copy for a genuine 200 with zero matches", () => {
    const next = applyBoardFetch(emptySnapshot(), parseTradeUpsResponse(200, true, { trade_ups: [], total: 0 }));
    expect(boardEmptyKind({
      loading: false,
      tradeUps: next.tradeUps,
      loadKind: next.loadKind,
    })).toBe("empty_filter");
    expect(emptyStateCopy("empty_filter")).toBe("No trade-ups match these filters.");
  });

  it("keeps the rate-limit state while a retry is in flight when there are no last-good rows", () => {
    expect(boardEmptyKind({
      loading: true,
      tradeUps: [],
      loadKind: "rate_limited",
    })).toBe("rate_limited");
    expect(boardEmptyKind({
      loading: true,
      tradeUps: [makeTradeUp({ id: 1 })],
      loadKind: "rate_limited",
    })).toBe("none");
  });

  it("maps a load error with no rows to retry copy, not empty-filter", () => {
    const next = applyBoardFetch(emptySnapshot(), parseTradeUpsResponse(500, false, null));
    const kind = boardEmptyKind({
      loading: false,
      tradeUps: next.tradeUps,
      loadKind: next.loadKind,
    });
    expect(kind).toBe("error");
    expect(emptyStateCopy(kind)).toBe(LOAD_ERROR_COPY);
    expect(emptyStateCopy(kind)).not.toBe(EMPTY_FILTER_COPY);
  });
});

describe("429 backoff retry", () => {
  it("does not tight-loop: each 429 doubles the wait, capped at 32s", () => {
    expect(backoffMs(0)).toBe(2_000);
    expect(backoffMs(1)).toBe(4_000);
    expect(backoffMs(2)).toBe(8_000);
    expect(backoffMs(3)).toBe(16_000);
    expect(backoffMs(4)).toBe(32_000);
    expect(backoffMs(9)).toBe(32_000);
  });

  it("retries 429 with backoff and applies the first OK page", async () => {
    const row = makeTradeUp({ id: 11 });
    const sleeps: number[] = [];
    const results: string[] = [];
    let calls = 0;
    const final = await runBoardFetchLoop({
      request: async () => {
        calls += 1;
        if (calls < 3) return { status: 429, ok: false, body: RATE_LIMIT_BODY };
        return { status: 200, ok: true, body: { trade_ups: [row], total: 1, total_profitable: 1 } };
      },
      sleep: async (ms) => { sleeps.push(ms); },
      onResult: (result) => { results.push(result.kind); },
    });
    expect(calls).toBe(3);
    expect(sleeps).toEqual([2_000, 4_000]);
    expect(results).toEqual(["rate_limited", "rate_limited", "ok"]);
    expect(final.kind).toBe("ok");
    if (final.kind !== "ok") throw new Error("expected ok");
    expect(final.payload.trade_ups).toEqual([row]);
  });

  it("stops retrying after maxAttempts and returns rate_limited, never an empty ok page", async () => {
    const final = await runBoardFetchLoop({
      request: async () => ({ status: 429, ok: false, body: RATE_LIMIT_BODY }),
      sleep: async () => {},
      maxAttempts: 3,
      onResult: () => {},
    });
    expect(final.kind).toBe("rate_limited");
    const applied = applyBoardFetch(emptySnapshot(), final);
    expect(boardEmptyKind({
      loading: false,
      tradeUps: applied.tradeUps,
      loadKind: applied.loadKind,
    })).not.toBe("empty_filter");
  });

  it("does not retry non-429 errors", async () => {
    let calls = 0;
    const final = await runBoardFetchLoop({
      request: async () => {
        calls += 1;
        return { status: 500, ok: false, body: { error: "fail" } };
      },
      sleep: async () => { throw new Error("should not sleep"); },
      onResult: () => {},
    });
    expect(calls).toBe(1);
    expect(final.kind).toBe("error");
  });
});

describe("TradeUpsPage wiring", () => {
  it("does not assign data.trade_ups without going through applyBoardFetch", () => {
    expect(page).not.toMatch(/setTradeUps\(data\.trade_ups\)/);
    expect(page).toContain("applyBoardFetch");
    expect(page).toContain("boardEmptyKind");
    expect(page).toContain("runBoardFetchLoop");
  });

  it("uses the shared empty-filter copy only for the empty_filter kind", () => {
    expect(page).toContain("EMPTY_FILTER_COPY");
    expect(page).toContain("RATE_LIMIT_COPY");
    expect(page).not.toMatch(/emptyKind === "empty_filter"[\s\S]*RATE_LIMIT_COPY/);
  });
});
