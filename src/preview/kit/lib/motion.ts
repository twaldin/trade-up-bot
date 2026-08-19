/**
 * Motion behaviour copied from dashboard-saas `src/lib/motion.ts`.
 * CSS animation-timeline is the primary scroll driver; JS fallback for Firefox.
 * `motion/react` is for AnimatePresence / layout, not scroll.
 */
import * as React from "react";

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = React.useState(() =>
    typeof window === "undefined" ? false : window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  React.useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export type ScrollRange = "cover" | "pin";

const CSS_CLAIMS_SUPPORT =
  typeof CSS !== "undefined" &&
  CSS.supports("animation-timeline", "view()") &&
  CSS.supports("animation-range", "0% 100%");

function schedule(fn: () => void) {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    fn();
  };
  const frame = requestAnimationFrame(run);
  const timer = window.setTimeout(run, 32);
  return () => {
    done = true;
    cancelAnimationFrame(frame);
    window.clearTimeout(timer);
  };
}

export interface ScrollProgressOptions {
  forceJs?: boolean;
}

export function useScrollProgress<T extends HTMLElement = HTMLDivElement>(
  range: ScrollRange = "cover",
  options: ScrollProgressOptions = {},
) {
  const { forceJs = false } = options;
  const ref = React.useRef<T | null>(null);
  const progress = React.useRef(0);
  const reduced = usePrefersReducedMotion();

  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (reduced) {
      node.style.setProperty("--progress", "1");
      progress.current = 1;
      return;
    }

    let disposed = false;
    let teardown: (() => void) | undefined;

    const cssDriverIsLive = () => {
      if (typeof node.getAnimations !== "function") return false;
      return node.getAnimations({ subtree: true }).some((animation) => {
        const timeline = animation.timeline;
        return Boolean(timeline) && !(timeline instanceof DocumentTimeline) && timeline!.currentTime !== null;
      });
    };

    const install = () => {
      if (disposed) return;
      let queued = false;
      let cancel: (() => void) | undefined;

      const measure = () => {
        queued = false;
        const rect = node.getBoundingClientRect();
        const vh = window.innerHeight;
        let raw: number;
        if (range === "pin") {
          const travel = rect.height - vh;
          raw = travel <= 0 ? 1 : -rect.top / travel;
        } else {
          const span = rect.height + vh;
          raw = span === 0 ? 0 : (vh - rect.top) / span;
        }
        const next = raw < 0 ? 0 : raw > 1 ? 1 : raw;
        progress.current = next;
        node.style.setProperty("--progress", next.toFixed(4));
      };

      const onScroll = () => {
        if (queued) return;
        queued = true;
        cancel = schedule(measure);
      };

      measure();
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onScroll, { passive: true });
      teardown = () => {
        cancel?.();
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onScroll);
      };
    };

    if (forceJs || !CSS_CLAIMS_SUPPORT) {
      install();
    } else {
      const cancel = schedule(() => {
        if (!cssDriverIsLive()) install();
      });
      teardown = cancel;
    }

    return () => {
      disposed = true;
      teardown?.();
    };
  }, [reduced, range, forceJs]);

  return [ref, progress] as const;
}

export interface InViewOptions {
  threshold?: number;
  rootMargin?: string;
  once?: boolean;
}

export function useInView<T extends Element = HTMLDivElement>(options: InViewOptions = {}) {
  const { threshold = 0.2, rootMargin = "0px 0px -10% 0px", once = true } = options;
  const ref = React.useRef<T | null>(null);
  const [inView, setInView] = React.useState(false);

  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            if (once) observer.unobserve(entry.target);
          } else if (!once) {
            setInView(false);
          }
        }
      },
      { threshold, rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold, rootMargin, once]);

  return [ref, inView] as const;
}

export function usePointerTilt<T extends HTMLElement = HTMLDivElement>(options: { damping?: number } = {}) {
  const { damping = 0.12 } = options;
  const ref = React.useRef<T | null>(null);
  const reduced = usePrefersReducedMotion();

  React.useEffect(() => {
    const node = ref.current;
    if (!node || reduced) return;

    const target = { x: 0, y: 0 };
    const current = { x: 0, y: 0 };
    let frame = 0;
    let settled = true;

    const tick = () => {
      current.x += (target.x - current.x) * damping;
      current.y += (target.y - current.y) * damping;
      node.style.setProperty("--tilt-x", current.x.toFixed(4));
      node.style.setProperty("--tilt-y", current.y.toFixed(4));
      if (Math.abs(target.x - current.x) < 0.0005 && Math.abs(target.y - current.y) < 0.0005) {
        node.style.removeProperty("will-change");
        settled = true;
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    const wake = () => {
      if (!settled) return;
      settled = false;
      node.style.setProperty("will-change", "transform");
      frame = requestAnimationFrame(tick);
    };
    const onMove = (event: PointerEvent) => {
      const rect = node.getBoundingClientRect();
      target.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      target.y = ((event.clientY - rect.top) / rect.height) * 2 - 1;
      wake();
    };
    const onLeave = () => {
      target.x = 0;
      target.y = 0;
      wake();
    };

    node.addEventListener("pointermove", onMove);
    node.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(frame);
      node.removeEventListener("pointermove", onMove);
      node.removeEventListener("pointerleave", onLeave);
      node.style.removeProperty("will-change");
    };
  }, [damping, reduced]);

  return ref;
}
