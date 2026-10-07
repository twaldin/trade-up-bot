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
  boardDelayReserveSentence,
  boardDelaySentence,
  parseBoardDelayPayload,
  parseBoardDelayRow,
  type BoardDelayGap,
} from "../../../shared/board-delay.js";

/** undefined while the request is in flight, null if it failed, was skipped, or the body was unusable. */
export function useBoardDelay(enabled = true): BoardDelayGap | null | undefined {
  const [gap, setGap] = useState<BoardDelayGap | null | undefined>(enabled ? undefined : null);
  const [enabledSeen, setEnabledSeen] = useState(enabled);
  // Reset during render so a banner sized for the in-flight sentence does not
  // collapse for a frame when the list flips this on.
  if (enabled !== enabledSeen) {
    setEnabledSeen(enabled);
    setGap(enabled ? undefined : null);
  }
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
  return gap;
}
