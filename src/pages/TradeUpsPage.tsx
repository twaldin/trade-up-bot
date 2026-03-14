import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import type { TradeUp, TradeUpListResponse, SyncStatus } from "../../shared/types.js";
import { TradeUpTable } from "../components/TradeUpTable.js";
import { FilterBar, EMPTY_FILTERS, filtersToParams } from "../components/FilterBar.js";
import type { Filters } from "../components/FilterBar.js";

type TradeUpType = "covert_knife" | "theory_knife" | "classified_covert" | "classified_covert_st" | "staircase" | "theory_classified" | "theory_staircase";

interface TypeOption {
  value: TradeUpType;
  label: string;
}

interface Props {
  types: TypeOption[];
  defaultType?: TradeUpType;
  status: SyncStatus | null;
  onNavigateSkin: (skinName: string) => void;
  onNavigateCollection: (name: string) => void;
}

export function TradeUpsPage({ types, defaultType, status, onNavigateSkin, onNavigateCollection }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();

  const [tradeUps, setTradeUps] = useState<TradeUp[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

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

  // Map frontend type names to API type param
  const apiType = type === "theory_classified" ? "classified_covert"
    : type === "theory_staircase" ? "staircase"
    : type;
  const isTheory = type === "theory_knife" || type === "theory_classified" || type === "theory_staircase";

  const fetchTradeUps = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params = filtersToParams(filters);
      params.set("sort", sort);
      params.set("order", order);
      params.set("page", String(page));
      params.set("per_page", String(perPage));
      // For theory types, we need to tell the API it's a theory query
      if (isTheory) {
        params.set("type", "theory_knife"); // triggers is_theoretical=1 filter
        // Always filter by the underlying type so tabs don't mix
        if (type === "theory_knife") params.set("theory_type", "covert_knife");
        else if (type === "theory_classified") params.set("theory_type", "classified_covert");
        else if (type === "theory_staircase") params.set("theory_type", "staircase");
      } else {
        params.set("type", apiType);
      }
      if (includeStale) params.set("include_stale", "true");

      const res = await fetch(`/api/trade-ups?${params}`);
      const data: TradeUpListResponse = await res.json();
      setTradeUps(data.trade_ups);
      setTotal(data.total);
    } catch (err) {
      console.error("Failed to fetch trade-ups:", err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [sort, order, page, perPage, filters, type, apiType, isTheory, includeStale]);

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

  return (
    <>
      {isTheory && (
        <div className="theory-notice">
          Theory estimates — optimistic screener, discovery validates. Inputs priced via float-aware KNN.
        </div>
      )}

      {/* Type selector */}
      {types.length > 1 && (
        <div className="dv-rarity-tabs" style={{ marginBottom: 8 }}>
          {types.map(t => (
            <button
              key={t.value}
              className={type === t.value ? "toggle-active" : ""}
              onClick={() => handleTypeChange(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <FilterBar filters={filters} onFiltersChange={handleFiltersChange} />

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <label className="stale-toggle" title="Show trade-ups with missing input listings (sold/delisted)">
          <input
            type="checkbox"
            checked={includeStale}
            onChange={(e) => { setIncludeStale(e.target.checked); setPage(1); }}
          />
          Show stale
        </label>
      </div>

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
            onNavigateSkin={onNavigateSkin}
            onNavigateCollection={onNavigateCollection}
          />

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
