/**
 * @vitest-environment happy-dom
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOAD_ERROR_COPY } from "../../src/preview/lib/board-notice.js";
import { landingStatsFromSources, visibleLandingStatTiles } from "../../src/preview/lib/landing-stats.js";
import { HERO_STILL_LOADING } from "../../src/preview/lib/copy.js";
import { RATE_LIMIT_MANUAL_COPY, resetBrowseFetchState } from "../../src/preview/lib/page-fetch.js";
import {
  HERO_SLOW_AFTER_MS,
  LandingHero,
  PreviewLanding,
  heroLoadPhase,
} from "../../src/preview/pages/PreviewLanding.js";
import { makeTradeUp } from "../helpers/fixtures.js";

const BANNED = ["chance", "odds", "win", "jackpot", "gamble", "bet", "lucky", "roll", "bankroll", "risk-free"];

function visibleText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .toLowerCase();
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function heroHtml(props: Partial<Parameters<typeof LandingHero>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(LandingHero, {
      tu: null,
      loading: true,
      isFree: true,
      ...props,
    })),
  );
}

describe("hero load phase", () => {
  it("stays a skeleton until the board is slow, then names throttle and error ahead of that", () => {
    expect(HERO_SLOW_AFTER_MS).toBe(8_000);
    expect(heroLoadPhase({ hasTradeUp: false, throttled: false, failed: false, loading: true, slow: false })).toBe("skeleton");
    expect(heroLoadPhase({ hasTradeUp: false, throttled: false, failed: false, loading: true, slow: true })).toBe("slow");
    expect(heroLoadPhase({ hasTradeUp: false, throttled: true, failed: false, loading: true, slow: true })).toBe("throttled");
    expect(heroLoadPhase({ hasTradeUp: false, throttled: false, failed: true, loading: false, slow: false })).toBe("error");
    expect(heroLoadPhase({ hasTradeUp: true, throttled: true, failed: false, loading: false, slow: false })).toBe("ready");
    expect(heroLoadPhase({ hasTradeUp: false, throttled: false, failed: false, loading: false, slow: false })).toBe("empty");
  });
});

describe("landing hero copy", () => {
  it("uses a skeleton instead of the loading sentences, and hides the empty chart while the board is in flight", () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(PreviewLanding, { stats: null })));
    expect(html).toContain("preview-proof__skeleton");
    expect(html).toContain("preview-hero__card-skeleton");
    expect(html).toContain("preview-live__skeleton");
    expect(html).toContain("preview-hero__plot-skeleton");
    expect(html).not.toContain("Loading the top trade-up on the board");
    expect(html).not.toContain("Loading trade-ups");
    expect(html).not.toContain("No output skin to plot yet");
    expect(html).not.toContain(HERO_STILL_LOADING);
  });

  it("says the board is still loading after the wait, with a retry control", () => {
    const html = heroHtml({ slow: true });
    expect(html).toContain("preview-hero__card-skeleton");
    expect(html).toContain(HERO_STILL_LOADING);
    expect(html).toContain("preview-hero__retry");
    expect(html).toContain(">Retry<");
    const text = visibleText(html);
    for (const word of BANNED) {
      expect(text, word).not.toMatch(new RegExp(`\\b${word}\\b`));
    }
  });

  it("shows the manual throttle copy on a 429 and the load error copy on a failure", () => {
    const throttled = heroHtml({ loading: false, throttled: true });
    expect(throttled).toContain(RATE_LIMIT_MANUAL_COPY);
    expect(throttled).not.toContain("preview-hero__card-skeleton");
    expect(throttled).not.toContain("Loading trade-ups");
    const failed = heroHtml({ loading: false, failed: true });
    expect(failed.replaceAll("&#x27;", "'")).toContain(LOAD_ERROR_COPY);
    expect(failed).toContain("preview-hero__retry");
    expect(failed).not.toContain(RATE_LIMIT_MANUAL_COPY);
  });

  it("prints the created time and keeps 100% only for an exact share", () => {
    const created = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const almost = makeTradeUp({
      id: 11,
      created_at: created,
      outcomes: makeTradeUp().outcomes.map((row) => ({ ...row, probability: 0.996 })),
    });
    const exact = makeTradeUp({ id: 12, created_at: created });
    const almostHtml = heroHtml({ tu: almost, loading: false });
    const exactHtml = heroHtml({ tu: exact, loading: false });
    expect(almostHtml).toContain("2h ago");
    expect(almostHtml).toContain(`<time dateTime="${created}">2h ago</time>`);
    expect(almostHtml).toContain("&gt;99%");
    expect(almostHtml).not.toContain("100%");
    expect(almostHtml).toContain('href="/trade-ups/11"');
    expect(almostHtml).toContain("Outcomes above cost");
    expect(almostHtml).toContain("Expected P/L");
    expect(exactHtml).toContain("100%");
    const text = visibleText(almostHtml);
    for (const word of BANNED) {
      expect(text, word).not.toMatch(new RegExp(`\\b${word}\\b`));
    }
  });
});

describe("landing hero counts", () => {
  it("does not render a deduped board profitable count of 1", () => {
    const stats = landingStatsFromSources({
      board: { total: 1000, total_profitable: 1, deduped: true, trade_ups: [makeTradeUp()] },
    });
    const html = heroHtml({
      loading: false,
      statTiles: visibleLandingStatTiles(stats),
    });
    expect(html).not.toContain("positive EV");
    expect(html).not.toContain(">1<");
    expect(html).not.toContain("1 profitable");
  });

  it("renders the 10001 sentinel as 10,000+ through LandingHero and never prints 10,001", () => {
    const html = heroHtml({
      loading: false,
      statTiles: [
        { key: "total_trade_ups", label: "trade-ups", value: 10_001 },
        { key: "profitable_trade_ups", label: "positive EV", value: 90_700 },
        { key: "total_data_points", label: "data points", value: 2_405_119 },
      ],
    });
    expect(html).toContain("<b>10,000+</b>");
    expect(html).toContain("<b>90,700</b>");
    expect(html).toContain("<b>2,405,119</b>");
    expect(html).not.toContain("10,001");
    expect(html).not.toContain("10001");
  });
});

describe("landing hero behavior", () => {
  let root: Root;
  let host: HTMLDivElement;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    resetBrowseFetchState();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    globalThis.gtag = undefined;
    globalThis.tubTracking = undefined;
  });

  async function mount(node: ReturnType<typeof createElement>) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root.render(node); });
  }

  it("keeps the skeleton and the empty chart hidden until 8s, then offers retry", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    await mount(createElement(MemoryRouter, null, createElement(PreviewLanding, { stats: null })));
    expect(host.querySelector(".preview-hero__card-skeleton")).not.toBeNull();
    expect(host.textContent).not.toContain("No output skin to plot yet");
    expect(host.textContent).not.toContain("Loading the top trade-up on the board");
    expect(host.textContent).not.toContain("Loading trade-ups");
    expect(host.textContent).not.toContain(HERO_STILL_LOADING);
    await act(async () => { vi.advanceTimersByTime(HERO_SLOW_AFTER_MS); });
    expect(host.textContent).toContain(HERO_STILL_LOADING);
    expect(host.querySelector(".preview-hero__retry")).not.toBeNull();
    expect(host.textContent).not.toContain("No output skin to plot yet");
  });

  it("shows the throttle copy when the board answers 429", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 429,
      headers: { get: () => null },
      json: async () => ({ message: "Too many requests, please try again later." }),
    })));
    await mount(createElement(MemoryRouter, null, createElement(PreviewLanding, { stats: null })));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(host.textContent).toContain(RATE_LIMIT_MANUAL_COPY);
    expect(host.textContent).not.toContain("Loading trade-ups");
    expect(host.textContent).not.toContain("No output skin to plot yet");
  });

  it("shows the load error copy when the board request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 500,
      headers: { get: () => null },
      json: async () => null,
    })));
    await mount(createElement(MemoryRouter, null, createElement(PreviewLanding, { stats: null })));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(host.textContent).toContain(LOAD_ERROR_COPY);
    expect(host.textContent).not.toContain(RATE_LIMIT_MANUAL_COPY);
  });

  it("fires cta_click home_hero_tradeup when the hero trade-up opens", async () => {
    globalThis.tubTracking = { ga4MeasurementId: "G-NEWPROP123" };
    globalThis.gtag = vi.fn();
    const tu = makeTradeUp({ id: 7 });
    await mount(createElement(MemoryRouter, null, createElement(LandingHero, {
      tu,
      loading: false,
      isFree: false,
    })));
    const link = host.querySelector("a.preview-hero__open");
    expect(link?.getAttribute("href")).toBe("/trade-ups/7");
    await act(async () => { link?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(globalThis.gtag).toHaveBeenCalledWith("event", "cta_click", {
      cta: "home_hero_tradeup",
      page_path: "/",
      send_to: "G-NEWPROP123",
    });
  });
});
