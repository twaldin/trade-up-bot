import { useEffect, useRef } from "react";
import { shouldTrackSpaPageView, trackSpaPageView } from "./conversions.js";

/**
 * Document load is the gtag config page_view. Each later path change is one
 * GA4 history page_view, so this effect must not send another. The first
 * render is not a navigation. The Pixel base code already recorded the
 * document load, so Meta PageView is once per path after that.
 */
export function useSpaPageView(pathname: string): void {
  const pageViewPath = useRef<string | null>(null);
  useEffect(() => {
    const previous = pageViewPath.current;
    pageViewPath.current = pathname;
    if (shouldTrackSpaPageView(previous, pathname)) trackSpaPageView();
  }, [pathname]);
}
