import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FilterBar, FilterChips, EMPTY_FILTERS, filtersToParams } from "../../components/FilterBar.js";
import type { Filters } from "../../components/FilterBar.js";
import { useDebouncedValue } from "../../hooks/useDebouncedValue.js";
import { TRADE_UP_TYPE_TABS } from "../../utils/rarity.js";
import { PreviewTradeUpBoard } from "../board/PreviewTradeUpBoard.js";
import { usePreviewContracts } from "../board/usePreviewContracts.js";

type TradeUpType = "all" | "covert_knife" | "classified_covert" | "restricted_classified" | "milspec_restricted" | "industrial_milspec" | "consumer_industrial";

const OWNED_PARAMS = ["skin", "collection", "min_profit", "max_profit", "min_roi", "max_roi",
  "min_cost", "max_cost", "min_chance", "max_chance", "max_loss", "min_win", "markets",
  "sort", "order", "page", "stale", "type"];

export function PreviewTradeUpsDashboard({
  inspectable = true,
  showFilters = true,
  perPage = 24,
}: {
  inspectable?: boolean;
  showFilters?: boolean;
  perPage?: number;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialType = (searchParams.get("type") as TradeUpType) || "all";
  const [type, setType] = useState<TradeUpType>(initialType);
  const [page, setPage] = useState(() => parseInt(searchParams.get("page") || "1"));
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
  const contracts = usePreviewContracts({
    filters: debouncedFilters,
    type,
    page,
    perPage,
    sort,
    order,
    includeStale,
    filtersSettled,
  });
  const isFree = contracts.tier === "free";

  useEffect(() => {
    if (!showFilters) return;
    setSearchParams(prev => {
      const params = new URLSearchParams(prev);
      for (const key of OWNED_PARAMS) params.delete(key);
      for (const [key, value] of filtersToParams(filters)) params.set(key, value);
      if (sort !== "trade_up_score") params.set("sort", sort);
      if (order !== "desc") params.set("order", order);
      if (page > 1) params.set("page", String(page));
      if (includeStale) params.set("stale", "true");
      if (type !== "all") params.set("type", type);
      return params;
    }, { replace: true });
  }, [sort, order, page, includeStale, filters, type, setSearchParams, showFilters]);

  const handleFiltersChange = useCallback((next: Filters) => {
    setFilters(next);
    setPage(1);
  }, []);

  const totalPages = Math.max(1, Math.ceil(contracts.total / perPage));

  return (
    <div data-preview-trade-ups>
      {isFree && !contracts.loading && (
        <div className="pv-accent-banner">
          Free view: contracts are delayed 3 hours. Pro sees them the moment they're found.
        </div>
      )}
      <section className="pv-page-intro">
        <h2>Find Profitable CS2 Trade-Up Contracts</h2>
        <p>
          Every contract below is built from real, buyable listings on CSFloat, DMarket, Skinport, and Buff.market, with marketplace fees on both sides already priced in. Filter by profit, ROI, cost, or outcome odds across every rarity tier — Knife, Glove, Covert, Classified, Restricted, Mil-Spec.
        </p>
      </section>

      {showFilters && (
        <label className="pv-stale">
          <input type="checkbox" checked={includeStale} onChange={e => { setIncludeStale(e.target.checked); setPage(1); }} />
          Show stale
        </label>
      )}

      <div className="pv-typebar">
        {TRADE_UP_TYPE_TABS.map(t => (
          <button
            key={t.value}
            type="button"
            className={type === t.value ? "pv-active" : ""}
            onClick={() => { setType(t.value); setPage(1); }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {showFilters && (
        <div className="pv-filters">
          <FilterBar filters={filters} onFiltersChange={handleFiltersChange} />
          <FilterChips filters={filters} onUpdate={handleFiltersChange} />
        </div>
      )}

      {!contracts.loading && contracts.tradeUps.length === 0 ? (
        <div className="pv-muted pv-empty-board">No trade-ups match these filters.</div>
      ) : (
        <PreviewTradeUpBoard
          tradeUps={contracts.tradeUps}
          loading={contracts.loading}
          tier={contracts.tier}
          signedIn={contracts.signedIn}
          claimLimit={contracts.claimLimit}
          verifyLimit={contracts.verifyLimit}
          onClaimLimitUpdate={contracts.setClaimLimit}
          onVerifyLimitUpdate={contracts.setVerifyLimit}
          inspectable={inspectable}
        />
      )}

      {showFilters && totalPages > 1 && (
        <div className="pv-pager">
          <button type="button" className="pv-btn pv-btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
          <span className="pv-muted pv-tabular">Page {page} of {totalPages}</span>
          <button type="button" className="pv-btn pv-btn-ghost" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}

export function PreviewTradeUpsPage() {
  return (
    <div>
      <title>Profitable CS2 Trade-Ups — Live Contracts from Real Listings | TradeUpBot</title>
      <meta name="robots" content="noindex, nofollow" />
      <PreviewTradeUpsDashboard />
    </div>
  );
}
