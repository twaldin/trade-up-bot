import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import type { TradeUp, SyncStatus } from "../../shared/types.js";
import { FilterBar, FilterChips, EMPTY_FILTERS, filtersToParams } from "../components/FilterBar.js";
import type { Filters } from "../components/FilterBar.js";
import { Button } from "@shared/components/ui/button.js";
import { useDebouncedValue } from "../hooks/useDebouncedValue.js";
import { PreviewTradeUpBoard } from "../components/preview/PreviewTradeUpBoard.js";

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

// URL params this page owns; anything else (e.g. ref= attribution) is preserved on sync.
const OWNED_PARAMS = ["skin", "collection", "min_profit", "max_profit", "min_roi", "max_roi",
  "min_cost", "max_cost", "min_chance", "max_chance", "max_loss", "min_win", "markets",
  "sort", "order", "page", "stale", "type"];

function UpgradeBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 my-2 border border-white/15 rounded-[2px] text-sm text-neutral-200">
      <span>{message}</span>
      <a href="/pricing" className="text-white hover:text-neutral-200 font-medium cursor-pointer whitespace-nowrap ml-4">
        View Plans →
      </a>
    </div>
  );
}

export function PreviewTradeUpsPage({ types, defaultType, status, refreshKey, onNavigateSkin, onNavigateCollection }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();

  const [tradeUps, setTradeUps] = useState<TradeUp[]>([]);
  const [total, setTotal] = useState(0);
  const [totalProfitable, setTotalProfitable] = useState(0);
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState<boolean>(true);
  const [tier, setTier] = useState<string>(() => {
    if (typeof window !== "undefined") return localStorage.getItem("user_tier") || "free";
    return "free";
  });
  const [claimLimit, setClaimLimit] = useState<{ remaining: number; total: number; resetIn: number | null } | null>(null);
  const [verifyLimit, setVerifyLimit] = useState<{ remaining: number; total: number; resetIn: number | null } | null>(null);

  const initialType = (searchParams.get("type") as TradeUpType) || defaultType || types[0]?.value;
  const [type, setType] = useState<TradeUpType>(initialType);
  const [page, setPage] = useState(() => parseInt(searchParams.get("page") || "1"));
  const [perPage] = useState(50);
  const [sort] = useState(() => searchParams.get("sort") || "trade_up_score");
  const [order] = useState<"asc" | "desc">(() => (searchParams.get("order") as "asc" | "desc") || "desc");
  const [includeStale, setIncludeStale] = useState(() => searchParams.get("stale") === "true");
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
    const marketsParam = searchParams.get("markets");
    if (marketsParam) f.markets = marketsParam.split(",");
    return f;
  });
  const debouncedFilters = useDebouncedValue(filters, 300);
  const filtersSettled = filters === debouncedFilters;
  const isFree = tier === "free";

  useEffect(() => {
    setSearchParams(prev => {
      const params = new URLSearchParams(prev);
      for (const key of OWNED_PARAMS) params.delete(key);
      for (const [key, value] of filtersToParams(filters)) params.set(key, value);
      if (sort !== "trade_up_score") params.set("sort", sort);
      if (order !== "desc") params.set("order", order);
      if (page > 1) params.set("page", String(page));
      if (includeStale) params.set("stale", "true");
      if (type !== types[0]?.value) params.set("type", type);
      return params;
    }, { replace: true });
  }, [sort, order, page, includeStale, filters, type, setSearchParams, types]);

  const handleFiltersChange = useCallback((f: Filters) => {
    setFilters(f);
    setPage(1);
  }, []);

  const abortRef = useRef<AbortController | null>(null);

  const fetchTradeUps = useCallback(async (silent = false) => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (!silent) setLoading(true);
    try {
      const params = filtersToParams(debouncedFilters);
      params.set("sort", sort);
      params.set("order", order);
      params.set("page", String(page));
      params.set("per_page", String(perPage));
      if (type !== "all") {
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
      setSignedIn(Boolean(data.signed_in));
      try { localStorage.setItem("user_tier", newTier); } catch {}
      if (data.claim_limit) setClaimLimit(data.claim_limit);
      if (data.verify_limit) setVerifyLimit(data.verify_limit);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      console.error("Failed to fetch trade-ups:", err);
    } finally {
      if (!controller.signal.aborted && !silent) setLoading(false);
    }
  }, [sort, order, page, perPage, debouncedFilters, type, includeStale, refreshKey]);

  useEffect(() => {
    if (!filtersSettled) return;
    fetchTradeUps();
    return () => { if (abortRef.current) abortRef.current.abort(); };
  }, [fetchTradeUps, filtersSettled]);

  const handleTypeChange = (newType: TradeUpType) => {
    setType(newType);
    setPage(1);
    setLoading(true);
  };

  const totalPages = Math.ceil(total / perPage);

  return (
    <div data-preview-trade-ups className="text-white">
      <title>Trade-Ups Preview — TradeUpBot</title>
      <meta name="robots" content="noindex, nofollow" />
      <meta name="description" content="Internal design preview of the trade-up board. Not an indexable product page." />

      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-neutral-500 mb-1">Preview only</p>
          <h1 className="text-base font-semibold">Contract board remix</h1>
          <p className="text-xs text-neutral-500 mt-1">
            Live `GET /api/trade-ups`. Not a cutover. Image-first rows and an inspect pane.
          </p>
        </div>
      </div>

      {types.length > 1 && (
        <div className="flex items-center gap-1.5 md:gap-2 mb-3 flex-wrap">
          {types.map((t) => {
            const isActive = type === t.value;
            return (
              <button
                key={t.value}
                className={`px-3 py-1 text-xs font-medium rounded-[2px] border cursor-pointer ${
                  isActive
                    ? "border-white/40 bg-white/10 text-white"
                    : "border-transparent text-neutral-500 hover:text-white"
                }`}
                onClick={() => handleTypeChange(t.value)}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <FilterBar filters={filters} onFiltersChange={handleFiltersChange} />
        </div>
        <label className="flex items-center gap-1.5 text-sm text-neutral-500 cursor-pointer select-none whitespace-nowrap shrink-0">
          <input
            type="checkbox"
            checked={includeStale}
            onChange={(e) => { setIncludeStale(e.target.checked); setPage(1); }}
          />
          Show stale
        </label>
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-1.5 min-h-[20px]">
        {loading && <span className="text-xs text-neutral-500 animate-pulse">Loading...</span>}
        <FilterChips filters={filters} onUpdate={handleFiltersChange} />
      </div>

      {!loading && tradeUps.length === 0 ? (
        <div className="text-center py-16 px-5 text-neutral-500">
          {status?.daemon_status?.phase === "calculating" ? (
            <>
              <p className="mb-2">Calculating trade-ups from current listings...</p>
              <p className="text-sm text-neutral-600">{status.daemon_status.detail}</p>
            </>
          ) : status?.daemon_status?.phase === "fetching" ? (
            <>
              <p className="mb-2">Fetching listings from CSFloat...</p>
              <p className="text-sm text-neutral-600">Trade-ups appear after the first calculation cycle, usually within a few minutes.</p>
            </>
          ) : (
            <>
              <p className="mb-2">No trade-ups match these filters.</p>
              <p className="text-sm text-neutral-600">Widen a range, clear a filter, or check Show stale to include sold-out contracts.</p>
            </>
          )}
        </div>
      ) : (
        <>
          {isFree && !loading && (
            <UpgradeBanner message="Free view: contracts are delayed 3 hours. Pro sees them the moment they're found." />
          )}
          <PreviewTradeUpBoard
            tradeUps={tradeUps}
            total={total}
            totalProfitable={totalProfitable}
            page={page}
            perPage={perPage}
            loading={loading}
            tier={tier}
            signedIn={signedIn}
            claimLimit={claimLimit}
            verifyLimit={verifyLimit}
            onClaimLimitUpdate={setClaimLimit}
            onVerifyLimitUpdate={setVerifyLimit}
            onNavigateSkin={onNavigateSkin}
            onNavigateCollection={onNavigateCollection}
          />

          {totalPages > 1 && (
            <div className="flex gap-2 justify-center items-center mt-4 text-sm text-neutral-500">
              <Button variant="outline" size="sm" className="rounded-[2px]" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Prev
              </Button>
              <span>
                Page {page} of {totalPages} ({total.toLocaleString()} results)
              </span>
              <Button variant="outline" size="sm" className="rounded-[2px]" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
