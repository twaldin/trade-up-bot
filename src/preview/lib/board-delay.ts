import { useEffect, useState } from "react";
import {
  parseBoardDelayPayload,
  type BoardDelayGap,
} from "../../../shared/board-delay.js";
import { getEffectiveTier } from "../../../shared/pro-access.js";

/**
 * Free and logged-out viewers load the gap. `undefined` is auth still resolving,
 * so the request waits. Pro, lifetime, basic, and admin skip it.
 */
export function shouldFetchBoardDelay(
  user: { tier?: string; lifetime?: boolean } | null | undefined,
): boolean {
  if (user === undefined) return false;
  return getEffectiveTier(user) === "free";
}

export {
  BOARD_DELAY_SECONDS,
  boardDelaySentence,
  parseBoardDelayPayload,
  parseBoardDelayRow,
  type BoardDelayGap,
} from "../../../shared/board-delay.js";

/** undefined while the request is in flight, null if it failed, was skipped, or the body was unusable. */
export function useBoardDelay(enabled = true): BoardDelayGap | null | undefined {
  const [gap, setGap] = useState<BoardDelayGap | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetch("/api/board-delay")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: unknown) => {
        if (live) setGap(parseBoardDelayPayload(body));
      })
      .catch(() => {
        if (live) setGap(null);
      });
    return () => { live = false; };
  }, [enabled]);
  // A late enable has to report "in flight" on that same render. Waiting for
  // the effect left the sentence unreserved and the card jumped when it arrived.
  if (!enabled) return null;
  return gap;
}
