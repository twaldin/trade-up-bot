import { useCallback, useEffect, useRef, useState } from "react";
import type { TradeUp, TradeUpOutcome } from "../../../shared/types.js";
import { mergeContractFaces } from "../../../shared/preview-board.js";
import { EMPTY_FILTERS, filtersToParams, type Filters } from "../../components/FilterBar.js";

export interface PreviewContractsState {
  tradeUps: TradeUp[];
  total: number;
  loading: boolean;
  signedIn: boolean;
  tier: string;
  claimLimit: { remaining: number; total: number; resetIn: number | null } | null;
  verifyLimit: { remaining: number; total: number; resetIn: number | null } | null;
  setClaimLimit: (limit: { remaining: number; total: number; resetIn: number | null }) => void;
  setVerifyLimit: (limit: { remaining: number; total: number; resetIn: number | null }) => void;
}

export async function hydrateTradeUpsFromFaces(
  tradeUps: TradeUp[],
  signal?: AbortSignal,
): Promise<TradeUp[]> {
  const ids = tradeUps.filter(tu => !tu.outcomes?.length).map(tu => tu.id);
  if (ids.length === 0) return tradeUps;
  const res = await fetch(`/api/preview/contract-faces?ids=${ids.join(",")}`, {
    credentials: "include",
    signal,
  });
  if (!res.ok) return tradeUps;
  const data = await res.json() as { faces?: Record<string, TradeUpOutcome[]> };
  return mergeContractFaces(tradeUps, data.faces ?? {});
}

export function usePreviewContracts(args: {
  filters: Filters;
  type: string;
  page: number;
  perPage: number;
  sort: string;
  order: "asc" | "desc";
  includeStale: boolean;
  filtersSettled: boolean;
}): PreviewContractsState {
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
  const abortRef = useRef<AbortController | null>(null);

  const fetchTradeUps = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const params = filtersToParams(args.filters === undefined ? EMPTY_FILTERS : args.filters);
      params.set("sort", args.sort);
      params.set("order", args.order);
      params.set("page", String(args.page));
      params.set("per_page", String(args.perPage));
      if (args.type !== "all") params.set("type", args.type);
      if (args.includeStale) params.set("include_stale", "true");

      const res = await fetch(`/api/trade-ups?${params}`, {
        credentials: "include",
        signal: controller.signal,
      });
      const data = await res.json();
      const hydrated = await hydrateTradeUpsFromFaces(data.trade_ups ?? [], controller.signal);
      setTradeUps(hydrated);
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
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [args.filters, args.sort, args.order, args.page, args.perPage, args.type, args.includeStale]);

  useEffect(() => {
    if (!args.filtersSettled) return;
    fetchTradeUps();
    return () => { if (abortRef.current) abortRef.current.abort(); };
  }, [fetchTradeUps, args.filtersSettled]);

  return {
    tradeUps,
    total,
    loading,
    signedIn,
    tier,
    claimLimit,
    verifyLimit,
    setClaimLimit,
    setVerifyLimit,
  };
}
