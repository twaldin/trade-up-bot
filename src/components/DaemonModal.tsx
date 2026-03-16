import { useState, useEffect, useCallback, useRef } from "react";
import { timeAgo, formatResetTime } from "../utils/format.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@shared/components/ui/dialog.js";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@shared/components/ui/tabs.js";
import { Badge } from "@shared/components/ui/badge.js";

interface RateLimitPool {
  limit: number | null;
  remaining: number | null;
  reset_at: number | null;
  available: boolean;
  cycle_budget?: number;
  safety_buffer?: number;
}

interface DaemonLogData {
  lines: string[];
  currentPhase: string;
  rateLimits: {
    listing_search: RateLimitPool;
    sale_history: RateLimitPool;
    individual: RateLimitPool;
    detected_at: string;
  } | null;
  csfloatStats: {
    listingsStored: number;
    totalSales: number;
    saleObservations: number;
  } | null;
  dmarketStats: {
    configured: boolean;
    listingsStored: number;
    lastFetchAt: string | null;
  } | null;
  skinportStats: {
    listingsStored: number;
    saleObservations: number;
  } | null;
}

interface CycleRow {
  cycle: number;
  started_at: string;
  duration_ms: number;
  api_calls_used: number;
  api_available: number;
  knife_tradeups_total: number;
  knife_profitable: number;
  theories_generated: number;
  theories_profitable: number;
  cooldown_new_found: number;
  cooldown_improved: number;
  top_profit_cents: number;
  classified_total: number;
  classified_profitable: number;
  classified_theories: number;
  classified_theories_profitable: number;
}

const DAEMON_PHASES = [
  "Housekeeping",
  "Theory",
  "Classified Theory",
  "Staircase Theory",
  "API Probe",
  "Data Fetch",
  "Knife Calc",
  "Classified Calc",
  "Staircase",
  "Cooldown",
  "Re-materialize",
];

function RateLimitBar({ label, pool }: { label: string; pool: RateLimitPool }) {
  const limit = pool.limit ?? 200;
  const remaining = pool.remaining ?? 0;
  const safety = pool.safety_buffer ?? 0;
  const pct = limit > 0 ? (remaining / limit) * 100 : 0;
  const safetyPct = limit > 0 ? (safety / limit) * 100 : 0;
  const resetStr = formatResetTime(pool.reset_at);
  const atBuffer = pool.available && remaining > 0 && remaining <= safety;

  return (
    <div className="mb-2.5">
      <div className="flex justify-between items-center mb-0.5">
        <span className="text-[0.7rem] text-muted-foreground">{label}</span>
        <Badge
          variant={!pool.available ? "destructive" : atBuffer ? "outline" : "secondary"}
          className={`text-[0.6rem] px-1.5 py-0 h-4 font-semibold ${
            !pool.available ? "" : atBuffer ? "text-yellow-500 border-yellow-500/30" : "text-green-500"
          }`}
        >
          {!pool.available ? "429" : atBuffer ? "BUFFER" : "OK"}
        </Badge>
      </div>
      <div className="h-1 bg-muted rounded-sm overflow-hidden relative">
        {safety > 0 && (
          <div
            className="absolute left-0 top-0 h-full rounded-sm z-[1]"
            style={{
              width: `${safetyPct}%`,
              background: "repeating-linear-gradient(90deg, rgb(245 158 11 / 0.2) 0px, rgb(245 158 11 / 0.2) 2px, transparent 2px, transparent 4px)",
            }}
          />
        )}
        <div
          className="h-full rounded-sm transition-[width] duration-500 relative z-[2]"
          style={{
            width: `${pct}%`,
            background: "linear-gradient(90deg, #ef4444 0%, #f59e0b 30%, #22c55e 70%)",
          }}
        />
      </div>
      <div className="flex justify-between text-[0.62rem] text-muted-foreground/70 mt-0.5">
        <span>{remaining}/{limit}{safety > 0 ? ` (${safety} reserved)` : ""}</span>
        {pool.cycle_budget !== undefined && pool.cycle_budget > 0 && (
          <span className="text-blue-400">pace: {pool.cycle_budget}</span>
        )}
        {resetStr && (
          <span className={!pool.available ? "text-yellow-500" : "text-muted-foreground/50"}>
            {!pool.available ? resetStr : `resets ${resetStr}`}
          </span>
        )}
      </div>
    </div>
  );
}

