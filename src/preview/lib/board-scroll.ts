/**
 * The board lives in `.preview-console__main` (`overflow: auto`) inside a
 * 100dvh shell that hides window overflow. Wheel, keys, and touch that land
 * outside that panel never moved it, so the sentinel stayed ~2100px down and
 * page 2 never loaded. Events outside the panel are forwarded into it.
 */

export const BOARD_SCROLL_MARGIN = 600;

const KEY_DELTA: Record<string, number> = {
  ArrowDown: 80,
  ArrowUp: -80,
  PageDown: 640,
  PageUp: -640,
  " ": 640,
  End: 100_000,
  Home: -100_000,
};

export function isInsideScroller(target: EventTarget | null, scroller: Element): boolean {
  return target instanceof Node && scroller.contains(target);
}

function typingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export function wheelPixels(deltaY: number, deltaMode: number | undefined): number {
  if (deltaMode === 1) return deltaY * 16;
  if (deltaMode === 2) return deltaY * 800;
  return deltaY;
}

/** Pixels to add to the board scroller, or null when the event already lands inside it. */
export function boardScrollDelta(
  event: {
    type: string;
    target: EventTarget | null;
    deltaY?: number;
    deltaMode?: number;
    key?: string;
  },
  scroller: Element,
): number | null {
  if (isInsideScroller(event.target, scroller)) return null;
  if (event.type === "wheel" && typeof event.deltaY === "number" && event.deltaY !== 0) {
    return wheelPixels(event.deltaY, event.deltaMode);
  }
  if (event.type === "keydown" && event.key && Object.hasOwn(KEY_DELTA, event.key)) {
    if (typingTarget(event.target)) return null;
    return KEY_DELTA[event.key];
  }
  return null;
}

export function sentinelInView(
  sentinel: { top: number; bottom: number },
  view: { top: number; bottom: number },
  margin: number = BOARD_SCROLL_MARGIN,
): boolean {
  return sentinel.top <= view.bottom + margin && sentinel.bottom >= view.top - margin;
}

export function bindBoardScroll(
  scroller: HTMLElement,
  sentinel: HTMLElement,
  loadMore: () => void,
  margin: number = BOARD_SCROLL_MARGIN,
): () => void {
  const maybeLoad = () => {
    const sent = sentinel.getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    const frame = { top: 0, bottom: window.innerHeight || view.bottom };
    if (sentinelInView(sent, view, margin) || sentinelInView(sent, frame, margin)) loadMore();
  };
  const onWheel = (event: WheelEvent) => {
    const delta = boardScrollDelta(event, scroller);
    if (delta === null) return;
    scroller.scrollTop += delta;
    event.preventDefault();
    maybeLoad();
  };
  const onKey = (event: KeyboardEvent) => {
    const delta = boardScrollDelta(event, scroller);
    if (delta === null) return;
    scroller.scrollTop += delta;
    event.preventDefault();
    maybeLoad();
  };
  let touchY: number | null = null;
  const onTouchStart = (event: TouchEvent) => {
    if (isInsideScroller(event.target, scroller)) { touchY = null; return; }
    touchY = event.touches[0]?.clientY ?? null;
  };
  const onTouchMove = (event: TouchEvent) => {
    if (touchY === null) return;
    const y = event.touches[0]?.clientY;
    if (y === undefined) return;
    scroller.scrollTop += touchY - y;
    touchY = y;
    event.preventDefault();
    maybeLoad();
  };
  const onScroll = () => maybeLoad();
  window.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("keydown", onKey);
  window.addEventListener("touchstart", onTouchStart, { passive: true });
  window.addEventListener("touchmove", onTouchMove, { passive: false });
  scroller.addEventListener("scroll", onScroll);
  window.addEventListener("scroll", onScroll);
  return () => {
    window.removeEventListener("wheel", onWheel);
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("touchstart", onTouchStart);
    window.removeEventListener("touchmove", onTouchMove);
    scroller.removeEventListener("scroll", onScroll);
    window.removeEventListener("scroll", onScroll);
  };
}
