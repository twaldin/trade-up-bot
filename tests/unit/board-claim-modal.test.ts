/**
 * @vitest-environment happy-dom
 *
 * Board claim is the activation path. A new tab is what mobile drops and what
 * makes desktop a second click. The expanded control must open the claim modal
 * in place, and claim_trade_up fires once per successful claim.
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { PreviewBoard } from "../../src/preview/pages/PreviewBoard.js";
import { claimReturnTo } from "../../src/preview/lib/board.js";
import { makeTradeUp } from "../helpers/fixtures.js";

const GA4 = "G-NEWPROP123";
let gtag: Mock<NonNullable<typeof globalThis.gtag>>;

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function claimCalls(fetchMock: ReturnType<typeof vi.fn>): number {
  return fetchMock.mock.calls.filter((call) => {
    const url = String(call[0]);
    const init = call[1] as RequestInit | undefined;
    return url.includes("/claim") && init?.method === "POST";
  }).length;
}

function claimEvents(): unknown[][] {
  return gtag.mock.calls.filter((call) => call[1] === "claim_trade_up");
}

describe("board claim opens in place", () => {
  let root: Root;
  let host: HTMLDivElement;
  const opened: unknown[] = [];

  beforeEach(() => {
    opened.length = 0;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    globalThis.tubTracking = { ga4MeasurementId: GA4 };
    gtag = vi.fn<NonNullable<typeof globalThis.gtag>>();
    globalThis.gtag = gtag;
    globalThis.fbq = vi.fn();
    window.open = ((url?: string | URL) => {
      opened.push(url);
      return null;
    }) as typeof window.open;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    globalThis.gtag = undefined;
    globalThis.fbq = undefined;
    globalThis.tubTracking = undefined;
    vi.unstubAllGlobals();
  });

  const onExpand = vi.fn();

  function PathMark() {
    const location = useLocation();
    return createElement("span", { id: "path-mark" }, location.pathname);
  }

  async function renderBoard(opts: {
    id: number;
    expanded: boolean;
    isFree: boolean;
    signedIn?: boolean;
    tier?: string;
    claimed?: boolean;
    claimStatus?: number;
    claimBody?: unknown;
  }) {
    onExpand.mockClear();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/claim") && init?.method === "POST") {
        return jsonResponse(opts.claimStatus ?? 200, opts.claimBody ?? { claim: { expires_at: "2099-01-01T00:00:00.000Z" } });
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);
    const tu = makeTradeUp({ id: opts.id, ...(opts.claimed ? { claimed_by_me: true } : {}) });
    const signedIn = "signedIn" in opts ? opts.signedIn : !opts.isFree;
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement("div", null,
        createElement(PathMark),
        createElement(PreviewBoard, {
          tradeUps: [tu],
          loading: false,
          isFree: opts.isFree,
          signedIn,
          tier: opts.tier ?? (opts.isFree ? "free" : "pro"),
          expandedId: opts.expanded ? opts.id : null,
          onExpand,
        }),
      ) as ReactNode));
    });
    return fetchMock;
  }

  function confirmButton(): HTMLButtonElement | null {
    return [...host.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Confirm") ?? null;
  }

  async function confirmClaim() {
    await act(async () => { confirmButton()?.click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  }

  function claimButton(): HTMLButtonElement | null {
    return [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Verify / Claim trade-up")) ?? null;
  }

  it("builds a same-origin return path for the trade-up the person tapped", () => {
    expect(claimReturnTo(42)).toBe("/trade-ups/42");
    expect(claimReturnTo(0)).toBe("/trade-ups");
    expect(claimReturnTo(1.5)).toBe("/trade-ups");
  });

  it("opens the claim modal in place from an expanded card and does not claim yet", async () => {
    const fetchMock = await renderBoard({ id: 390, expanded: true, isFree: true });
    const button = claimButton();
    expect(button).toBeTruthy();
    expect(button?.tagName).toBe("BUTTON");
    expect(button?.getAttribute("href")).toBeNull();
    expect(button?.getAttribute("target")).toBeNull();
    expect(host.textContent).not.toContain("Opens the live trade-up on tradeupbot.app.");

    await act(async () => { button?.click(); });

    const dialog = document.querySelector("dialog");
    expect(dialog?.open).toBe(true);
    expect(dialog?.textContent).toContain("Verify and claim this trade-up");
    expect(dialog?.querySelector("a.preview-sheet__go")?.getAttribute("href")).toBe("/auth/steam?return=%2Ftrade-ups%2F390");
    expect(opened).toEqual([]);
    expect(claimCalls(fetchMock)).toBe(0);
    expect(claimEvents()).toEqual([]);
    expect(onExpand).not.toHaveBeenCalled();
  });

  it("keeps a second tap on the open modal from navigating away", async () => {
    await renderBoard({ id: 391, expanded: true, isFree: true });
    const button = claimButton();
    await act(async () => { button?.click(); });
    await act(async () => { button?.click(); });
    expect(document.querySelectorAll("dialog").length).toBe(1);
    expect(document.querySelector("dialog")?.open).toBe(true);
    expect(opened).toEqual([]);
    expect(claimEvents()).toEqual([]);
  });

  it("labels the collapsed control Details and records the board_card click", async () => {
    await renderBoard({ id: 392, expanded: false, isFree: true });
    const link = host.querySelector(".preview-cardline__verify");
    expect(link?.textContent).toContain("Details");
    expect(link?.textContent).not.toContain("Verify");
    expect(link?.textContent).not.toContain("Open");
    expect(link?.getAttribute("aria-label")).toBe("Trade-up details");
    expect(link?.getAttribute("href")).toBe("https://tradeupbot.app/trade-ups/392");
    await act(async () => { (link as HTMLAnchorElement).click(); });
    expect(gtag.mock.calls.some((call) => call[1] === "verify_click" && (call[2] as { surface?: string }).surface === "board_card")).toBe(true);
    expect(claimButton()).toBeNull();
  });

  it("asks a Pro viewer to confirm before claiming, then fires claim_trade_up once", async () => {
    const fetchMock = await renderBoard({ id: 1280, expanded: true, isFree: false });
    const button = claimButton();
    await act(async () => { button?.click(); });

    expect(document.querySelector("dialog")?.open).not.toBe(true);
    expect(host.textContent).toContain("Claim for 30 min?");
    expect(confirmButton()?.textContent).toBe("Confirm");
    expect([...host.querySelectorAll("button")].some((node) => node.textContent?.trim() === "Cancel")).toBe(true);
    expect(claimCalls(fetchMock)).toBe(0);
    expect(claimEvents()).toEqual([]);

    await confirmClaim();

    expect(claimCalls(fetchMock)).toBe(1);
    expect(host.textContent).toContain("Claimed");
    expect(claimEvents()).toEqual([[
      "event",
      "claim_trade_up",
      expect.objectContaining({
        surface: "board",
        trade_up_id: "1280",
        send_to: GA4,
      }),
    ]]);
    expect(JSON.stringify(claimEvents())).not.toMatch(/price|listing_id|steam_id/);

    await act(async () => { claimButton()?.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(claimCalls(fetchMock)).toBe(1);
    expect(claimEvents()).toHaveLength(1);
    expect(opened).toEqual([]);
  });

  it("leaves the claim unsent when the Pro viewer cancels", async () => {
    const fetchMock = await renderBoard({ id: 1282, expanded: true, isFree: false });
    await act(async () => { claimButton()?.click(); });
    const cancel = [...host.querySelectorAll("button")].find((node) => node.textContent?.trim() === "Cancel");
    await act(async () => { cancel?.click(); });
    expect(host.textContent).not.toContain("Claim for 30 min?");
    expect(claimCalls(fetchMock)).toBe(0);
    expect(claimEvents()).toEqual([]);
  });

  it("sends a signed-in Free viewer to pricing instead of the Steam modal", async () => {
    const fetchMock = await renderBoard({ id: 393, expanded: true, isFree: true, signedIn: true, tier: "free" });
    await act(async () => { claimButton()?.click(); });
    expect(document.querySelector("dialog")?.open).not.toBe(true);
    expect(host.textContent).not.toContain("Claim for 30 min?");
    expect(claimCalls(fetchMock)).toBe(0);
    expect(claimEvents()).toEqual([]);
    expect(gtag.mock.calls.filter((call) => call[1] === "upgrade_cta_click")).toEqual([[
      "event",
      "upgrade_cta_click",
      expect.objectContaining({ cta: "board_claim", send_to: GA4 }),
    ]]);
    expect(host.querySelector("#path-mark")?.textContent).toBe("/pricing");
    expect(opened).toEqual([]);
  });

  it("does nothing with the claim control until signed_in is known", async () => {
    const fetchMock = await renderBoard({ id: 394, expanded: true, isFree: true, signedIn: undefined });
    await act(async () => { claimButton()?.click(); });
    expect(document.querySelector("dialog")?.open).not.toBe(true);
    expect(claimCalls(fetchMock)).toBe(0);
    expect(host.querySelector("#path-mark")?.textContent).toBe("/");
  });

  it("shows Claimed for a trade-up the viewer already claimed", async () => {
    const fetchMock = await renderBoard({ id: 395, expanded: true, isFree: false, claimed: true });
    expect(host.textContent).toContain("Claimed");
    expect(claimButton()?.disabled).toBe(true);
    await act(async () => { claimButton()?.click(); });
    expect(host.textContent).not.toContain("Claim for 30 min?");
    expect(claimCalls(fetchMock)).toBe(0);
  });

  it("pushes a history entry when the sign-in modal opens so back closes it", async () => {
    await renderBoard({ id: 396, expanded: true, isFree: true, signedIn: false });
    const before = window.history.length;
    await act(async () => { claimButton()?.click(); });
    expect(document.querySelector("dialog")?.open).toBe(true);
    expect(window.history.length).toBe(before + 1);
    await act(async () => { window.history.back(); });
    expect(document.querySelector("dialog")?.open).toBe(false);
  });

  it("does not fire claim_trade_up when the claim request fails", async () => {
    const fetchMock = await renderBoard({
      id: 1281,
      expanded: true,
      isFree: false,
      claimStatus: 403,
      claimBody: { error: "Pro required" },
    });
    await act(async () => { claimButton()?.click(); });
    expect(claimCalls(fetchMock)).toBe(0);
    await confirmClaim();
    expect(claimCalls(fetchMock)).toBe(1);
    expect(claimEvents()).toEqual([]);
    expect(host.textContent).toContain("Verify and Claim need Pro.");
    expect(host.textContent).not.toContain("Pro required");
    expect(document.querySelector("dialog")?.open).not.toBe(true);
  });
});
