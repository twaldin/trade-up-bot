import { useState, useEffect, useCallback, useRef } from "react";
import type { SyncStatus } from "../../shared/types.js";

export interface StatusDiffs {
  knife_trade_ups: number;
  knife_profitable: number;
  covert_trade_ups: number;
  covert_profitable: number;
}

// Poll /api/status for updates and detect changes.
export function useStatus(pollInterval = 30_000) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [diffs, setDiffs] = useState<StatusDiffs>({ knife_trade_ups: 0, knife_profitable: 0, covert_trade_ups: 0, covert_profitable: 0 });
  const [newDataHint, setNewDataHint] = useState(false);
  const prevCount = useRef(0);
  const prevStatus = useRef<SyncStatus | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/status");
      const data: SyncStatus = await res.json();
      // Compute diffs against previous status
      if (prevStatus.current) {
        const p = prevStatus.current;
        setDiffs({
          knife_trade_ups: data.knife_trade_ups - p.knife_trade_ups,
          knife_profitable: data.knife_profitable - p.knife_profitable,
          covert_trade_ups: data.covert_trade_ups - p.covert_trade_ups,
          covert_profitable: data.covert_profitable - p.covert_profitable,
        });
      }
      prevStatus.current = data;
      setStatus(data);
      return data;
    } catch {
      return null;
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchStatus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Background polling for new data hints
  useEffect(() => {
    const checkInterval = setInterval(async () => {
      const data = await fetchStatus();
      if (data && data.trade_ups_count !== prevCount.current) {
        setNewDataHint(true);
      }
    }, pollInterval);

    return () => { clearInterval(checkInterval); };
  }, [fetchStatus, pollInterval]);

  useEffect(() => {
    if (status) prevCount.current = status.trade_ups_count;
  }, [status?.trade_ups_count]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(async () => {
    setNewDataHint(false);
    await fetchStatus();
  }, [fetchStatus]);

  return { status, diffs, newDataHint, refresh };
}
