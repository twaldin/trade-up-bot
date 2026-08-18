import { useCallback, useEffect, useRef, useState } from "react";
import type { TradeUp, TradeUpOutcome } from "../../../shared/types.js";
import { mergeContractFaces } from "../../../shared/preview-board.js";
import { readJsonIfJson } from "../../../shared/http-json.js";
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

async function hydrateFromOutcomeRoutes(
  tradeUps: TradeUp[],
  ids: number[],
  signal?: AbortSignal,
): Promise<TradeUp[]> {
  const faces: Record<string, TradeUpOutcome[]> = {};
  await Promise.all(ids.map(async id => {
    try {
      const res = await fetch(`/api/trade-up/${id}/outcomes`, {
        credentials: "include",
        signal,
      });
      const data = await readJsonIfJson<{ outcomes?: TradeUpOutcome[] }>(res);
      faces[id] = data?.outcomes ?? [];
    } catch (err) {
      if ((err as Error).name === "AbortError") throw err;
      faces[id] = [];
    }
  }));
  return mergeContractFaces(tradeUps, faces);
}

export async function hydrateTradeUpsFromFaces(
  tradeUps: TradeUp[],
  signal?: AbortSignal,
): Promise<TradeUp[]> {
  const ids = tradeUps.filter(tu => !tu.outcomes?.length).map(tu => tu.id);
  if (ids.length === 0) return tradeUps;
  try {
    const res = await fetch(`/api/preview/contract-faces?ids=${ids.join(",")}`, {
      credentials: "include",
      signal,
    });
    const data = await readJsonIfJson<{ faces?: Record<string, TradeUpOutcome[]> }>(res);
    if (data?.faces) {
      const merged = mergeContractFaces(tradeUps, data.faces);
      const stillMissing = merged.some(tu => !tu.outcomes?.length && ids.includes(tu.id));
      if (!stillMissing) return merged;
    }
    return await hydrateFromOutcomeRoutes(tradeUps, ids, signal);
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    try {
      return await hydrateFromOutcomeRoutes(tradeUps, ids, signal);
    } catch (inner) {
      if ((inner as Error).name === "AbortError") throw inner;
      return tradeUps;
    }
  }
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
      const data = await readJsonIfJson<{
        trade_ups?: TradeUp[];
        total?: number;
        tier?: string;
        signed_in?: boolean;
        claim_limit?: { remaining: number; total: number; resetIn: number | null };
        verify_limit?: { remaining: number; total: number; resetIn: number | null };
      }>(res);
      if (!data) return;
      const list = data.trade_ups ?? [];
      let hydrated = list;
      try {
        hydrated = await hydrateTradeUpsFromFaces(list, controller.signal);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        hydrated = list;
      }
      if (controller.signal.aborted) return;
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
