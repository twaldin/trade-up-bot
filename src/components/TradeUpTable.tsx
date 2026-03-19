import { useState, useCallback, useEffect } from "react";
import type { TradeUp, TradeUpInput } from "../../shared/types.js";
import { formatDollars, condAbbr, csfloatSearchUrl } from "../utils/format.js";
import { Badge } from "../../shared/components/ui/badge.js";
import { OutcomeChart } from "./trade-up/OutcomeChart.js";
import { InputList } from "./trade-up/InputList.js";
import { OutcomeList } from "./trade-up/OutcomeList.js";
import { VerifyResults } from "./trade-up/VerifyResults.js";

interface VerifyResult {
  trade_up_id: number;
  inputs: {
    listing_id: string;
    skin_name: string;
    status: "active" | "sold" | "delisted" | "theoretical" | "error";
    current_price?: number;
    original_price: number;
    price_changed?: boolean;
    sold_at?: string;
  }[];
  all_active: boolean;
  any_unavailable: boolean;
  any_price_changed: boolean;
}

interface RateLimitInfo {
  remaining: number;
  total: number;
  resetIn: number | null;
}

interface Props {
  tradeUps: TradeUp[];
  sort: string;
  order: "asc" | "desc";
  onSort: (column: string) => void;
  onNavigateSkin?: (skinName: string) => void;
  onNavigateCollection?: (collectionName: string) => void;
  onClaimChange?: (delta: number) => void;
  tier?: string;
  showMyClaims?: boolean;
  claimLimit?: RateLimitInfo | null;
  verifyLimit?: RateLimitInfo | null;
  onClaimLimitUpdate?: (limit: RateLimitInfo) => void;
  onVerifyLimitUpdate?: (limit: RateLimitInfo) => void;
}

function SortIndicator({ column, sort, order }: { column: string; sort: string; order: string }) {
  if (sort !== column) return null;
  return <span className="ml-1 text-[0.7rem]">{order === "desc" ? "\u25BC" : "\u25B2"}</span>;
}

