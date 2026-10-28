import { useLayoutEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import {
  collapseDuplicateRobots,
  DEFAULT_ROBOTS,
  ensureSingleRobots,
  resetDocumentHead,
} from "../lib/document-head.js";

/**
 * Stays mounted above the route tree. The first paint keeps a prerendered
 * robots tag (a direct thin-skin load must not flash `index, follow`). Every
 * later pathname change resets robots to one default tag and the route
 * canonical; the page's own head effects then override that default.
 */
export function RouteHeadReset(): null {
  const { pathname } = useLocation();
  const seen = useRef<string | null>(null);
  useLayoutEffect(() => {
    const previous = seen.current;
    seen.current = pathname;
    if (previous === pathname) return;
    if (previous === null) {
      collapseDuplicateRobots();
      if (document.querySelector("meta[name='robots']") == null) {
        ensureSingleRobots(DEFAULT_ROBOTS);
      }
      return;
    }
    resetDocumentHead(pathname);
  }, [pathname]);
  return null;
}