type CycleSortKey = "time" | "duration" | "api" | "profitable" | "top_profit" | "theories" | "explore";

function cycleSortValue(c: CycleRow, key: CycleSortKey): number {
  switch (key) {
    case "time": return new Date(c.started_at).getTime();
    case "duration": return c.duration_ms;
    case "api": return c.api_calls_used;
    case "profitable": return c.knife_profitable;
    case "top_profit": return c.top_profit_cents;
    case "theories": return c.theories_generated;
    case "explore": return c.cooldown_new_found + c.cooldown_improved;
  }
}

function CycleHistory() {
  const [cycles, setCycles] = useState<CycleRow[]>([]);
  const [total, setTotal] = useState(0);
  const [sortKey, setSortKey] = useState<CycleSortKey>("time");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    fetch("/api/daemon-cycles?limit=200")
      .then(r => r.json())
      .then(d => { setCycles(d.cycles); setTotal(d.total); })
      .catch(() => {});
  }, []);

  const handleSort = (key: CycleSortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === "desc" ? "asc" : "desc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sorted = [...cycles].sort((a, b) => {
    const av = cycleSortValue(a, sortKey);
    const bv = cycleSortValue(b, sortKey);
    return sortDir === "desc" ? bv - av : av - bv;
  });

  const arrow = (key: CycleSortKey) => sortKey === key ? (sortDir === "desc" ? " \u25BC" : " \u25B2") : "";

  if (cycles.length === 0) return <div className="text-muted-foreground text-sm p-10 text-center">No cycle data yet</div>;

  const SortTh = ({ k, children }: { k: CycleSortKey; children: React.ReactNode }) => (
    <th
      className="px-2 py-1.5 text-left text-[0.65rem] uppercase tracking-wide text-muted-foreground bg-background border-b border-border font-semibold whitespace-nowrap cursor-pointer select-none hover:text-blue-400"
      onClick={() => handleSort(k)}
    >
      {children}{arrow(k)}
    </th>
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="text-[0.7rem] text-muted-foreground/70 mb-2 shrink-0">
        {total} cycles recorded
      </div>
      <div className="flex-1 overflow-y-auto border border-border rounded-md bg-muted/20">
        <table className="w-full border-collapse text-[0.7rem]">
          <thead className="sticky top-0 z-[1]">
            <tr>
              <th className="px-2 py-1.5 text-left text-[0.65rem] uppercase tracking-wide text-muted-foreground bg-background border-b border-border font-semibold whitespace-nowrap">#</th>
              <SortTh k="time">Time</SortTh>
              <SortTh k="duration">Duration</SortTh>
              <SortTh k="api">API</SortTh>
              <SortTh k="profitable">Knife</SortTh>
              <th className="px-2 py-1.5 text-left text-[0.65rem] uppercase tracking-wide text-muted-foreground bg-background border-b border-border font-semibold whitespace-nowrap">Classified</th>
              <SortTh k="top_profit">Top Profit</SortTh>
              <SortTh k="theories">Theories</SortTh>
              <SortTh k="explore">Explore</SortTh>
            </tr>
          </thead>
          <tbody>
            {sorted.map((c, i) => (
              <tr
                key={i}
                className={`hover:bg-blue-500/5 ${c.knife_profitable > 0 ? "bg-green-500/5" : ""}`}
              >
                <td className="px-2 py-1 text-muted-foreground/50 border-b border-border/30">{i + 1}</td>
                <td className="px-2 py-1 text-muted-foreground/60 border-b border-border/30 tabular-nums">
                  {new Date(c.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </td>
                <td className="px-2 py-1 text-muted-foreground border-b border-border/30">{(c.duration_ms / 60000).toFixed(1)}m</td>
                <td className={`px-2 py-1 border-b border-border/30 ${c.api_available ? "text-muted-foreground" : "text-muted-foreground/50"}`}>{c.api_calls_used || "-"}</td>
                <td className={`px-2 py-1 border-b border-border/30 ${c.knife_profitable > 0 ? "text-green-500 font-medium" : "text-muted-foreground"}`}>{c.knife_profitable || "-"}</td>
                <td className={`px-2 py-1 border-b border-border/30 ${c.classified_profitable > 0 ? "text-green-500 font-medium" : "text-muted-foreground"}`}>{c.classified_profitable || "-"}</td>
                <td className={`px-2 py-1 border-b border-border/30 ${c.top_profit_cents > 0 ? "text-green-500 font-medium" : "text-muted-foreground"}`}>
                  {c.top_profit_cents > 0 ? `$${(c.top_profit_cents / 100).toFixed(0)}` : "-"}
                </td>
                <td className="px-2 py-1 border-b border-border/30 text-muted-foreground">
                  {c.theories_generated > 0 ? `${c.theories_generated}` : "-"}
                  {c.theories_profitable > 0 && <span className="text-green-500 font-medium"> ({c.theories_profitable})</span>}
                  {c.classified_theories > 0 && (
                    <span className="text-muted-foreground/50"> +{c.classified_theories}{c.classified_theories_profitable > 0 && <span className="text-green-500 font-medium">({c.classified_theories_profitable})</span>}</span>
                  )}
                </td>
                <td className="px-2 py-1 border-b border-border/30 text-muted-foreground">
                  {(c.cooldown_new_found > 0 || c.cooldown_improved > 0)
                    ? `+${c.cooldown_new_found}/${c.cooldown_improved}`
                    : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function DaemonModal({ onClose }: { onClose: () => void }) {
  const [logData, setLogData] = useState<DaemonLogData>({ lines: [], currentPhase: "Unknown", rateLimits: null, csfloatStats: null, dmarketStats: null, skinportStats: null });
  const logEndRef = useRef<HTMLDivElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const fetchLog = useCallback(async () => {
    try {
      const res = await fetch("/api/daemon-log");
      const data: DaemonLogData = await res.json();
      setLogData(data);
    } catch {}
  }, []);

  useEffect(() => {
    fetchLog();
    const interval = setInterval(fetchLog, 2500);
    return () => clearInterval(interval);
  }, [fetchLog]);

  useEffect(() => {
    if (autoScroll && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "instant" });
    }
  }, [logData.lines, autoScroll]);

  const handleScroll = () => {
    const el = logContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  };

  const rl = logData.rateLimits;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-[1100px] w-[90vw] h-[80vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 py-3.5 border-b border-border shrink-0">
          <DialogTitle>Daemon Status</DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 overflow-hidden">
          {/* Left sidebar: phases + rate limits */}
          <div className="w-[220px] shrink-0 p-4 border-r border-border overflow-y-auto">
            <h3 className="text-[0.72rem] uppercase tracking-wider text-muted-foreground mb-3">Current Phase</h3>
            <div className="flex flex-col gap-0.5">
              {DAEMON_PHASES.map((phase) => {
                const isCurrent = logData.currentPhase === phase;
                const currentIdx = DAEMON_PHASES.indexOf(logData.currentPhase);
                const phaseIdx = DAEMON_PHASES.indexOf(phase);
                const isPast = currentIdx >= 0 && phaseIdx >= 0 && phaseIdx < currentIdx;
                return (
                  <div
                    key={phase}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-all ${
                      isCurrent
                        ? "text-blue-400 bg-blue-600/10"
                        : isPast
                          ? "text-muted-foreground/60"
                          : "text-muted-foreground/40"
                    }`}
                  >
                    <span
                      className={`size-1.5 rounded-full shrink-0 ${
                        isCurrent
                          ? "bg-blue-500 shadow-[0_0_6px_rgb(59_130_246_/_0.5)] animate-pulse"
                          : isPast
                            ? "bg-green-500/30"
                            : "bg-muted-foreground/20"
                      }`}
                    />
                    <span>{phase}</span>
                  </div>
                );
              })}
            </div>

            {/* CSFloat API */}
            <div className="mt-5 pt-4 border-t border-border">
              <h3 className="text-[0.72rem] uppercase tracking-wider text-muted-foreground mb-2.5">CSFloat API</h3>
              {logData.csfloatStats && (
                <div className="mb-2 text-[0.68rem] text-muted-foreground/70">
                  {logData.csfloatStats.listingsStored.toLocaleString()} listings
                  {" · "}{logData.csfloatStats.totalSales.toLocaleString()} sales
                  {" · "}{logData.csfloatStats.saleObservations.toLocaleString()} observations
                </div>
              )}
              {rl && (
                <>
                  <RateLimitBar label="Listings" pool={rl.listing_search} />
                  <RateLimitBar label="Sales" pool={rl.sale_history} />
                  <RateLimitBar label="Individual" pool={rl.individual} />
                  <div className="text-[0.6rem] text-muted-foreground/40 mt-1.5 text-right">
                    Updated {timeAgo(rl.detected_at)}
                  </div>
                </>
              )}
            </div>

            {/* DMarket + Skinport */}
            {(logData.dmarketStats || logData.skinportStats) && (
              <div className="mt-5 pt-4 border-t border-border">
                <h3 className="text-[0.72rem] uppercase tracking-wider text-muted-foreground mb-2.5">Other Sources</h3>

                {logData.dmarketStats && (
                  <div className="mb-2">
                    <div className="flex justify-between items-center mb-0.5">
                      <span className="text-xs text-muted-foreground">DMarket API</span>
                      <Badge
                        variant="secondary"
                        className={`text-[0.6rem] px-1.5 py-0 h-4 ${logData.dmarketStats.configured ? "text-green-500" : "text-muted-foreground/60"}`}
                      >
                        {logData.dmarketStats.configured ? "Configured" : "Off"}
                      </Badge>
                    </div>
                    <div className="text-[0.68rem] text-muted-foreground/60">
                      {logData.dmarketStats.listingsStored.toLocaleString()} listings
                      {logData.dmarketStats.lastFetchAt && (
                        <span className="text-muted-foreground/40"> · {timeAgo(logData.dmarketStats.lastFetchAt)}</span>
                      )}
                    </div>
                  </div>
                )}

                {logData.skinportStats && (
                  <div className="mb-2">
                    <div className="flex justify-between items-center mb-0.5">
                      <span className="text-xs text-muted-foreground">Skinport WS</span>
                      <Badge variant="secondary" className="text-[0.6rem] px-1.5 py-0 h-4 text-green-500">
                        Passive
                      </Badge>
                    </div>
                    <div className="text-[0.68rem] text-muted-foreground/60">
                      {logData.skinportStats.listingsStored.toLocaleString()} listings
                      {logData.skinportStats.saleObservations > 0 && (
                        <> &middot; {logData.skinportStats.saleObservations.toLocaleString()} sales</>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right panel: tabs */}
          <div className="flex-1 flex flex-col overflow-hidden p-4">
            <Tabs defaultValue="log" className="flex-1 flex flex-col overflow-hidden gap-0">
              <TabsList className="shrink-0 mb-2.5 w-fit">
                <TabsTrigger value="log">Live Log</TabsTrigger>
                <TabsTrigger value="cycles">Cycle History</TabsTrigger>
              </TabsList>
              <TabsContent value="log" className="flex-1 min-h-0">
                <div
                  className="h-full overflow-y-auto bg-muted/20 border border-border rounded-md px-3 py-2.5 font-mono text-[0.72rem] leading-relaxed"
                  ref={logContainerRef}
                  onScroll={handleScroll}
                >
                  {logData.lines.map((line, i) => (
                    <div key={i} className="text-muted-foreground whitespace-pre-wrap break-all">{line}</div>
                  ))}
                  <div ref={logEndRef} />
                </div>
              </TabsContent>
              <TabsContent value="cycles" className="flex-1 min-h-0">
                <CycleHistory />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
