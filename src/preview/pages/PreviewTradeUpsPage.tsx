import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { TradeUp, TradeUpOutcome } from "../../../shared/types.js";
import { FilterBar, FilterChips, EMPTY_FILTERS, filtersToParams } from "../../components/FilterBar.js";
import type { Filters } from "../../components/FilterBar.js";
import { useDebouncedValue } from "../../hooks/useDebouncedValue.js";
import { TRADE_UP_TYPE_TABS } from "../../utils/rarity.js";
import { PreviewTradeUpBoard } from "../board/PreviewTradeUpBoard.js";

type TradeUpType = "all" | "covert_knife" | "classified_covert" | "restricted_classified" | "milspec_restricted" | "industrial_milspec" | "consumer_industrial";

const OWNED_PARAMS = ["skin", "collection", "min_profit", "max_profit", "min_roi", "max_roi",
  "min_cost", "max_cost", "min_chance", "max_chance", "max_loss", "min_win", "markets",
  "sort", "order", "page", "stale", "type"];

export function PreviewTradeUpsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tradeUps, setTradeUps] = useState<TradeUp[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(true);
  const [tier, setTier] = useState(() => {
    if (typeof window !== "undefined") return localStorage.getItem("user_tier") || "free";
    return "free";
  });
  const [claimLimit, setClaimLimit] = useState<{ remaining: number; total: number; resetIn: number | null } | null>(null);
  const [verifyLimit, setVerifyLimit] = useState<{ remaining: number; total: number; resetIn: number | null } | null>(null);
  const initialType = (searchParams.get("type") as TradeUpType) || "all";
  const [type, setType] = useState<TradeUpType>(initialType);
  const [page, setPage] = useState(() => parseInt(searchParams.get("page") || "1"));
  const [perPage] = useState(24);
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
      if (type !== "all") params.set("type", type);
      return params;
    }, { replace: true });
  }, [sort, order, page, includeStale, filters, type, setSearchParams]);

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
      if (type !== "all") params.set("type", type);
      if (includeStale) params.set("include_stale", "true");

      const res = await fetch(`/api/trade-ups?${params}`, {
        credentials: "include",
        signal: controller.signal,
      });
      const data = await res.json();
      let next: TradeUp[] = data.trade_ups ?? [];
      const ids = next.filter(tu => !tu.outcomes?.length).map(tu => tu.id);
      if (ids.length) {
        const facesRes = await fetch(`/api/preview/contract-faces?ids=${ids.join(",")}`, {
          credentials: "include",
          signal: controller.signal,
        });
        if (facesRes.ok) {
          const facesData = await facesRes.json() as { faces?: Record<string, TradeUpOutcome[]> };
          next = next.map(tu => {
            const faces = facesData.faces?.[tu.id] ?? facesData.faces?.[String(tu.id)];
            return faces?.length ? { ...tu, outcomes: faces } : tu;
          });
        }
      }
      setTradeUps(next);
      setTotal(data.total ?? 0);
      const newTier = data.tier || "free";
      setTier(newTier);
      setSignedIn(Boolean(data.signed_in));
      try { localStorage.setItem("user_tier", newTier); } catch {}
      if (data.claim_limit) setClaimLimit(data.claim_limit);
      if (data.verify_limit) setVerifyLimit(data.verify_limit);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
    } finally {
      if (!controller.signal.aborted && !silent) setLoading(false);
    }
  }, [sort, order, page, perPage, debouncedFilters, type, includeStale]);

  useEffect(() => {
    if (!filtersSettled) return;
    fetchTradeUps();
    return () => { if (abortRef.current) abortRef.current.abort(); };
  }, [fetchTradeUps, filtersSettled]);

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <div data-preview-trade-ups>
      <title>Board Preview — TradeUpBot</title>
      <meta name="robots" content="noindex, nofollow" />
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 16 }}>
        <div>
          <div className="pv-kicker">Contracts</div>
          <h1 style={{ margin: "6px 0 0", fontSize: 28, letterSpacing: "-0.03em" }}>Trade-up board</h1>
        </div>
        <label className="pv-muted" style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={includeStale} onChange={e => { setIncludeStale(e.target.checked); setPage(1); }} />
          Show stale
        </label>
      </div>

      <div className="pv-typebar">
        {TRADE_UP_TYPE_TABS.map(t => (
          <button
            key={t.value}
            type="button"
            className={type === t.value ? "pv-active" : ""}
            onClick={() => { setType(t.value); setPage(1); setLoading(true); }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="pv-filters">
        <FilterBar filters={filters} onFiltersChange={f => { setFilters(f); setPage(1); }} />
        <FilterChips filters={filters} onUpdate={f => { setFilters(f); setPage(1); }} />
      </div>

      {isFree && !loading && (
        <div className="pv-rule" style={{ padding: "10px 12px", marginBottom: 12, fontSize: 13 }}>
          Free view: contracts are delayed 3 hours. Pro sees them the moment they're found.
        </div>
      )}

      {!loading && tradeUps.length === 0 ? (
        <div className="pv-muted" style={{ padding: 48, textAlign: "center" }}>No trade-ups match these filters.</div>
      ) : (
        <PreviewTradeUpBoard
          tradeUps={tradeUps}
          loading={loading}
          tier={tier}
          signedIn={signedIn}
          claimLimit={claimLimit}
          verifyLimit={verifyLimit}
          onClaimLimitUpdate={setClaimLimit}
          onVerifyLimitUpdate={setVerifyLimit}
        />
      )}

      {totalPages > 1 && (
        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 16, fontSize: 13 }}>
          <button type="button" className="pv-btn pv-btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
          <span className="pv-muted pv-tabular">Page {page} of {totalPages}</span>
          <button type="button" className="pv-btn pv-btn-ghost" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}
