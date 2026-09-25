import { useEffect, useState } from "react";
import {
  browseHeldUntil,
  fetchBrowseJson,
  isAbortError,
  isRateLimitError,
  peekBrowseJson,
  subscribeBrowseHold,
} from "./page-fetch.js";

/** True while browse requests are held on a 429's Retry-After. */
export function useBrowseHeld(): boolean {
  const [held, setHeld] = useState(() => browseHeldUntil() > Date.now());
  useEffect(() => {
    let timer = 0;
    const sync = () => {
      window.clearTimeout(timer);
      const wait = browseHeldUntil() - Date.now();
      setHeld(wait > 0);
      if (wait > 0) timer = window.setTimeout(sync, wait + 50);
    };
    sync();
    const unsubscribe = subscribeBrowseHold(sync);
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
    };
  }, []);
  return held;
}

export interface BrowseJson<T> {
  data: T | null;
  error: boolean;
  /** A 429 with nothing cached to fall back on; the hook retries once the hold lifts. */
  throttled: boolean;
}

/**
 * One cached, coalesced browse GET. Two components asking for the same URL
 * (a skin page header and its stats card) share one request, a revisit within
 * `ttlMs` paints from memory, and a 429 waits for Retry-After before retrying.
 */
export function useBrowseJson<T>(url: string | null, ttlMs?: number): BrowseJson<T> {
  const [state, setState] = useState<BrowseJson<T> & { url: string | null }>({
    url: null, data: null, error: false, throttled: false,
  });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    let timer = 0;
    fetchBrowseJson<T>(url, { signal: controller.signal, ttlMs })
      .then((data) => setState({ url, data, error: false, throttled: false }))
      .catch((err: unknown) => {
        if (isAbortError(err)) return;
        if (isRateLimitError(err)) {
          setState((prev) => ({ url, data: prev.url === url ? prev.data : null, error: false, throttled: true }));
          timer = window.setTimeout(() => setRetry((n) => n + 1), Math.max(1_000, browseHeldUntil() - Date.now()));
          return;
        }
        setState({ url, data: null, error: true, throttled: false });
      });
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [url, ttlMs, retry]);

  if (!url) return { data: null, error: false, throttled: false };
  if (state.url === url) return state;
  return { data: peekBrowseJson<T>(url, ttlMs), error: false, throttled: false };
}
