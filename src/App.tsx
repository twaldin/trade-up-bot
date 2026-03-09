import { useState, useEffect, useCallback, useRef } from "react";
import type { TradeUp, TradeUpListResponse, SyncStatus, ExplorationStats } from "../shared/types.js";
import { TradeUpTable } from "./components/TradeUpTable.js";

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function DaemonIndicator({ status }: { status: SyncStatus["daemon_status"] }) {
  if (!status) {
    return (
      <div className="daemon-status daemon-offline">
        <span className="daemon-dot" />
        <span>Daemon offline</span>
      </div>
    );
  }

  const phaseLabels: Record<string, { label: string; className: string }> = {
    fetching: { label: "Fetching", className: "daemon-active" },
    calculating: { label: "Calculating", className: "daemon-active" },
    waiting: { label: "Cooldown", className: "daemon-waiting" },
    idle: { label: "Idle", className: "daemon-idle" },
    error: { label: "Error", className: "daemon-error" },
  };

  const info = phaseLabels[status.phase] ?? { label: status.phase, className: "daemon-idle" };

  return (
    <div className={`daemon-status ${info.className}`}>
      <span className="daemon-dot" />
      <div className="daemon-text">
        <span className="daemon-label">{info.label}</span>
        {status.detail && <span className="daemon-detail">{status.detail}</span>}
      </div>
    </div>
  );
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function App() {
  const [tradeUps, setTradeUps] = useState<TradeUp[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage] = useState(50);
  const [sort, setSort] = useState("profit");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(false);

  // Trade-up type toggle
  const [tradeUpType, setTradeUpType] = useState<"classified_covert" | "covert_knife">("covert_knife");

  // Draft filters (what user types — does NOT trigger fetch)
  const [minProfit, setMinProfit] = useState("");
  const [minRoi, setMinRoi] = useState("");
  const [maxCost, setMaxCost] = useState("");
  const [minChance, setMinChance] = useState("");
  const [maxOutcomes, setMaxOutcomes] = useState("");
  const [skinSearch, setSkinSearch] = useState("");
  const [maxLoss, setMaxLoss] = useState("");
  const [minWin, setMinWin] = useState("");

  // Applied filters (only updated on Apply click — triggers fetch)
  const [appliedFilters, setAppliedFilters] = useState({
    minProfit: "", minRoi: "", maxCost: "", minChance: "", maxOutcomes: "", skinSearch: "", maxLoss: "", minWin: "",
  });

  const applyFilters = useCallback(() => {
    setAppliedFilters({ minProfit, minRoi, maxCost, minChance, maxOutcomes, skinSearch, maxLoss, minWin });
    setPage(1);
  }, [minProfit, minRoi, maxCost, minChance, maxOutcomes, skinSearch, maxLoss, minWin]);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/status");
      const data = await res.json();
      setStatus(data);
    } catch {}
  }, []);

  const fetchTradeUps = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        sort,
        order,
        page: String(page),
        per_page: String(perPage),
        type: tradeUpType,
      });
      const f = appliedFilters;
      if (f.minProfit) params.set("min_profit", String(Math.round(parseFloat(f.minProfit) * 100)));
      if (f.minRoi) params.set("min_roi", f.minRoi);
      if (f.maxCost) params.set("max_cost", String(Math.round(parseFloat(f.maxCost) * 100)));
      if (f.minChance) params.set("min_chance", f.minChance);
      if (f.maxOutcomes) params.set("max_outcomes", f.maxOutcomes);
      if (f.skinSearch.trim()) params.set("skin", f.skinSearch.trim());
      if (f.maxLoss) params.set("max_loss", String(Math.round(parseFloat(f.maxLoss) * 100)));
      if (f.minWin) params.set("min_win", String(Math.round(parseFloat(f.minWin) * 100)));

      const res = await fetch(`/api/trade-ups?${params}`);
      const data: TradeUpListResponse = await res.json();
      setTradeUps(data.trade_ups);
      setTotal(data.total);
    } catch (err) {
      console.error("Failed to fetch trade-ups:", err);
    } finally {
      setLoading(false);
    }
  }, [sort, order, page, perPage, appliedFilters, tradeUpType]);

  useEffect(() => {
    fetchStatus();
    fetchTradeUps();
  }, [fetchStatus, fetchTradeUps]);

  // Auto-refresh
  const prevTradeUpCount = useRef(0);
  useEffect(() => {
    const statusInterval = setInterval(fetchStatus, 10_000);
    const dataInterval = setInterval(async () => {
      const res = await fetch("/api/status").then(r => r.json()).catch(() => null);
      if (res && res.trade_ups_count !== prevTradeUpCount.current) {
        prevTradeUpCount.current = res.trade_ups_count;
        fetchTradeUps();
      }
    }, 30_000);
    return () => { clearInterval(statusInterval); clearInterval(dataInterval); };
  }, [fetchStatus, fetchTradeUps]);

  useEffect(() => {
    if (status) prevTradeUpCount.current = status.trade_ups_count;
  }, [status?.trade_ups_count]);

  const handleSort = (column: string) => {
    if (sort === column) {
      setOrder(order === "desc" ? "asc" : "desc");
    } else {
      setSort(column);
      setOrder("desc");
    }
    setPage(1);
  };

  const totalPages = Math.ceil(total / perPage);

  return (
    <>
      <div className="header">
        <h1>CS2 Trade-Up Bot</h1>
        {status && <DaemonIndicator status={status.daemon_status} />}
      </div>

      {/* Stats bar */}
      <div className="status-bar">
        <div className="status-stats">
          {tradeUpType === "covert_knife" ? (
            <>
              <span className="status-item">
                Knife/Glove Trade-Ups: <strong>{status?.knife_trade_ups?.toLocaleString() ?? "..."}</strong>
                {status && status.knife_profitable > 0 && (
                  <span className="status-highlight"> ({status.knife_profitable.toLocaleString()} profitable)</span>
                )}
              </span>
              <span className="status-item">
                Covert Inputs: <strong>{status?.covert_listings?.toLocaleString() ?? "..."}</strong> listings
                <span className="status-sub"> ({status?.covert_skins ?? "?"}/{status?.covert_total ?? "?"} skins)</span>
              </span>
            </>
          ) : (
            <>
              <span className="status-item">
                Covert Trade-Ups: <strong>{status?.covert_trade_ups?.toLocaleString() ?? "..."}</strong>
                {status && status.covert_profitable > 0 && (
                  <span className="status-highlight"> ({status.covert_profitable.toLocaleString()} profitable)</span>
                )}
              </span>
              <span className="status-item">
                Classified Inputs: <strong>{status?.classified_listings?.toLocaleString() ?? "..."}</strong> listings
                <span className="status-sub"> ({status?.classified_skins ?? "?"}/{status?.classified_total ?? "?"} skins)</span>
              </span>
            </>
          )}
          <span className="status-item">
            Output Prices: <strong>{status?.covert_sale_prices ?? "..."}</strong> sale-based
            {status && status.total_sales > 0 && (
              <span className="status-sub"> ({status.total_sales.toLocaleString()} sales)</span>
            )}
          </span>
          <span className="status-item">
            Last Calc: <strong>{timeAgo(status?.last_calculation ?? null)}</strong>
          </span>
          {status?.exploration_stats && (
            <span className="status-item">
              Passes: <strong>{status.exploration_stats.passes_this_cycle}</strong>
              <span className="status-sub"> (+{status.exploration_stats.new_tradeups_found} new, {status.exploration_stats.tradeups_improved} improved)</span>
            </span>
          )}
        </div>
      </div>

      {/* Type Toggle */}
      <div className="type-toggle">
        <button
          className={tradeUpType === "covert_knife" ? "toggle-active" : ""}
          onClick={() => { setTradeUpType("covert_knife"); setPage(1); }}
        >
          Covert → Knife/Gloves
        </button>
        <button
          className={tradeUpType === "classified_covert" ? "toggle-active" : ""}
          onClick={() => { setTradeUpType("classified_covert"); setPage(1); }}
        >
          Classified → Covert
        </button>
      </div>

      {/* Filter Presets */}
      <div className="filter-presets">
        <span className="presets-label">Quick:</span>
        {[
          { label: "Best Odds $150-300", values: { minChance: "30", maxCost: "300", minProfit: "", minRoi: "", maxOutcomes: "", skinSearch: "", maxLoss: "", minWin: "" } },
          { label: "High Upside", values: { minWin: "500", minChance: "", maxCost: "", minProfit: "", minRoi: "", maxOutcomes: "", skinSearch: "", maxLoss: "" } },
          { label: "Low Risk", values: { minChance: "40", maxLoss: "100", maxCost: "", minProfit: "", minRoi: "", maxOutcomes: "", skinSearch: "", minWin: "" } },
          { label: "Profitable", values: { minProfit: "1", minChance: "", maxCost: "", minRoi: "", maxOutcomes: "", skinSearch: "", maxLoss: "", minWin: "" } },
          { label: "All", values: { minProfit: "", minRoi: "", maxCost: "", minChance: "", maxOutcomes: "", skinSearch: "", maxLoss: "", minWin: "" } },
        ].map((preset) => (
          <button
            key={preset.label}
            className="preset-btn"
            onClick={() => {
              const v = preset.values;
              setMinProfit(v.minProfit); setMinRoi(v.minRoi); setMaxCost(v.maxCost);
              setMinChance(v.minChance); setMaxOutcomes(v.maxOutcomes); setSkinSearch(v.skinSearch);
              setMaxLoss(v.maxLoss); setMinWin(v.minWin);
              setAppliedFilters(v);
              setPage(1);
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="filters">
        <div className="filter-grid">
          <label>
            Min Profit ($)
            <input type="number" value={minProfit} onChange={(e) => setMinProfit(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyFilters()} placeholder="0.00" step="0.01" />
          </label>
          <label>
            Min ROI (%)
            <input type="number" value={minRoi} onChange={(e) => setMinRoi(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyFilters()} placeholder="0" step="1" />
          </label>
          <label>
            Max Cost ($)
            <input type="number" value={maxCost} onChange={(e) => setMaxCost(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyFilters()} placeholder="any" step="1" />
          </label>
          <label>
            Min Chance (%)
            <input type="number" value={minChance} onChange={(e) => setMinChance(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyFilters()} placeholder="0" step="5" min="0" max="100" />
          </label>
          <label>
            Max Outcomes
            <input type="number" value={maxOutcomes} onChange={(e) => setMaxOutcomes(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyFilters()} placeholder="any" step="1" min="1" />
          </label>
          <label>
            Max Loss ($)
            <input type="number" value={maxLoss} onChange={(e) => setMaxLoss(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyFilters()} placeholder="any" step="1" min="0" />
          </label>
          <label>
            Min Best Win ($)
            <input type="number" value={minWin} onChange={(e) => setMinWin(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyFilters()} placeholder="any" step="1" min="0" />
          </label>
          <label>
            Skin Search
            <input type="text" value={skinSearch} onChange={(e) => setSkinSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyFilters()} placeholder="AK-47, AWP..." />
          </label>
        </div>
        <button className="apply-btn" onClick={applyFilters}>Apply</button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="loading">Loading</div>
      ) : tradeUps.length === 0 ? (
        <div className="empty-state">
          {status?.daemon_status?.phase === "calculating" ? (
            <>
              <div className="empty-icon">&#9881;</div>
              <p>Calculating trade-ups...</p>
              <p className="empty-detail">{status.daemon_status.detail}</p>
            </>
          ) : status?.daemon_status?.phase === "fetching" ? (
            <>
              <div className="empty-icon">&#8635;</div>
              <p>Fetching listing data from CSFloat...</p>
              <p className="empty-detail">Trade-ups will appear after the first calculation cycle.</p>
            </>
          ) : (
            <>
              <div className="empty-icon">&#128200;</div>
              <p>No trade-ups found matching your filters.</p>
              <p className="empty-detail">Try adjusting the filters above, or wait for the daemon to collect more data.</p>
            </>
          )}
        </div>
      ) : (
        <>
          <TradeUpTable
            tradeUps={tradeUps}
            sort={sort}
            order={order}
            onSort={handleSort}
          />

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="pagination">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Prev
              </button>
              <span>
                Page {page} of {totalPages} ({total.toLocaleString()} results)
              </span>
              <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                Next
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
