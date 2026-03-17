import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import type { TradeUp, TradeUpListResponse, SyncStatus } from "../../shared/types.js";
import { TradeUpTable } from "../components/TradeUpTable.js";
import { FilterBar, EMPTY_FILTERS, filtersToParams } from "../components/FilterBar.js";
import type { Filters } from "../components/FilterBar.js";
import { formatDollars } from "../utils/format.js";
import { Button } from "@shared/components/ui/button.js";

type TradeUpType = "all" | "covert_knife" | "classified_covert" | "restricted_classified" | "milspec_restricted" | "industrial_milspec";

interface TypeOption {
  value: TradeUpType;
  label: string;
}

interface Props {
  types: TypeOption[];
  defaultType?: TradeUpType;
  status: SyncStatus | null;
  refreshKey?: number;
  onNavigateSkin: (skinName: string) => void;
  onNavigateCollection: (name: string) => void;
}

export function TradeUpsPage({ types, defaultType, status, refreshKey, onNavigateSkin, onNavigateCollection }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();

  const [tradeUps, setTradeUps] = useState<TradeUp[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [tierInfo, setTierInfo] = useState<{ delay: number; limit: number; showListingIds: boolean } | null>(null);

  // Read initial state from URL search params
  const initialType = (searchParams.get("type") as TradeUpType) || defaultType || types[0]?.value;
  const [type, setType] = useState<TradeUpType>(initialType);
  const [page, setPage] = useState(() => parseInt(searchParams.get("page") || "1"));
  const [perPage] = useState(50);
  const [sort, setSort] = useState(() => searchParams.get("sort") || "profit");
  const [order, setOrder] = useState<"asc" | "desc">(() => (searchParams.get("order") as "asc" | "desc") || "desc");
  const [includeStale, setIncludeStale] = useState(() => searchParams.get("stale") === "true");

  // Filters from URL
  const [filters, setFilters] = useState<Filters>(() => {
    const f = { ...EMPTY_FILTERS };
    const skin = searchParams.get("skin");
    if (skin) f.skins = skin.split("||");
    const col = searchParams.get("collection");
    if (col) f.collections = col.split("|");
    if (searchParams.get("min_profit")) f.minProfit = String(parseInt(searchParams.get("min_profit")!) / 100);
    if (searchParams.get("max_profit")) f.maxProfit = String(parseInt(searchParams.get("max_profit")!) / 100);
    if (searchParams.get("min_roi")) f.minRoi = searchParams.get("min_roi")!;
    if (searchParams.get("max_roi")) f.maxRoi = searchParams.get("max_roi")!;
    if (searchParams.get("min_cost")) f.minCost = String(parseInt(searchParams.get("min_cost")!) / 100);
    if (searchParams.get("max_cost")) f.maxCost = String(parseInt(searchParams.get("max_cost")!) / 100);
    if (searchParams.get("min_chance")) f.minChance = searchParams.get("min_chance")!;
    if (searchParams.get("max_chance")) f.maxChance = searchParams.get("max_chance")!;
    if (searchParams.get("max_loss")) f.maxLoss = String(parseInt(searchParams.get("max_loss")!) / 100);
    if (searchParams.get("min_win")) f.minWin = String(parseInt(searchParams.get("min_win")!) / 100);
    return f;
  });
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Sync state to URL search params
  useEffect(() => {
    const params = filtersToParams(filters);
    if (sort !== "profit") params.set("sort", sort);
    if (order !== "desc") params.set("order", order);
    if (page > 1) params.set("page", String(page));
    if (includeStale) params.set("stale", "true");
    if (type !== types[0]?.value) params.set("type", type);
    setSearchParams(params, { replace: true });
  }, [sort, order, page, includeStale, filters, type, setSearchParams, types]);

  const handleFiltersChange = useCallback((f: Filters) => {
    setFilters(f);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setPage(1), 300);
  }, []);

  const fetchTradeUps = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params = filtersToParams(filters);
      params.set("sort", sort);
      params.set("order", order);
      params.set("page", String(page));
      params.set("per_page", String(perPage));
      if (type !== "all") {
        params.set("type", type);
      }
      if (includeStale) params.set("include_stale", "true");

      // Forward admin view_as param from browser URL to API
      const viewAs = new URLSearchParams(window.location.search).get("view_as");
      if (viewAs) params.set("view_as", viewAs);

      const res = await fetch(`/api/trade-ups?${params}`, { credentials: "include" });
      const data = await res.json();
      setTradeUps(data.trade_ups);
      setTotal(data.total);
      setTierInfo(data.tier_config || null);
    } catch (err) {
      console.error("Failed to fetch trade-ups:", err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [sort, order, page, perPage, filters, type, includeStale, refreshKey]);

  useEffect(() => {
    fetchTradeUps();
  }, [fetchTradeUps]);

  const handleSort = (column: string) => {
    if (sort === column) {
      setOrder(order === "desc" ? "asc" : "desc");
    } else {
      setSort(column);
      setOrder("desc");
    }
    setPage(1);
  };

  const handleTypeChange = (newType: TradeUpType) => {
    setType(newType);
    setPage(1);
  };

  const totalPages = Math.ceil(total / perPage);

  // Active claims panel
  const [claims, setClaims] = useState<any[]>([]);
  const [showClaims, setShowClaims] = useState(false);
  useEffect(() => {
    fetch("/api/claims", { credentials: "include" })
      .then(r => r.json())
      .then(data => { if (Array.isArray(data?.claims)) setClaims(data.claims); })
      .catch(() => {});
  }, [refreshKey]);

  return (
    <>
      {/* Active claims panel */}
      {claims.length > 0 && (
        <div className="mb-3">
          <button
            className="text-[0.75rem] text-purple-400 hover:text-purple-300 cursor-pointer mb-1"
            onClick={() => setShowClaims(!showClaims)}
          >
            {showClaims ? "▼" : "▶"} Your Claims ({claims.length}/5)
          </button>
          {showClaims && (
            <div className="grid gap-1.5">
              {claims.map((c: any) => {
                const expiresIn = Math.max(0, Math.round((new Date(c.expires_at).getTime() - Date.now()) / 60000));
                const tu = c.trade_up || {};
                return (
                  <div key={c.id} className="flex items-center justify-between px-3 py-2 bg-purple-950/20 border border-purple-900/50 rounded-md text-xs">
                    <div>
                      <span className="text-foreground font-medium">{(tu.type || "")?.replace("_", "→")}</span>
                      <span className="text-green-500 ml-2">{formatDollars(tu.profit_cents)}</span>
                      <span className="text-muted-foreground ml-2">{((tu.chance_to_profit || 0) * 100).toFixed(0)}% chance</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-purple-400">{expiresIn}m left</span>
                      <button
                        className="px-1.5 py-0.5 text-[0.65rem] rounded border border-border text-muted-foreground hover:text-red-400 hover:border-red-400 cursor-pointer"
                        onClick={async () => {
                          await fetch(`/api/trade-ups/${c.trade_up_id}/claim`, { method: "DELETE", credentials: "include" });
                          setClaims(prev => prev.filter(x => x.id !== c.id));
                        }}
                      >
                        Release
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tier banner */}
      {tierInfo && tierInfo.delay > 0 && (
        <div className="mb-3 px-3.5 py-2 bg-yellow-950/30 border border-yellow-500/30 rounded-md text-xs text-yellow-200 flex items-center justify-between">
          <span>
            {tierInfo.delay >= 1800 ? "30-minute" : "5-minute"} delay active
            {!tierInfo.showListingIds && " · Listing links hidden"}
            {tierInfo.limit > 0 && ` · ${tierInfo.limit} results per type`}
          </span>
          <button className="text-yellow-400 hover:text-yellow-300 font-medium cursor-pointer" onClick={async () => {
            const res = await fetch("/api/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ plan: "pro" }) });
            if (res.status === 401) { window.location.href = "/auth/steam"; return; }
            const data = await res.json();
            if (data.url) window.location.href = data.url;
            else if (data.error) alert(data.error);
          }}>
            Upgrade →
          </button>
        </div>
      )}

      {/* Type selector */}
      {types.length > 1 && (
        <div className="flex gap-0 mb-2 w-fit">
          {types.map((t, i) => (
            <button
              key={t.value}
              className={`px-5 py-2 text-sm border border-border transition-colors cursor-pointer ${
                i === 0 ? "rounded-l-md" : ""
              } ${i === types.length - 1 ? "rounded-r-md" : ""} ${
                i > 0 ? "border-l-0" : ""
              } ${
                type === t.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              onClick={() => handleTypeChange(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <FilterBar filters={filters} onFiltersChange={handleFiltersChange} />

      <div className="flex items-center justify-between mb-2">
        {/* Tab-specific stats */}
        {!loading && total > 0 && (() => {
          const profitable = tradeUps.filter(t => t.profit_cents > 0).length;
          const bestProfit = tradeUps.length > 0 ? Math.max(...tradeUps.map(t => t.profit_cents)) : 0;
          return (
            <span className="text-sm text-muted-foreground">
              {total.toLocaleString()} results
              <span className="mx-1.5 text-border">·</span>
              <span className={profitable > 0 ? "text-green-500" : ""}>{profitable} profitable</span>
              {bestProfit > 0 && <>
                <span className="mx-1.5 text-border">·</span>
                Best: <span className="text-green-500 font-medium">{formatDollars(bestProfit)}</span>
              </>}
              {status && <>
                <span className="mx-1.5 text-border">·</span>
                <span>{status.total_listings?.toLocaleString()} listings</span>
                <span className="mx-1.5 text-border">·</span>
                <span>{status.total_sales?.toLocaleString()} sales</span>
              </>}
            </span>
          );
        })()}
        {(loading || total === 0) && <span />}
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer select-none" title="Show trade-ups with missing input listings (sold/delisted)">
          <input
            type="checkbox"
            checked={includeStale}
            onChange={(e) => { setIncludeStale(e.target.checked); setPage(1); }}
            className="accent-red-500"
          />
          Show stale
        </label>
      </div>

      {loading ? (
        <div className="text-center py-8 text-muted-foreground animate-pulse">Loading</div>
      ) : tradeUps.length === 0 ? (
        <div className="text-center py-16 px-5 text-muted-foreground">
          {status?.daemon_status?.phase === "calculating" ? (
            <>
              <div className="text-4xl mb-3 opacity-50">&#9881;</div>
              <p className="mb-2">Calculating trade-ups...</p>
              <p className="text-sm text-muted-foreground/70">{status.daemon_status.detail}</p>
            </>
          ) : status?.daemon_status?.phase === "fetching" ? (
            <>
              <div className="text-4xl mb-3 opacity-50">&#8635;</div>
              <p className="mb-2">Fetching listing data from CSFloat...</p>
              <p className="text-sm text-muted-foreground/70">Trade-ups will appear after the first calculation cycle.</p>
            </>
          ) : (
            <>
              <div className="text-4xl mb-3 opacity-50">&#128200;</div>
              <p className="mb-2">No trade-ups found matching your filters.</p>
              <p className="text-sm text-muted-foreground/70">Try adjusting the filters above, or wait for the daemon to collect more data.</p>
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
            onNavigateSkin={onNavigateSkin}
            onNavigateCollection={onNavigateCollection}
          />

          {totalPages > 1 && (
            <div className="flex gap-2 justify-center items-center mt-4 text-sm text-muted-foreground">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Prev
              </Button>
              <span>
                Page {page} of {totalPages} ({total.toLocaleString()} results)
              </span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}
