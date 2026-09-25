/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from "vitest";
import { bindBoardScroll, boardScrollDelta, sentinelInView } from "../../src/preview/lib/board-scroll.js";
import { LIST_CAP_COPY, END_OF_LIST_COPY } from "../../src/preview/lib/board-notice.js";
import { listEndState } from "../../src/preview/lib/page-fetch.js";
import { isCacheableRead, usesSharedApiBucket } from "../../server/rate-limit-buckets.js";
import { faceNamesOnPage } from "../../server/routes/preview-faces.js";

function box(top: number, bottom: number): DOMRect {
  return {
    top, bottom, left: 0, right: 100, width: 100, height: bottom - top, x: 0, y: top,
    toJSON() { return {}; },
  } as DOMRect;
}

describe("board scroll reaches page 2", () => {
  let scroller: HTMLDivElement;
  let sentinel: HTMLDivElement;
  let loads = 0;

  afterEach(() => {
    scroller?.remove();
    sentinel?.remove();
  });

  function mount() {
    loads = 0;
    scroller = document.createElement("div");
    scroller.className = "preview-console__main";
    sentinel = document.createElement("div");
    scroller.appendChild(sentinel);
    document.body.appendChild(scroller);
    scroller.getBoundingClientRect = () => box(0, 800);
    sentinel.getBoundingClientRect = () => box(2100 - scroller.scrollTop, 2160 - scroller.scrollTop);
    return bindBoardScroll(scroller, sentinel, () => { loads += 1; });
  }

  it("does not load when the sentinel is below both the panel and the window", () => {
    const stop = mount();
    expect(loads).toBe(0);
    expect(sentinelInView(box(2100, 2160), box(0, 800))).toBe(false);
    stop();
  });

  it("a wheel outside the panel scrolls it far enough to request page 2", () => {
    const stop = mount();
    const outside = document.createElement("aside");
    document.body.appendChild(outside);
    outside.dispatchEvent(new WheelEvent("wheel", { deltaY: 900, bubbles: true, cancelable: true }));
    expect(scroller.scrollTop).toBeGreaterThanOrEqual(900);
    expect(loads).toBeGreaterThan(0);
    outside.remove();
    stop();
  });

  it("a page-down key outside the panel scrolls it and requests page 2", () => {
    const stop = mount();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown", bubbles: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown", bubbles: true, cancelable: true }));
    expect(scroller.scrollTop).toBeGreaterThan(0);
    expect(loads).toBeGreaterThan(0);
    stop();
  });

  it("scrolling the inner panel itself requests page 2", () => {
    const stop = mount();
    scroller.scrollTop = 1600;
    scroller.dispatchEvent(new Event("scroll"));
    expect(loads).toBeGreaterThan(0);
    stop();
  });

  it("a wheel that already lands inside the panel is not applied twice", () => {
    const inner = document.createElement("div");
    const stop = mount();
    scroller.appendChild(inner);
    expect(boardScrollDelta({ type: "wheel", target: inner, deltaY: 400 }, scroller)).toBeNull();
    inner.dispatchEvent(new WheelEvent("wheel", { deltaY: 400, bubbles: true, cancelable: true }));
    expect(scroller.scrollTop).toBe(0);
    stop();
  });
});

describe("list end copy", () => {
  it("a short page is the end, and the count cap is not", () => {
    expect(listEndState({ received: 4, pageSize: 12, page: 3, total: 28 })).toBe("end");
    expect(listEndState({ received: 0, pageSize: 12, page: 2, total: 12 })).toBe("end");
    expect(listEndState({ received: 12, pageSize: 12, page: 1, total: 10_001 })).toBe("more");
    expect(listEndState({ received: 12, pageSize: 12, page: 834, total: 10_001 })).toBe("capped");
    expect(listEndState({ received: 8, pageSize: 12, page: 2, total: 400 })).toBe("more");
    expect(END_OF_LIST_COPY).toMatch(/every trade-up/i);
    expect(LIST_CAP_COPY).toMatch(/narrow/i);
  });
});

describe("cacheable reads leave the list bucket", () => {
  it("faces and stats are not on the shared 120/min bucket", () => {
    expect(usesSharedApiBucket("/api/trade-ups")).toBe(true);
    expect(usesSharedApiBucket("/auth/steam")).toBe(true);
    expect(usesSharedApiBucket("/api/subscribe")).toBe(true);
    expect(isCacheableRead("/api/preview/faces")).toBe(true);
    expect(isCacheableRead("/api/global-stats")).toBe(true);
    expect(isCacheableRead("/api/outcome-stats")).toBe(true);
    expect(usesSharedApiBucket("/api/preview/faces")).toBe(false);
    expect(usesSharedApiBucket("/api/global-stats")).toBe(false);
    expect(usesSharedApiBucket("/api/outcome-stats")).toBe(false);
  });

  it("collects the skin names a board page would otherwise fetch as faces", () => {
    expect(faceNamesOnPage([{
      inputs: [{ skin_name: "AK-47 | Redline" }, { skin_name: "AK-47 | Redline" }],
      outcomes: [{ skin_name: "AWP | Asiimov" }],
    }])).toEqual(["AK-47 | Redline", "AWP | Asiimov"]);
  });
});
