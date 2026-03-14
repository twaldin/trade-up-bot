import { useState, useEffect, useCallback, useRef } from "react";
import { timeAgo, formatResetTime } from "../utils/format.js";

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
    <div className="rl-pool">
      <div className="rl-pool-header">
        <span className="rl-pool-label">{label}</span>
        <span className={`rl-pool-status ${!pool.available ? "rl-limited" : atBuffer ? "rl-buffer" : "rl-ok"}`}>
          {!pool.available ? "429" : atBuffer ? "BUFFER" : "OK"}
        </span>
      </div>
      <div className="rl-bar-track">
        {safety > 0 && <div className="rl-bar-safety" style={{ width: `${safetyPct}%` }} />}
        <div className="rl-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="rl-pool-detail">
        <span>{remaining}/{limit}{safety > 0 ? ` (${safety} reserved)` : ""}</span>
        {pool.cycle_budget !== undefined && pool.cycle_budget > 0 && (
          <span className="rl-pace">pace: {pool.cycle_budget}</span>
        )}
        {resetStr && !pool.available && <span className="rl-reset">{resetStr}</span>}
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

  if (cycles.length === 0) return <div className="cycle-empty">No cycle data yet</div>;

  return (
    <div className="cycle-list">
      <div className="cycle-summary">
        {total} cycles recorded
      </div>
      <div className="cycle-table-wrap">
        <table className="cycle-table">
          <thead>
            <tr>
              <th>#</th>
              <th className="cycle-sortable" onClick={() => handleSort("time")}>Time{arrow("time")}</th>
              <th className="cycle-sortable" onClick={() => handleSort("duration")}>Duration{arrow("duration")}</th>
              <th className="cycle-sortable" onClick={() => handleSort("api")}>API{arrow("api")}</th>
              <th className="cycle-sortable" onClick={() => handleSort("profitable")}>Knife{arrow("profitable")}</th>
              <th>Classified</th>
              <th className="cycle-sortable" onClick={() => handleSort("top_profit")}>Top Profit{arrow("top_profit")}</th>
              <th className="cycle-sortable" onClick={() => handleSort("theories")}>Theories{arrow("theories")}</th>
              <th className="cycle-sortable" onClick={() => handleSort("explore")}>Explore{arrow("explore")}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((c, i) => (
              <tr key={i} className={c.knife_profitable > 0 ? "cycle-profitable" : ""}>
                <td className="cycle-dim">{i + 1}</td>
                <td className="cycle-time">{new Date(c.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
                <td>{(c.duration_ms / 60000).toFixed(1)}m</td>
                <td className={c.api_available ? "" : "cycle-dim"}>{c.api_calls_used || "-"}</td>
                <td className={c.knife_profitable > 0 ? "cycle-highlight" : ""}>{c.knife_profitable || "-"}</td>
                <td className={c.classified_profitable > 0 ? "cycle-highlight" : ""}>{c.classified_profitable || "-"}</td>
                <td className={c.top_profit_cents > 0 ? "cycle-highlight" : ""}>
                  {c.top_profit_cents > 0 ? `$${(c.top_profit_cents / 100).toFixed(0)}` : "-"}
                </td>
                <td>
                  {c.theories_generated > 0 ? `${c.theories_generated}` : "-"}
                  {c.theories_profitable > 0 && <span className="cycle-highlight"> ({c.theories_profitable})</span>}
                  {c.classified_theories > 0 && (
                    <span className="cycle-dim"> +{c.classified_theories}{c.classified_theories_profitable > 0 && <span className="cycle-highlight">({c.classified_theories_profitable})</span>}</span>
                  )}
                </td>
                <td>
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
  const [tab, setTab] = useState<"log" | "cycles">("log");

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

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  const rl = logData.rateLimits;

  return (
    <div className="daemon-modal-overlay" onClick={handleOverlayClick}>
      <div className="daemon-modal">
        <div className="daemon-modal-header">
          <h2>Daemon Status</h2>
          <button className="daemon-modal-close" onClick={onClose}>&#10005;</button>
        </div>
        <div className="daemon-modal-body">
          {/* Left sidebar: phases + rate limits */}
          <div className="daemon-phases">
            <h3>Current Phase</h3>
            <div className="daemon-phase-list">
              {DAEMON_PHASES.map((phase) => {
                const isCurrent = logData.currentPhase === phase;
                const currentIdx = DAEMON_PHASES.indexOf(logData.currentPhase);
                const phaseIdx = DAEMON_PHASES.indexOf(phase);
                const isPast = currentIdx >= 0 && phaseIdx >= 0 && phaseIdx < currentIdx;
                return (
                  <div
                    key={phase}
                    className={`daemon-phase-item${isCurrent ? " phase-current" : ""}${isPast ? " phase-done" : ""}`}
                  >
                    <span className="phase-dot" />
                    <span className="phase-label">{phase}</span>
                  </div>
                );
              })}
            </div>

            {/* CSFloat API */}
            <div className="rl-section">
              <h3>CSFloat API</h3>
              {logData.csfloatStats && (
                <div className="ds-source">
                  <div className="ds-source-detail">
                    {logData.csfloatStats.listingsStored.toLocaleString()} listings
                    {" · "}{logData.csfloatStats.totalSales.toLocaleString()} sales
                    {" · "}{logData.csfloatStats.saleObservations.toLocaleString()} observations
                  </div>
                </div>
              )}
              {rl && (
                <>
                  <RateLimitBar label="Listings" pool={rl.listing_search} />
                  <RateLimitBar label="Sales" pool={rl.sale_history} />
                  <RateLimitBar label="Individual" pool={rl.individual} />
                  <div className="rl-updated">Updated {timeAgo(rl.detected_at)}</div>
                </>
              )}
            </div>

            {/* DMarket + Skinport */}
            {(logData.dmarketStats || logData.skinportStats) && (
              <div className="rl-section">
                <h3>Other Sources</h3>

                {logData.dmarketStats && (
                  <div className="ds-source">
                    <div className="ds-source-header">
                      <span className="ds-source-label">DMarket API</span>
                      <span className={`ds-source-status ${logData.dmarketStats.configured ? "ds-ok" : "ds-off"}`}>
                        {logData.dmarketStats.configured ? "Configured" : "Off"}
                      </span>
                    </div>
                    <div className="ds-source-detail">
                      {logData.dmarketStats.listingsStored.toLocaleString()} listings
                      {logData.dmarketStats.lastFetchAt && (
                        <span className="ds-source-time"> · {timeAgo(logData.dmarketStats.lastFetchAt)}</span>
                      )}
                    </div>
                  </div>
                )}

                {logData.skinportStats && (
                  <div className="ds-source">
                    <div className="ds-source-header">
                      <span className="ds-source-label">Skinport WS</span>
                      <span className="ds-source-status ds-ok">Passive</span>
                    </div>
                    <div className="ds-source-detail">
                      {logData.skinportStats.listingsStored.toLocaleString()} listings
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right panel: tabs */}
          <div className="daemon-log-section">
            <div className="daemon-tabs">
              <button className={tab === "log" ? "daemon-tab-active" : ""} onClick={() => setTab("log")}>Live Log</button>
              <button className={tab === "cycles" ? "daemon-tab-active" : ""} onClick={() => setTab("cycles")}>Cycle History</button>
            </div>
            {tab === "log" ? (
              <div
                className="daemon-log"
                ref={logContainerRef}
                onScroll={handleScroll}
              >
                {logData.lines.map((line, i) => (
                  <div key={i} className="daemon-log-line">{line}</div>
                ))}
                <div ref={logEndRef} />
              </div>
            ) : (
              <CycleHistory />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
