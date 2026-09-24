import { useEffect, useState } from "react";
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
  const [suggestion, setSuggestion] = useState<LoosenSuggestion | null>(null);
  const key = `${enabled}|${typing}|${text}|${collection ?? ""}|${skin ?? ""}|${query ? JSON.stringify(query) : ""}`;

  useEffect(() => {
    setSuggestion(null);
    if (!enabled || !query || !probesAllowed(typing) || probeCoolingDown()) return;
    const candidates = loosenCandidates(query, text);
    if (candidates.length === 0) return;
    const controller = new AbortController();
    let live = true;
    const handle = window.setTimeout(() => {
      void firstReturningStep(candidates, async (step) => {
        if (!live || controller.signal.aborted) return "stop";
        try {
          const res = await fetchFn(loosenProbePath(step, { collection, skin }), {
            credentials: "include",
            signal: controller.signal,
          });
          if (res.status === 429) {
            noteProbeRateLimit();
            return "stop";
          }
          if (!res.ok) return "miss";
          const body: unknown = await res.json();
          return probeFoundRows(body) ? "hit" : "miss";
        } catch {
          return controller.signal.aborted ? "stop" : "miss";
        }
      }).then((found) => {
        if (live) setSuggestion(found);
      });
    }, LOOSEN_PROBE_DEBOUNCE_MS);
    return () => {
      live = false;
      window.clearTimeout(handle);
      controller.abort();
    };
  }, [key, fetchFn]);

  return suggestion;
}
