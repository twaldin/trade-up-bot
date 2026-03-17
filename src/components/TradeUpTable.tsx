import { useState, useCallback } from "react";
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

interface Props {
  tradeUps: TradeUp[];
  sort: string;
  order: "asc" | "desc";
  onSort: (column: string) => void;
  onNavigateSkin?: (skinName: string) => void;
  onNavigateCollection?: (collectionName: string) => void;
  onClaimChange?: () => void;
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

function ClaimButton({ tuId, claimed, setClaimed, onClaimChange }: { tuId: number; claimed: Set<number>; setClaimed: (fn: (prev: Set<number>) => Set<number>) => void; onClaimChange?: () => void }) {
  const [loading, setLoading] = useState(false);
  if (claimed.has(tuId)) return null; // Already claimed — bar handles display

  return (
    <button
      disabled={loading}
      className="px-2 py-1 text-[0.7rem] font-semibold rounded bg-purple-950 text-purple-400 border border-purple-800 hover:bg-purple-900 hover:border-purple-400 cursor-pointer transition-colors disabled:opacity-50"
      onClick={async (e) => {
        e.stopPropagation();
        setLoading(true);
        try {
          const res = await fetch(`/api/trade-ups/${tuId}/claim`, { method: "POST", credentials: "include" });
          const data = await res.json();
          if (data.error) {
            alert(data.error);
          } else {
            setClaimed(prev => new Set(prev).add(tuId));
            onClaimChange?.();
          }
        } catch {
          alert("Failed to claim");
        } finally {
          setLoading(false);
        }
      }}
    >
      {loading ? "..." : "Claim"}
    </button>
  );
}

export function TradeUpTable({ tradeUps, sort, order, onSort, onNavigateSkin, onNavigateCollection, onClaimChange }: Props) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [priceDetailKey, setPriceDetailKey] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<number | null>(null);
  const [verifyResults, setVerifyResults] = useState<Map<number, VerifyResult>>(new Map());
  const [priceOverrides, setPriceOverrides] = useState<Map<number, { total_cost_cents: number; profit_cents: number; roi_percentage: number }>>(new Map());
  const [claimedIds, setClaimedIds] = useState<Set<number>>(new Set());
  // Lazy-loaded outcomes (not included in list response)
  const [loadedOutcomes, setLoadedOutcomes] = useState<Map<number, TradeUp["outcomes"]>>(new Map());

  const handleExpand = useCallback(async (tuId: number) => {
    if (expandedId === tuId) { setExpandedId(null); return; }
    setExpandedId(tuId);
    // Load outcomes if not cached
    if (!loadedOutcomes.has(tuId)) {
      try {
        const res = await fetch(`/api/trade-up/${tuId}/outcomes`);
        if (res.ok) {
          const data = await res.json();
          setLoadedOutcomes(prev => new Map(prev).set(tuId, data.outcomes || []));
        }
      } catch { /* non-critical */ }
    }
  }, [expandedId, loadedOutcomes]);

