/**
 * The board lives in `.preview-console__main` (`overflow: auto`) inside a
 * 100dvh shell that hides window overflow. Wheel, keys, and touch that land
 * outside that panel never moved it, so the sentinel stayed ~2100px down and
 * page 2 never loaded. Events outside the panel are forwarded into it, unless
 * the target is already a control or a scroller that can move itself.
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

const KEY_BLOCK = "button, a, input, select, textarea, [contenteditable], [role='listbox'], [role='option'], [role='menu'], [role='menuitem'], [role='dialog']";

export function isInsideScroller(target: EventTarget | null, scroller: Element): boolean {
  return target instanceof Node && scroller.contains(target);
}

export function blocksBoardKey(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest("dialog, [role='dialog']")) return true;
  return Boolean(target.closest(KEY_BLOCK));
}

function canScrollInDirection(el: Element, deltaY: number): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const overflow = getComputedStyle(el).overflowY;
  if (overflow !== "auto" && overflow !== "scroll" && overflow !== "overlay") return false;
  if (el.scrollHeight <= el.clientHeight + 1) return false;
  if (deltaY > 0) return el.scrollTop + el.clientHeight < el.scrollHeight - 1;
  if (deltaY < 0) return el.scrollTop > 0;
  return false;
}

/** A scrollable box between the event target and the board panel, not the panel itself. */
export function scrollableBetween(target: EventTarget | null, scroller: Element, deltaY: number): boolean {
  if (!(target instanceof Element) || deltaY === 0) return false;
  let node: Element | null = target;
  while (node && node !== scroller) {
    if (canScrollInDirection(node, deltaY)) return true;
    node = node.parentElement;
  }
  return false;
}

export function wheelPixels(deltaY: number, deltaMode: number | undefined): number {
  if (deltaMode === 1) return deltaY * 16;
  if (deltaMode === 2) return deltaY * 800;
  return deltaY;
}

export interface BoardScrollEvent {
  type: string;
  target: EventTarget | null;
  deltaY?: number;
  deltaMode?: number;
  key?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  defaultPrevented?: boolean;
  touches?: number;
}

/** Pixels to add to the board scroller, or null when the event should be left alone. */
export function boardScrollDelta(event: BoardScrollEvent, scroller: Element): number | null {
  if (event.defaultPrevented) return null;
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if ((event.touches ?? 0) > 1) return null;
  if (isInsideScroller(event.target, scroller)) return null;
  if (event.type === "wheel" && typeof event.deltaY === "number" && event.deltaY !== 0) {
    const delta = wheelPixels(event.deltaY, event.deltaMode);
    if (scrollableBetween(event.target, scroller, delta)) return null;
    return delta;
  }
  if (event.type === "touchmove" && typeof event.deltaY === "number" && event.deltaY !== 0) {
    if (scrollableBetween(event.target, scroller, event.deltaY)) return null;
    return event.deltaY;
  }
  if (event.type === "keydown" && event.key && Object.hasOwn(KEY_DELTA, event.key)) {
    if (blocksBoardKey(event.target)) return null;
    const delta = KEY_DELTA[event.key] ?? 0;
    if (event.key === " " && event.shiftKey) return -Math.abs(delta);
    return delta;
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
  const apply = (event: WheelEvent | KeyboardEvent) => {
    const delta = boardScrollDelta(event, scroller);
    if (delta === null) return;
    scroller.scrollTop += delta;
    event.preventDefault();
    maybeLoad();
  };
  let touchY: number | null = null;
  const onTouchStart = (event: TouchEvent) => {
    if (event.touches.length > 1) { touchY = null; return; }
    if (isInsideScroller(event.target, scroller)) { touchY = null; return; }
    if (scrollableBetween(event.target, scroller, 1) || scrollableBetween(event.target, scroller, -1)) {
      touchY = null;
      return;
    }
    touchY = event.touches[0]?.clientY ?? null;
  };
  const onTouchMove = (event: TouchEvent) => {
    if (event.defaultPrevented) return;
    if (event.touches.length > 1) { touchY = null; return; }
    if (touchY === null) return;
    const y = event.touches[0]?.clientY;
    if (y === undefined) return;
    const delta = touchY - y;
    if (scrollableBetween(event.target, scroller, delta)) { touchY = null; return; }
    scroller.scrollTop += delta;
    touchY = y;
    event.preventDefault();
    maybeLoad();
  };
  const onScroll = () => maybeLoad();
  window.addEventListener("wheel", apply, { passive: false });
  window.addEventListener("keydown", apply);
  window.addEventListener("touchstart", onTouchStart, { passive: true });
  window.addEventListener("touchmove", onTouchMove, { passive: false });
  scroller.addEventListener("scroll", onScroll);
  window.addEventListener("scroll", onScroll);
  return () => {
    window.removeEventListener("wheel", apply);
    window.removeEventListener("keydown", apply);
    window.removeEventListener("touchstart", onTouchStart);
    window.removeEventListener("touchmove", onTouchMove);
    scroller.removeEventListener("scroll", onScroll);
    window.removeEventListener("scroll", onScroll);
  };
}
