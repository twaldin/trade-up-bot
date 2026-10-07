/**
 * @vitest-environment happy-dom
 *
 * QA 206 B1 (client path): the live landing passes board counts to the hero
 * through onBoardCounts. A deduped board must not fill the hero tiles when
 * global-stats is missing or zero.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeTradeUp } from "../helpers/fixtures.js";
import PreviewApp from "../../src/preview/PreviewApp.js";

function json(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body, text: async () => JSON.stringify(body), headers: new Headers() };
}

describe("landing hero with a deduped board", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    host?.remove();
    root = null;
    host = null;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function mount(global: unknown, board: Record<string, unknown>) {
    // happy-dom rejects canceled animations on unmount; the hero has none to test.
    vi.spyOn(Element.prototype, "animate").mockImplementation(() => ({
      cancel() {}, finish() {}, play() {}, pause() {}, finished: Promise.resolve(), onfinish: null,
      addEventListener() {}, removeEventListener() {},
    }) as unknown as Animation);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/global-stats")) return json(global);
      if (url.includes("/api/trade-ups")) {
        return json({ trade_ups: [makeTradeUp({ id: 1 }), makeTradeUp({ id: 2 })], tier: "free", ...board });
      }
      return json({});
    }));
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(createElement(MemoryRouter, { initialEntries: ["/"] }, createElement(PreviewApp)));
    });
    for (let i = 0; i < 10; i++) {
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    }
    return host.innerHTML;
  }

  const deduped = { total: 213, total_profitable: 1, deduped: true, raw_total: 10001, total_profitable_capped: false };

  for (const [label, global] of [["missing", null], ["zero", { total_trade_ups: 0, profitable_trade_ups: 0 }]] as const) {
    it(`renders no hero tiles from the deduped board when global-stats is ${label}`, async () => {
      const html = await mount(global, deduped);
      expect(html).not.toContain("positive EV");
      expect(html).not.toMatch(/<b>213<\/b>/);
      expect(html).not.toMatch(/<b>1<\/b>/);
      expect(html).not.toContain("10,001");
    });
  }

  it("control: a plain (non-deduped, uncapped) board still fills the hero fallback", async () => {
    const html = await mount(null, { total: 213, total_profitable: 7 });
    expect(html).toMatch(/<b>213<\/b>/);
  });

  it("keeps the 10,001 drop for a capped non-deduped board", async () => {
    const html = await mount(null, { total: 10001, total_profitable: 52 });
    expect(html).not.toContain("10,001");
    expect(html).not.toMatch(/<b>10001<\/b>/);
  });
});

describe("trade-ups-board parses the board flags", () => {
  it("carries deduped and total_profitable_capped into the payload and snapshot", async () => {
    const { parseTradeUpsResponse, applyBoardFetch } = await import("../../src/lib/trade-ups-board.js");
    const res = parseTradeUpsResponse(200, true, { trade_ups: [], total: 213, total_profitable: 1, deduped: true, total_profitable_capped: false });
    expect(res.kind).toBe("ok");
    if (res.kind !== "ok") return;
    expect(res.payload.deduped).toBe(true);
    expect(res.payload.total_profitable_capped).toBeUndefined();
    const snap = applyBoardFetch({ tradeUps: [], total: 0, totalProfitable: 0, loadKind: "ok" }, res);
    expect(snap.deduped).toBe(true);
    expect(snap.totalProfitableCapped).toBe(false);
    const capped = parseTradeUpsResponse(200, true, { trade_ups: [], total: 10001, total_profitable: 10001, total_profitable_capped: true });
    expect(capped.kind === "ok" && capped.payload.total_profitable_capped).toBe(true);
    expect(capped.kind === "ok" && capped.payload.deduped).toBeUndefined();
  });
});