function summarizeInputs(inputs: TradeUpInput[]): { name: string; count: number; condition: string }[] {
  const counts = new Map<string, { count: number; condition: string }>();
  for (const input of inputs) {
    const existing = counts.get(input.skin_name);
    if (existing) {
      existing.count++;
    } else {
      counts.set(input.skin_name, { count: 1, condition: input.condition });
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([name, info]) => ({ name, count: info.count, condition: info.condition }));
}

function chanceToProfit(tu: TradeUp): number {
  // Use pre-computed value from DB if available (outcomes may not be loaded yet)
  if (tu.chance_to_profit !== undefined) return tu.chance_to_profit;
  return tu.outcomes.reduce((sum, o) =>
    sum + (o.estimated_price_cents > tu.total_cost_cents ? o.probability : 0), 0
  );
}

function bestCase(tu: TradeUp): number {
  if (tu.best_case_cents !== undefined && tu.best_case_cents !== 0) return tu.best_case_cents;
  if (tu.outcomes.length === 0) return -tu.total_cost_cents;
  return Math.max(...tu.outcomes.map(o => o.estimated_price_cents)) - tu.total_cost_cents;
}

function worstCase(tu: TradeUp): number {
  if (tu.worst_case_cents !== undefined && tu.worst_case_cents !== 0) return tu.worst_case_cents;
  if (tu.outcomes.length === 0) return -tu.total_cost_cents;
  return Math.min(...tu.outcomes.map(o => o.estimated_price_cents)) - tu.total_cost_cents;
}

function ClaimButton({ tuId, claimed, setClaimed, onClaimChange, limit, onLimitUpdate }: {
  tuId: number;
  claimed: Set<number>;
  setClaimed: (fn: (prev: Set<number>) => Set<number>) => void;
  onClaimChange?: (delta: number) => void;
  limit?: RateLimitInfo | null;
  onLimitUpdate?: (limit: RateLimitInfo) => void;
}) {
  const [loading, setLoading] = useState(false);
  if (claimed.has(tuId)) return null;

  const atLimit = limit && limit.remaining <= 0;
  const resetMin = limit?.resetIn ? Math.ceil(limit.resetIn / 60) : null;

  return (
    <button
      disabled={loading || !!atLimit}
      className="px-2 py-1 text-[0.7rem] font-semibold rounded bg-purple-950 text-purple-400 border border-purple-800 hover:bg-purple-900 hover:border-purple-400 cursor-pointer transition-colors disabled:opacity-50"
      onClick={async (e) => {
        e.stopPropagation();
        setLoading(true);
        try {
          const res = await fetch(`/api/trade-ups/${tuId}/claim`, { method: "POST", credentials: "include" });
          const data = await res.json();
          if (data.rate_limit) onLimitUpdate?.(data.rate_limit);
          if (data.error) {
            alert(data.error);
          } else {
            setClaimed(prev => new Set(prev).add(tuId));
            onClaimChange?.(1);
          }
        } catch {
          alert("Failed to claim");
        } finally {
          setLoading(false);
        }
      }}
    >
      {loading ? "..." : atLimit ? `Limit (${resetMin}m)` : `Claim${limit ? ` (${limit.remaining}/${limit.total})` : ""}`}
    </button>
  );
}

export function TradeUpTable({ tradeUps, sort, order, onSort, onNavigateSkin, onNavigateCollection, onClaimChange, tier = "pro", showMyClaims = false, claimLimit, verifyLimit, onClaimLimitUpdate, onVerifyLimitUpdate }: Props) {
  const isFree = tier === "free";
  const isBasic = tier === "basic";
  const isPro = tier === "pro" || tier === "admin";
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [priceDetailKey, setPriceDetailKey] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<number | null>(null);
  const [verifyResults, setVerifyResults] = useState<Map<number, VerifyResult>>(new Map());
  const [priceOverrides, setPriceOverrides] = useState<Map<number, { total_cost_cents: number; profit_cents: number; roi_percentage: number }>>(new Map());
  // claimedIds: local overrides for claim state (both claims and releases)
  // This is the SOLE source of truth for claim display — not claimed_by_me from API
  const [claimedIds, setClaimedIds] = useState<Set<number>>(() => {
    const ids = new Set<number>();
    for (const tu of tradeUps) {
      if ((tu as any).claimed_by_me) ids.add(tu.id);
    }
    return ids;
  });
  const [upgradeMsg, setUpgradeMsg] = useState<number | null>(null);
  // Confirm mode: which trade-up is in confirm mode, and which listings are selected
  const [confirmModeId, setConfirmModeId] = useState<number | null>(null);
  const [confirmSelected, setConfirmSelected] = useState<Set<string>>(new Set());
  const [shareCopied, setShareCopied] = useState<number | null>(null);

  // When new trade-ups data arrives (tab switch, refresh), reset from API flags
  useEffect(() => {
    const ids = new Set<number>();
    for (const tu of tradeUps) {
      if ((tu as any).claimed_by_me) ids.add(tu.id);
    }
    setClaimedIds(ids);
  }, [tradeUps]);
  // Lazy-loaded outcomes and inputs (not included in list response to save bandwidth)
  const [loadedOutcomes, setLoadedOutcomes] = useState<Map<number, TradeUp["outcomes"]>>(new Map());
  const [loadedInputs, setLoadedInputs] = useState<Map<number, TradeUp["inputs"]>>(new Map());

  const handleExpand = useCallback(async (tuId: number) => {
    if (expandedId === tuId) { setExpandedId(null); return; }
    setExpandedId(tuId);
    // Load outcomes + inputs if not cached
    const promises: Promise<void>[] = [];
    if (!loadedOutcomes.has(tuId)) {
      promises.push(
        fetch(`/api/trade-up/${tuId}/outcomes`).then(async res => {
          if (res.ok) {
            const data = await res.json();
            setLoadedOutcomes(prev => new Map(prev).set(tuId, data.outcomes || []));
          }
        }).catch(() => {})
      );
    }
    if (!loadedInputs.has(tuId)) {
      promises.push(
        fetch(`/api/trade-up/${tuId}/inputs`).then(async res => {
          if (res.ok) {
            const data = await res.json();
            setLoadedInputs(prev => new Map(prev).set(tuId, data.inputs || []));
          }
        }).catch(() => {})
      );
    }
    await Promise.all(promises);
  }, [expandedId, loadedOutcomes, loadedInputs]);

  const handleVerify = useCallback(async (tuId: number) => {
    setVerifying(tuId);
    try {
      const res = await fetch(`/api/verify-trade-up/${tuId}`, { method: "POST", credentials: "include" });
      const data = await res.json();
      if (data.rate_limit) onVerifyLimitUpdate?.(data.rate_limit);
      if (res.status === 429) {
        alert(data.error);
        return;
      }
      if (res.ok) {
        setVerifyResults(prev => new Map(prev).set(tuId, data));
        if (data.updated_trade_up) {
          setPriceOverrides(prev => new Map(prev).set(tuId, {
            total_cost_cents: data.updated_trade_up.total_cost_cents,
            profit_cents: data.updated_trade_up.profit_cents,
            roi_percentage: data.updated_trade_up.roi_percentage,
          }));
        }
      }
    } catch { /* network error */ }
    finally { setVerifying(null); }
  }, [onVerifyLimitUpdate]);



  const columns = [
    { key: "profit", label: "Profit" },
    { key: "roi", label: "ROI" },
    { key: "chance", label: "Chance" },
    { key: "cost", label: "Cost" },
    { key: "ev", label: "EV" },
    { key: "best", label: "Best" },
    { key: "worst", label: "Worst" },
  ];

  // Shared expanded content renderer
  const renderExpanded = (tu: TradeUp) => (
    <div className="bg-card">
      {tu.profit_cents > 0 && (() => {
        const myClaimLocal = claimedIds.has(tu.id);
        const otherClaim = !myClaimLocal && (tu as any).claimed_by_other;
        const showUpgradeLocal = upgradeMsg === tu.id;
        return (
        <div className="px-4 sm:px-5 py-2 border-b border-border/50 bg-muted/30">
          {showUpgradeLocal && (
            <div className="flex items-center justify-between mb-1.5 px-3 py-2 bg-yellow-950/40 border border-yellow-500/30 rounded text-[0.75rem] text-yellow-200">
              <span>Upgrade to Basic to claim trade-ups and lock listings while you buy</span>
              <button className="text-yellow-400 hover:text-yellow-300 font-medium cursor-pointer whitespace-nowrap ml-3" onClick={async (e) => { e.stopPropagation(); const r = await fetch("/api/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ plan: "basic" }) }); const d = await r.json(); if (d.url) window.location.href = d.url; }}>
                Upgrade →
              </button>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <div className="text-[0.75rem] text-muted-foreground">
              {myClaimLocal
                ? <span className="text-purple-400 font-medium">You claimed this trade-up — please confirm or release to help keep data fresh for everyone</span>
                : otherClaim
                  ? <span className="text-muted-foreground">Claimed by another user</span>
                  : <span>Claim to lock listings for 30 min while you buy</span>
              }
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {!myClaimLocal && !otherClaim && (
                (isPro || isBasic)
                  ? <ClaimButton tuId={tu.id} claimed={claimedIds} setClaimed={setClaimedIds} onClaimChange={onClaimChange} limit={claimLimit} onLimitUpdate={onClaimLimitUpdate} />
                  : <button
                      className="px-2 py-1 text-[0.7rem] font-semibold rounded bg-purple-950 text-purple-400 border border-purple-800 hover:bg-purple-900 hover:border-purple-400 cursor-pointer transition-colors"
                      onClick={(e) => { e.stopPropagation(); setUpgradeMsg(tu.id); }}
                    >
                      Claim
                    </button>
              )}
              {myClaimLocal && confirmModeId !== tu.id && (
                <>
                  <button
                    className="px-2.5 py-1 text-[0.7rem] font-semibold rounded bg-green-950 text-green-400 border border-green-800 hover:bg-green-900 hover:border-green-400 cursor-pointer transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      // Enter confirm mode: pre-select all real listings
                      const realIds = new Set(tu.inputs.map(inp => inp.listing_id).filter(id => !id.startsWith("theor")));
                      setConfirmSelected(realIds);
                      setConfirmModeId(tu.id);
                      if (expandedId !== tu.id) setExpandedId(tu.id);
                    }}
                  >
                    Confirm Purchase
                  </button>
                  <button
                    className="px-2 py-1 text-[0.7rem] rounded border border-border text-muted-foreground hover:text-red-400 hover:border-red-400 cursor-pointer transition-colors"
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (!confirm("Release this claim? The listings will become available to other users again.")) return;
                      const res = await fetch(`/api/trade-ups/${tu.id}/claim`, { method: "DELETE", credentials: "include" });
                      if (res.ok) {
                        if (expandedId === tu.id) setExpandedId(null);
                        setClaimedIds(prev => { const next = new Set(prev); next.delete(tu.id); return next; });
                        onClaimChange?.(-1);
                      }
                    }}
                  >
                    Release
                  </button>
                </>
              )}
              {myClaimLocal && confirmModeId === tu.id && (
                <>
                  <span className="text-[0.7rem] text-muted-foreground">{confirmSelected.size} of {tu.inputs.filter(i => !i.listing_id.startsWith("theor")).length} selected</span>
                  <button
                    className="px-2.5 py-1 text-[0.7rem] font-semibold rounded bg-green-950 text-green-400 border border-green-800 hover:bg-green-900 hover:border-green-400 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    disabled={confirmSelected.size === 0}
                    onClick={async (e) => {
                      e.stopPropagation();
                      const count = confirmSelected.size;
                      const total = tu.inputs.filter(i => !i.listing_id.startsWith("theor")).length;
                      const msg = count === total
                        ? "Confirm all inputs purchased? This removes them from the system."
                        : `Confirm ${count} of ${total} purchased? Unselected inputs will be released.`;
                      if (!confirm(msg)) return;
                      const res = await fetch(`/api/trade-ups/${tu.id}/confirm`, {
                        method: "POST", credentials: "include",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ listing_ids: [...confirmSelected] }),
                      });
                      if (res.ok) {
                        setConfirmModeId(null);
                        setConfirmSelected(new Set());
                        if (expandedId === tu.id) setExpandedId(null);
                        setClaimedIds(prev => { const next = new Set(prev); next.delete(tu.id); return next; });
                        onClaimChange?.(-1);
                      } else {
                        const data = await res.json();
                        alert(data.error || "Failed to confirm");
                      }
                    }}
                  >
                    {confirmSelected.size === tu.inputs.filter(i => !i.listing_id.startsWith("theor")).length ? "Confirm All" : `Confirm ${confirmSelected.size}`}
                  </button>
                  <button
                    className="px-2 py-1 text-[0.7rem] rounded border border-border text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                    onClick={(e) => { e.stopPropagation(); setConfirmModeId(null); setConfirmSelected(new Set()); }}
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>
          </div>
        </div>);
      })()}
      <OutcomeChart tu={tu} />
      {((tu.peak_profit_cents ?? 0) > 0 || tu.listing_status !== 'active') && (
        <VerifyResults tu={tu} />
      )}
      <div className="px-4 sm:px-5 py-4 flex flex-col gap-4">
        <InputList
          tu={tu}
          verifyResult={verifyResults.get(tu.id)}
          verifying={verifying === tu.id}
          onVerify={handleVerify}
          onNavigateSkin={onNavigateSkin}
          showListingLinks={true}
          showVerify={isPro || isBasic}
          verifyLimit={verifyLimit}
          confirmMode={confirmModeId === tu.id}
          confirmSelected={confirmSelected}
          onConfirmToggle={(listingId) => {
            setConfirmSelected(prev => {
              const next = new Set(prev);
              if (next.has(listingId)) next.delete(listingId);
              else next.add(listingId);
              return next;
            });
          }}
        />
        <OutcomeList
          tu={tu}
          priceDetailKey={priceDetailKey}
          onTogglePriceDetail={setPriceDetailKey}
          onNavigateSkin={onNavigateSkin}
        />
        <div className="flex justify-end">
          <button
            className="px-3 py-1.5 text-[0.72rem] rounded border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 cursor-pointer transition-colors flex items-center gap-1.5"
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard.writeText(`${window.location.origin}/trade-ups/${tu.id}`);
              setShareCopied(tu.id);
              setTimeout(() => setShareCopied(null), 2000);
            }}
          >
            {shareCopied === tu.id ? "Copied!" : "Share"}
          </button>
        </div>
      </div>
    </div>
  );

  // Prepare trade-up data (shared between desktop and mobile)
  const preparedTradeUps = tradeUps.map((rawTu) => {
    const override = priceOverrides.get(rawTu.id);
    const tu = {
      ...rawTu,
      inputs: loadedInputs.get(rawTu.id) ?? rawTu.inputs,
      outcomes: loadedOutcomes.get(rawTu.id) ?? rawTu.outcomes,
      ...(override ? { total_cost_cents: override.total_cost_cents, profit_cents: override.profit_cents, roi_percentage: override.roi_percentage } : {}),
    };
    // Use server-computed input_summary for collapsed view (avoids sending full inputs in list)
    const summary = tu.input_summary;
    return {
      tu,
      chance: chanceToProfit(tu),
      best: bestCase(tu),
      worst: worstCase(tu),
      inputSummary: summary?.skins ?? summarizeInputs(tu.inputs),
      inputCount: summary?.input_count ?? tu.inputs.length,
      collections: summary?.collections ?? [...new Set(tu.inputs.map(i => i.collection_name))],
      age: tu.created_at ? (() => {
        const ts = tu.created_at.endsWith("Z") || tu.created_at.includes("+") ? tu.created_at : tu.created_at + "Z";
        const ms = Date.now() - new Date(ts).getTime();
        if (isNaN(ms) || ms < 0) return "";
        const mins = Math.floor(ms / 60000);
        return mins < 60 ? `(${mins}m old)` : mins < 1440 ? `(${Math.floor(mins / 60)}h old)` : `(${Math.floor(mins / 1440)}d old)`;
      })() : "",
    };
  })
  // On "Your Claims" page, hide released trade-ups immediately
  .filter(({ tu }) => !showMyClaims || claimedIds.has(tu.id));

  return (
    <>
    {/* Mobile sort bar */}
    <div className="md:hidden flex items-center gap-1.5 mb-2 overflow-x-auto pb-1">
      <span className="text-xs text-muted-foreground shrink-0">Sort:</span>
      {columns.map(col => (
        <button
          key={col.key}
          className={`px-2.5 py-1 text-xs rounded-full border shrink-0 cursor-pointer transition-colors ${
            sort === col.key
              ? "border-foreground/30 bg-foreground/10 text-foreground"
              : "border-transparent text-muted-foreground"
          }`}
          onClick={() => onSort(col.key)}
        >
          {col.label}
          {sort === col.key && <span className="ml-0.5">{order === "desc" ? "↓" : "↑"}</span>}
        </button>
      ))}
    </div>

    {/* Mobile card layout */}
    <div className="md:hidden flex flex-col gap-2">
      {preparedTradeUps.map(({ tu, chance, best, worst, inputSummary, inputCount, collections, age }) => (
        <div key={tu.id}>
          <div
            className={`rounded-lg border border-border bg-card cursor-pointer active:bg-muted transition-colors ${
              tu.listing_status === 'stale' ? 'opacity-55 border-l-[3px] border-l-red-500' :
              tu.listing_status === 'partial' ? 'border-l-[3px] border-l-yellow-500' : ''
            }`}
            onClick={() => handleExpand(tu.id)}
          >
            {/* Top row: inputs summary + claim */}
            <div className="px-3.5 pt-3 pb-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="text-[0.78rem] text-foreground/70 leading-snug min-w-0">
                  {inputCount === 0 ? (
                    <span className="italic text-muted-foreground/50">{tu.type?.replace("_", " → ")}</span>
                  ) : (
                    inputSummary.map((item, i) => (
                      <span key={i}>{i > 0 && ", "}{item.count}x {item.name}</span>
                    ))
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {age && <span className="text-[0.6rem] text-muted-foreground/40">{age}</span>}
                  {(claimedIds.has(tu.id)) && <span className="text-[0.6rem] text-purple-400">🔒</span>}
                  {(tu as any).claimed_by_other && <span className="text-[0.6rem] text-muted-foreground">🔒</span>}
                  <span className="text-muted-foreground/30 text-xs">{expandedId === tu.id ? "▼" : "▶"}</span>
                </div>
              </div>
              {/* Collection badges */}
              {inputCount > 0 && onNavigateCollection && (
                <div className="flex gap-1 mt-1 flex-wrap">
                  {collections.map((col, i) => (
                    <span key={i} className="text-[0.55rem] px-1 py-0 rounded bg-slate-800 text-slate-400 border border-slate-700">
                      {col.replace(/^The /, "").replace(/ Collection$/, "")}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Metrics row */}
            <div className="px-3.5 pb-3 pt-1.5 flex items-center gap-3 flex-wrap">
              <span className={`text-base font-bold ${tu.profit_cents >= 0 ? "text-green-500" : "text-red-500"}`}>
                {formatDollars(tu.profit_cents)}
              </span>
              <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${tu.roi_percentage >= 0 ? "bg-green-500/15 text-green-500" : "bg-red-500/15 text-red-500"}`}>
                {tu.roi_percentage.toFixed(1)}%
              </span>
              {(() => {
                const cls = chance >= 0.5 ? "bg-green-500/20 text-green-400" : chance >= 0.3 ? "bg-amber-400/15 text-amber-400" : "bg-red-500/10 text-muted-foreground";
                return <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${cls}`}>{(chance * 100).toFixed(0)}%</span>;
              })()}
              <span className="text-xs text-muted-foreground ml-auto">{formatDollars(tu.total_cost_cents)} cost</span>
            </div>
          </div>

          {/* Expanded content */}
          {expandedId === tu.id && (
            <div className="rounded-b-lg border border-t-0 border-border overflow-hidden">
              {renderExpanded(tu)}
            </div>
          )}
        </div>
      ))}
    </div>

    {/* Desktop table */}
    <div className="hidden md:block overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-[0.85rem]">
        <thead className="bg-muted">
          <tr>
            <th className="px-3.5 py-2.5 text-left font-semibold text-muted-foreground cursor-pointer select-none whitespace-nowrap border-b border-border" style={{ width: 30 }}></th>
            <th className="px-3.5 py-2.5 text-left font-semibold text-muted-foreground cursor-pointer select-none whitespace-nowrap border-b border-border hover:text-foreground/80">Inputs</th>
            {columns.map((col) => (
              <th key={col.key} onClick={() => onSort(col.key)} className="px-3.5 py-2.5 text-left font-semibold text-muted-foreground cursor-pointer select-none whitespace-nowrap border-b border-border hover:text-foreground/80">
                {col.label}
                <SortIndicator column={col.key} sort={sort} order={order} />
              </th>
            ))}
            <th className="px-3.5 py-2.5 text-left font-semibold text-muted-foreground border-b border-border whitespace-nowrap"></th>
          </tr>
        </thead>
        <tbody>
          {preparedTradeUps.map(({ tu, chance, best, worst, inputSummary, inputCount, collections, age }) => (
            <>
              <tr
                key={tu.id}
                className={`cursor-pointer hover:bg-muted ${tu.listing_status === 'stale' ? 'opacity-55 border-l-[3px] border-l-red-500' : tu.listing_status === 'partial' ? 'border-l-[3px] border-l-yellow-500' : ''}`}
                onClick={() => handleExpand(tu.id)}
              >
                <td className="px-3.5 py-2.5 border-b border-border/70">
                  {expandedId === tu.id ? "\u25BC" : "\u25B6"}
                </td>
                <td className="px-3.5 py-2.5 border-b border-border/70">
                  {inputCount === 0 ? (
                    <span className="text-[0.75rem] text-muted-foreground/50 italic">
                      {tu.type?.replace("_", " → ")}
                    </span>
                  ) : (
                  <span className="text-[0.8rem] text-foreground/60">
                    {inputSummary.map((item, i) => (
                      <span key={i}>
                        {i > 0 && ", "}
                        {item.count}x{" "}
                        <a
                          href={csfloatSearchUrl(item.name, tu.is_theoretical ? item.condition : undefined)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-inherit no-underline border-b border-dotted border-muted-foreground/50 transition-colors hover:text-blue-400 hover:border-blue-400"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {item.name}
                        </a>
                      </span>
                    ))}
                    {onNavigateCollection && (() => {
                      return (
                        <span className="inline ml-1">
                          {collections.map((col, i) => (
                            <button
                              key={i}
                              className="inline-block text-[0.6rem] px-1 py-0 rounded-[3px] bg-slate-800 text-slate-400 border border-slate-700 cursor-pointer ml-[3px] align-middle hover:bg-slate-700 hover:text-slate-200 hover:border-slate-600"
                              title={col}
                              onClick={(e) => { e.stopPropagation(); onNavigateCollection(col); }}
                            >
                              {col.replace(/^The /, "").replace(/ Collection$/, "")}
                            </button>
                          ))}
                        </span>
                      );
                    })()}
                    {tu.listing_status === 'stale' && (
                      <Badge variant="outline" className="ml-1.5 text-[0.65rem] bg-red-950 text-red-300 border-red-900" title="All input listings gone">
                        {tu.missing_inputs}/{inputCount} missing
                      </Badge>
                    )}
                    {tu.listing_status === 'partial' && (
                      <Badge variant="outline" className="ml-1.5 text-[0.65rem] bg-yellow-950 text-yellow-200 border-yellow-900" title="Some input listings gone">
                        {tu.missing_inputs}/{inputCount} missing
                      </Badge>
                    )}
                    {(tu.peak_profit_cents ?? 0) > 0 && tu.profit_cents <= 0 && (
                      <Badge variant="outline" className="ml-1.5 text-[0.65rem] bg-green-950 text-green-300 border-green-900" title={`Was profitable: ${formatDollars(tu.peak_profit_cents!)}`}>
                        was {formatDollars(tu.peak_profit_cents!)}
                      </Badge>
                    )}
                    {age && <span className="ml-1.5 text-[0.6rem] text-muted-foreground/50">{age}</span>}
                  </span>
                  )}
                </td>
                <td className="px-3.5 py-2.5 border-b border-border/70 whitespace-nowrap">
                  <span className={`font-semibold ${tu.profit_cents >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {formatDollars(tu.profit_cents)}
                  </span>
                </td>
                <td className="px-3.5 py-2.5 border-b border-border/70 whitespace-nowrap">
                  <span className={`inline-block px-2 py-0.5 rounded font-semibold text-[0.8rem] ${tu.roi_percentage >= 0 ? "bg-green-500/15 text-green-500" : "bg-red-500/15 text-red-500"}`}>
                    {tu.roi_percentage.toFixed(1)}%
                  </span>
                </td>
                <td className="px-3.5 py-2.5 border-b border-border/70 whitespace-nowrap">
                  {(() => {
                    const cls = chance >= 0.5
                      ? "bg-green-500/20 text-green-400"
                      : chance >= 0.3
                        ? "bg-amber-400/15 text-amber-400"
                        : "bg-red-500/10 text-muted-foreground";
                    return (
                      <span className={`inline-block px-2 py-0.5 rounded font-semibold text-[0.8rem] ${cls}`}>
                        {(chance * 100).toFixed(0)}%
                      </span>
                    );
                  })()}
                </td>
                <td className="px-3.5 py-2.5 border-b border-border/70 whitespace-nowrap">{formatDollars(tu.total_cost_cents)}</td>
                <td className="px-3.5 py-2.5 border-b border-border/70 whitespace-nowrap">{formatDollars(tu.expected_value_cents)}</td>
                <td className="px-3.5 py-2.5 border-b border-border/70 whitespace-nowrap">
                  <span className={`font-semibold ${best >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {formatDollars(best)}
                  </span>
                </td>
                <td className="px-3.5 py-2.5 border-b border-border/70 whitespace-nowrap">
                  <span className={`font-semibold ${worst >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {formatDollars(worst)}
                  </span>
                </td>
                {/* Claim status shown as small badge inline */}
                <td className="px-2 py-2.5 border-b border-border/70">
                  {(claimedIds.has(tu.id))
                    ? <span className="text-[0.6rem] text-purple-400" title="You claimed this">🔒</span>
                    : (tu as any).claimed_by_other
                      ? <span className="text-[0.6rem] text-muted-foreground" title="Claimed by another user">🔒</span>
                      : null}
                </td>
              </tr>
              {expandedId === tu.id && (
                <tr key={`${tu.id}-expanded`}>
                  <td colSpan={10} className="p-0">
                    {renderExpanded(tu)}
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}
