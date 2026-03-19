import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import type { TradeUp, TradeUpListResponse, SyncStatus } from "../../shared/types.js";
import { TradeUpTable } from "../components/TradeUpTable.js";
import { FilterBar, FilterChips, EMPTY_FILTERS, filtersToParams } from "../components/FilterBar.js";
import type { Filters } from "../components/FilterBar.js";
import { Button } from "@shared/components/ui/button.js";
type TradeUpType = "all" | "covert_knife" | "classified_covert" | "restricted_classified" | "milspec_restricted" | "industrial_milspec" | "consumer_industrial";

interface TypeOption {
  value: TradeUpType;
  label: string;
  color?: string;
}

interface Props {
  types: TypeOption[];
  defaultType?: TradeUpType;
  status: SyncStatus | null;
  refreshKey?: number;
  onNavigateSkin: (skinName: string) => void;
  onNavigateCollection: (name: string) => void;
}

function UpgradeBanner({ message, plan }: { message: string; plan: "basic" | "pro" }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 my-2 bg-yellow-950/30 border border-yellow-500/30 rounded-md text-sm text-yellow-200">
      <span>{message}</span>
      <a href="/pricing" className="text-yellow-400 hover:text-yellow-300 font-medium cursor-pointer whitespace-nowrap ml-4">
        View Plans →
      </a>
    </div>
  );
}

