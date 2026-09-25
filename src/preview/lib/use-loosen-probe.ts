import { useEffect, useRef, useState } from "react";
import type { BoardQuery } from "../components/PreviewFilters.js";
import {
  LOOSEN_PROBE_DEBOUNCE_MS,
  firstReturningStep,
  loosenCandidates,
  loosenProbePath,
  noteProbeRateLimit,
  probeCoolingDown,
  probeFoundRows,
  probesAllowed,
  type LoosenSuggestion,
} from "./empty-suggestions.js";
import { browseHeldUntil, noteRateLimited, parseRetryAfter, waitForBrowseHold } from "./page-fetch.js";

export function useLoosenProbe(opts: {
  enabled: boolean;
  typing?: boolean;
  query?: BoardQuery;
  text?: string;
  collection?: string;
  skin?: string;
  fetchFn?: typeof fetch;
}): LoosenSuggestion | null {
  const { enabled, typing = false, query, text = "", collection, skin, fetchFn = fetch } = opts;
  const [result, setResult] = useState<{ key: string; suggestion: LoosenSuggestion | null } | null>(null);
  const queryKey = `${enabled}|${text}|${collection ?? ""}|${skin ?? ""}|${query ? JSON.stringify(query) : ""}`;
  const probedKey = useRef("");

  useEffect(() => {
    if (!enabled || !query || !probesAllowed(typing) || probeCoolingDown()) return;
    if (probedKey.current === queryKey) return;
    const candidates = loosenCandidates(query, text);
    if (candidates.length === 0) return;
    const controller = new AbortController();
    let live = true;
    const handle = window.setTimeout(() => {
      void firstReturningStep(candidates, async (step) => {
        if (!live || controller.signal.aborted) return "stop";
        if (browseHeldUntil() > Date.now()) {
          try {
            await waitForBrowseHold(controller.signal);
          } catch {
            return "stop";
          }
        }
        if (!live || controller.signal.aborted || browseHeldUntil() > Date.now()) return "stop";
        try {
          const res = await fetchFn(loosenProbePath(step, { collection, skin }), {
            credentials: "include",
            signal: controller.signal,
          });
          if (res.status === 429) {
            noteProbeRateLimit();
            noteRateLimited(parseRetryAfter(res.headers.get("retry-after")));
            return "stop";
          }
          if (!res.ok) return "miss";
          const body: unknown = await res.json();
          return probeFoundRows(body) ? "hit" : "miss";
        } catch {
          return controller.signal.aborted ? "stop" : "miss";
        }
      }).then((found) => {
        if (!live) return;
        probedKey.current = queryKey;
        setResult({ key: queryKey, suggestion: found });
      });
    }, LOOSEN_PROBE_DEBOUNCE_MS);
    return () => {
      live = false;
      window.clearTimeout(handle);
      controller.abort();
    };
  }, [queryKey, typing, fetchFn]);

  return result !== null && result.key === queryKey ? result.suggestion : null;
}
