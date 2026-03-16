import { useState, useEffect, useRef } from "react";

interface DaemonEvent {
  id: number;
  event_type: string;
  summary: string;
  detail: string | null;
  created_at: string;
}

const EVENT_COLORS: Record<string, string> = {
  listing_sold: "text-green-500",
  listings_fetched: "text-blue-400",
  sale_history: "text-purple-400",
  calc_complete: "text-yellow-500",
  staleness_check: "text-muted-foreground",
  stale_purged: "text-red-500",
  phase: "text-muted-foreground/50",
};

export function LiveFeed() {
  const [events, setEvents] = useState<DaemonEvent[]>([]);
  const [expanded, setExpanded] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const lastCreatedRef = useRef<string>("");

  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      try {
        const params = new URLSearchParams({ limit: "150" });
        if (lastCreatedRef.current) {
          params.set("since", lastCreatedRef.current);
        }
        const res = await fetch(`/api/daemon-events?${params}`);
        const data = await res.json();
        if (!mounted) return;
        if (data.events?.length > 0) {
          setEvents(prev => {
            const merged = [...prev, ...data.events];
            const seen = new Set<number>();
            const deduped = merged.filter((e: DaemonEvent) => {
              if (seen.has(e.id)) return false;
              seen.add(e.id);
              return true;
            });
            return deduped.slice(-200);
          });
          lastCreatedRef.current = data.events[data.events.length - 1].created_at;
        }
      } catch { /* ignore polling errors */ }
    };
    poll();
    const iv = setInterval(poll, 3000);
    return () => { mounted = false; clearInterval(iv); };
  }, []);

  useEffect(() => {
    if (expanded && panelRef.current) {
      const el = panelRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [events, expanded]);

  const latest = events[events.length - 1];

  return (
    <div className="mb-2">
      <div
        className="flex items-center gap-2 px-3 py-1.5 bg-background border border-border rounded-md cursor-pointer text-xs text-muted-foreground transition-colors hover:border-border"
        onClick={() => setExpanded(e => !e)}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse shrink-0" />
        <span className="text-[0.65rem] tracking-wider text-muted-foreground/50 shrink-0">LIVE</span>
        {latest && (
          <span className={`flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[0.7rem] ${EVENT_COLORS[latest.event_type] || "text-muted-foreground/50"}`}>
            {latest.summary}
          </span>
        )}
        <span className="shrink-0 text-muted-foreground/50 text-[0.7rem]">{expanded ? "\u25BC" : "\u25B6"} {events.length}</span>
      </div>
      {expanded && (
        <div
          ref={panelRef}
          className="max-h-[160px] overflow-y-auto bg-background border border-border border-t-0 rounded-b-md px-2.5 py-1 font-mono text-[0.68rem] leading-relaxed [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-thumb]:rounded-sm"
        >
          {events.map(e => (
            <div key={e.id} className="flex gap-2 text-muted-foreground">
              <span className="text-muted-foreground/40 shrink-0 w-[65px]">
                {new Date(e.created_at + "Z").toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
              <span className={`${EVENT_COLORS[e.event_type] || "text-muted-foreground/50"}`} style={{ minWidth: 110, flexShrink: 0 }}>
                [{e.event_type.replace(/_/g, " ")}]
              </span>
              <span className="text-foreground/70">{e.summary}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