export function TradeUpsPage({ types, defaultType, status, refreshKey, onNavigateSkin, onNavigateCollection }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();

  const [tradeUps, setTradeUps] = useState<TradeUp[]>([]);
  const [total, setTotal] = useState(0);
  const [totalProfitable, setTotalProfitable] = useState(0);
  const [loading, setLoading] = useState(true); // Start loading to prevent empty state flash
  const [tier, setTier] = useState<string>(() => {
    // Persist tier to avoid "free tier" upgrade banner flash on mount
    if (typeof window !== "undefined") return localStorage.getItem("user_tier") || "free";
    return "free";
  });
  const [myClaimCount, setMyClaimCount] = useState(0);
  const [claimLimit, setClaimLimit] = useState<{ remaining: number; total: number; resetIn: number | null } | null>(null);
  const [verifyLimit, setVerifyLimit] = useState<{ remaining: number; total: number; resetIn: number | null } | null>(null);

  // Read initial state from URL search params
  const initialType = (searchParams.get("type") as TradeUpType) || defaultType || types[0]?.value;
  const [type, setType] = useState<TradeUpType>(initialType);
  const [page, setPage] = useState(() => parseInt(searchParams.get("page") || "1"));
  const [perPage] = useState(50);
  const [sort, setSort] = useState(() => searchParams.get("sort") || "profit");
  const [order, setOrder] = useState<"asc" | "desc">(() => (searchParams.get("order") as "asc" | "desc") || "desc");
  const [includeStale, setIncludeStale] = useState(() => searchParams.get("stale") === "true");
  const [showMyClaims, setShowMyClaims] = useState(false);

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

  const isFree = tier === "free";
  const isBasic = tier === "basic";
  const isPro = tier === "pro" || tier === "admin";

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

  // Cancel in-flight requests when sort/filter/type changes
  const abortRef = useRef<AbortController | null>(null);

  const fetchTradeUps = useCallback(async (silent = false) => {
    // Cancel any previous in-flight request
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (!silent) setLoading(true);
    try {
      const params = filtersToParams(filters);
      params.set("sort", sort);
      params.set("order", order);
      params.set("page", String(page));
      params.set("per_page", String(perPage));
      if (showMyClaims) {
        params.set("my_claims", "true");
      } else if (type !== "all") {
        params.set("type", type);
      }
      if (includeStale) params.set("include_stale", "true");

      const res = await fetch(`/api/trade-ups?${params}`, {
        credentials: "include",
        signal: controller.signal,
      });
      const data = await res.json();
      setTradeUps(data.trade_ups);
      setTotal(data.total);
      setTotalProfitable(data.total_profitable ?? 0);
      const newTier = data.tier || "free";
      setTier(newTier);
      try { localStorage.setItem("user_tier", newTier); } catch {}
      setMyClaimCount(data.my_claim_count ?? 0);
      if (data.claim_limit) setClaimLimit(data.claim_limit);
      if (data.verify_limit) setVerifyLimit(data.verify_limit);
    } catch (err) {
      if ((err as Error).name === "AbortError") return; // cancelled — ignore
      console.error("Failed to fetch trade-ups:", err);
    } finally {
      if (!controller.signal.aborted && !silent) setLoading(false);
    }
  }, [sort, order, page, perPage, filters, type, includeStale, refreshKey, showMyClaims]);

  useEffect(() => {
    fetchTradeUps();
    return () => { if (abortRef.current) abortRef.current.abort(); };
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

  // Server handles sorting for all tiers now
  const sortedTradeUps = tradeUps;

  const handleTypeChange = (newType: TradeUpType) => {
    // Batch state updates: set loading with type change so old data
    // stays dimmed (no flash of empty state between renders)
    setShowMyClaims(false);
    setType(newType);
    setPage(1);
    setLoading(true);
  };

  const handleClaimChange = useCallback((delta: number) => {
    setMyClaimCount(c => {
      const next = Math.max(0, c + delta);
      // Auto-navigate back to "all" when last claim released
      if (next === 0) setShowMyClaims(false);
      return next;
    });
  }, []);

  const totalPages = Math.ceil(total / perPage);

  return (
    <>
      {/* Type selector + Your Claims button */}
      {types.length > 1 && (
        <div className="flex items-center gap-1.5 md:gap-2 mb-3 flex-wrap">
          {types.map((t) => {
            const isActive = !showMyClaims && type === t.value;
            return (
              <button
                key={t.value}
                className={`px-3 md:px-4 py-1 md:py-1.5 text-xs md:text-sm font-medium rounded-full border transition-colors cursor-pointer ${
                  isActive
                    ? (t.color || "border-foreground/40 bg-foreground/10 text-foreground")
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => handleTypeChange(t.value)}
              >
                {t.label}
              </button>
            );
          })}
          {(isPro || isBasic) && myClaimCount > 0 && (
            <button
              className={`px-3 md:px-4 py-1 md:py-1.5 text-xs md:text-sm font-medium rounded-full border transition-colors cursor-pointer ${
                showMyClaims
                  ? "border-purple-500/40 bg-purple-500/10 text-purple-500"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => { setShowMyClaims(!showMyClaims); setPage(1); setLoading(true); }}
            >
              Your Claims ({myClaimCount})
            </button>
          )}
        </div>
      )}

      {/* Filters + Show stale */}
      {(
        <div className="flex items-center gap-3 mb-2">
          <div className="flex-1 min-w-0">
            <FilterBar filters={filters} onFiltersChange={handleFiltersChange} />
          </div>
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer select-none whitespace-nowrap shrink-0" title="Show trade-ups with missing input listings (sold/delisted)">
            <input
              type="checkbox"
              checked={includeStale}
              onChange={(e) => { setIncludeStale(e.target.checked); setPage(1); }}
              className="accent-red-500"
            />
            Show stale
          </label>
        </div>
      )}

      {/* Results summary + active filter chips — always visible */}
      <div className="flex items-center gap-2 flex-wrap mb-1.5 min-h-[20px]">
        {total > 0 && (
          <span className={`text-xs text-muted-foreground whitespace-nowrap ${loading ? "opacity-50" : ""}`}>
            {total.toLocaleString()} found{totalProfitable > 0 && <> (<span className="text-green-500">{totalProfitable.toLocaleString()} profitable</span>)</>}
          </span>
        )}
        {loading && <span className="text-xs text-muted-foreground animate-pulse">Loading...</span>}
        <FilterChips filters={filters} onUpdate={handleFiltersChange} />
      </div>

      {/* Empty state — only when not loading AND no data */}
      {!loading && tradeUps.length === 0 ? (
        <div className="text-center py-16 px-5 text-muted-foreground">
          {showMyClaims ? (
            <>
              <p className="mb-2">No active claims.</p>
              <p className="text-sm text-muted-foreground/70">Expand a profitable trade-up and click Claim to lock its listings for 30 minutes.</p>
            </>
          ) : status?.daemon_status?.phase === "calculating" ? (
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
        <div className={loading ? "opacity-50 pointer-events-none transition-opacity" : "transition-opacity"}>
          <TradeUpTable
            tradeUps={sortedTradeUps}
            sort={sort}
            order={order}
            onSort={handleSort}
            onNavigateSkin={onNavigateSkin}
            onNavigateCollection={onNavigateCollection}
            onClaimChange={(isPro || isBasic) ? handleClaimChange : undefined}
            tier={tier}
            showMyClaims={showMyClaims}
            claimLimit={claimLimit}
            verifyLimit={verifyLimit}
            onClaimLimitUpdate={setClaimLimit}
            onVerifyLimitUpdate={setVerifyLimit}
          />

          {/* Free tier: upgrade banner */}
          {isFree && !loading && (
            <UpgradeBanner message="Upgrade to Basic for verification, claims, and 30-minute data delay" plan="basic" />
          )}

          {/* Basic tier: upgrade banner for real-time + more claims */}
          {isBasic && !loading && (
            <UpgradeBanner message="Viewing with 30-minute delay. Upgrade to Pro for real-time data and unlimited claims." plan="pro" />
          )}

          {/* Pagination — all tiers */}
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
        </div>
      )}
    </>
  );
}