  const handleVerify = useCallback(async (tuId: number) => {
    setVerifying(tuId);
    try {
      const res = await fetch(`/api/verify-trade-up/${tuId}`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setVerifyResults(prev => new Map(prev).set(tuId, data));
        // If prices changed, update the displayed trade-up numbers
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
  }, []);



  const columns = [
    { key: "profit", label: "Profit" },
    { key: "roi", label: "ROI" },
    { key: "chance", label: "Chance" },
    { key: "cost", label: "Cost" },
    { key: "ev", label: "EV" },
    { key: "best", label: "Best" },
    { key: "worst", label: "Worst" },
  ];

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
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
            <th className="px-3.5 py-2.5 text-left font-semibold text-muted-foreground cursor-pointer select-none whitespace-nowrap border-b border-border hover:text-foreground/80">Outcomes</th>
            <th className="px-3.5 py-2.5 text-left font-semibold text-muted-foreground border-b border-border whitespace-nowrap"></th>
          </tr>
        </thead>
        <tbody>
          {tradeUps.map((rawTu) => {
            // Apply verify price overrides if available
            const override = priceOverrides.get(rawTu.id);
            // Inject lazy-loaded outcomes + price overrides
            const tu = {
              ...rawTu,
              outcomes: loadedOutcomes.get(rawTu.id) ?? rawTu.outcomes,
              ...(override ? { total_cost_cents: override.total_cost_cents, profit_cents: override.profit_cents, roi_percentage: override.roi_percentage } : {}),
            };
            const chance = chanceToProfit(tu);
            const best = bestCase(tu);
            const worst = worstCase(tu);
            const inputSummary = summarizeInputs(tu.inputs);
            return (
            <>
              <tr
                key={tu.id}
                className={`${(tu as any).locked ? 'opacity-60 cursor-default' : 'cursor-pointer hover:bg-muted'} ${tu.listing_status === 'stale' ? 'opacity-55 border-l-[3px] border-l-red-500' : tu.listing_status === 'partial' ? 'border-l-[3px] border-l-yellow-500' : ''}`}
                onClick={() => (tu as any).locked ? null : handleExpand(tu.id)}
              >
                <td className="px-3.5 py-2.5 border-b border-border/70">
                  {(tu as any).locked ? (
                    <span className="text-yellow-500 text-[0.7rem]" title="Upgrade to view">🔒</span>
                  ) : (
                    expandedId === tu.id ? "\u25BC" : "\u25B6"
                  )}
                </td>
                <td className="px-3.5 py-2.5 border-b border-border/70">
                  {(tu as any).locked ? (
                    <span className="text-[0.75rem] text-yellow-500/80 italic">
                      Upgrade to view inputs →
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
                        {onNavigateSkin && (
                          <button
                            className="inline-flex items-center justify-center bg-transparent border border-border rounded-[3px] text-muted-foreground text-[0.65rem] cursor-pointer px-[3px] py-0 ml-[3px] align-middle leading-none opacity-60 transition-all hover:opacity-100 hover:text-blue-400 hover:border-blue-400"
                            title={`View ${item.name} data`}
                            onClick={(e) => { e.stopPropagation(); onNavigateSkin(item.name); }}
                          >&#x1F4CA;</button>
                        )}
                      </span>
                    ))}
                    {onNavigateCollection && (() => {
                      const cols = [...new Set(tu.inputs.map(i => i.collection_name))];
                      return (
                        <span className="inline ml-1">
                          {cols.map((col, i) => (
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
                        {tu.missing_inputs}/{tu.inputs.length} missing
                      </Badge>
                    )}
                    {tu.listing_status === 'partial' && (
                      <Badge variant="outline" className="ml-1.5 text-[0.65rem] bg-yellow-950 text-yellow-200 border-yellow-900" title="Some input listings gone">
                        {tu.missing_inputs}/{tu.inputs.length} missing
                      </Badge>
                    )}
                    {(tu.peak_profit_cents ?? 0) > 0 && tu.profit_cents <= 0 && (
                      <Badge variant="outline" className="ml-1.5 text-[0.65rem] bg-green-950 text-green-300 border-green-900" title={`Was profitable: ${formatDollars(tu.peak_profit_cents!)}`}>
                        was {formatDollars(tu.peak_profit_cents!)}
                      </Badge>
                    )}
                    {(tu.profit_streak ?? 0) >= 3 && (
                      <Badge
                        variant="outline"
                        className={`ml-1.5 text-[0.65rem] ${
                          tu.profit_streak! >= 11
                            ? "bg-green-950 text-green-400 border-green-700 font-semibold"
                            : tu.profit_streak! >= 6
                              ? "bg-green-950 text-green-500 border-green-800"
                              : "bg-secondary text-muted-foreground border-border"
                        }`}
                        title={`Profitable for ${tu.profit_streak} consecutive cycles`}
                      >
                        {tu.profit_streak}x
                      </Badge>
                    )}
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
                <td className="px-3.5 py-2.5 border-b border-border/70 whitespace-nowrap">
                  <span className="text-[0.8rem] text-foreground/60">
                    {tu.outcome_count || tu.outcomes.length} possible
                  </span>
                </td>
                {/* Claim status shown as small badge inline */}
                <td className="px-2 py-2.5 border-b border-border/70">
                  {(claimedIds.has(tu.id) || (tu as any).claimed_by_me)
                    ? <span className="text-[0.6rem] text-purple-400" title="You claimed this">🔒</span>
                    : (tu as any).claimed_by_other
                      ? <span className="text-[0.6rem] text-muted-foreground" title="Claimed by another user">🔒</span>
                      : null}
                </td>
              </tr>
              {expandedId === tu.id && (
                <tr key={`${tu.id}-expanded`}>
                  <td colSpan={11} className="p-0 bg-card">
                    {/* Claim action bar */}
                    {tu.profit_cents > 0 && (() => {
                      const myClaimLocal = claimedIds.has(tu.id) || (tu as any).claimed_by_me;
                      const otherClaim = !myClaimLocal && (tu as any).claimed_by_other;
                      return (
                      <div className="flex items-center justify-between px-5 py-2 border-b border-border/50 bg-muted/30">
                        <div className="text-[0.75rem] text-muted-foreground">
                          {myClaimLocal
                            ? <span className="text-purple-400 font-medium">You claimed this trade-up — listings locked for 30 min</span>
                            : otherClaim
                              ? <span className="text-muted-foreground">Claimed by a Pro user</span>
                              : <span>Claim to lock listings for 30 min while you buy</span>
                          }
                        </div>
                        {!myClaimLocal && !otherClaim && (
                          <ClaimButton tuId={tu.id} claimed={claimedIds} setClaimed={setClaimedIds} onClaimChange={onClaimChange} />
                        )}
                        {myClaimLocal && (
                          <button
                            className="px-2 py-1 text-[0.7rem] rounded border border-border text-muted-foreground hover:text-red-400 hover:border-red-400 cursor-pointer transition-colors"
                            onClick={async (e) => {
                              e.stopPropagation();
                              await fetch(`/api/trade-ups/${tu.id}/claim`, { method: "DELETE", credentials: "include" });
                              setClaimedIds(prev => { const next = new Set(prev); next.delete(tu.id); return next; });
                              onClaimChange?.();
                            }}
                          >
                            Release
                          </button>
                        )}
                      </div>);
                    })()}
                    {/* Outcome distribution chart */}
                    <OutcomeChart tu={tu} />
                    {/* Status info bar for stale/partial/revived trade-ups */}
                    {((tu.peak_profit_cents ?? 0) > 0 || tu.listing_status !== 'active') && (
                      <VerifyResults tu={tu} />
                    )}
                    <div className="px-5 py-4 flex flex-col gap-4">
                      <InputList
                        tu={tu}
                        verifyResult={verifyResults.get(tu.id)}
                        verifying={verifying === tu.id}
                        onVerify={handleVerify}
                        onNavigateSkin={onNavigateSkin}
                      />
                      <OutcomeList
                        tu={tu}
                        priceDetailKey={priceDetailKey}
                        onTogglePriceDetail={setPriceDetailKey}
                        onNavigateSkin={onNavigateSkin}
                      />
                    </div>
                  </td>
                </tr>
              )}
            </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
