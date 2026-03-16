import { useState, useCallback } from "react";
import type { TradeUp, TradeUpInput, TheoryTracking } from "../../shared/types.js";
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
  if ((tu as any).chance_to_profit !== undefined) return (tu as any).chance_to_profit;
  return tu.outcomes.reduce((sum, o) =>
    sum + (o.estimated_price_cents > tu.total_cost_cents ? o.probability : 0), 0
  );
}

function bestCase(tu: TradeUp): number {
  if ((tu as any).best_case_cents !== undefined && (tu as any).best_case_cents !== 0) return (tu as any).best_case_cents;
  if (tu.outcomes.length === 0) return -tu.total_cost_cents;
  return Math.max(...tu.outcomes.map(o => o.estimated_price_cents)) - tu.total_cost_cents;
}

function worstCase(tu: TradeUp): number {
  if ((tu as any).worst_case_cents !== undefined && (tu as any).worst_case_cents !== 0) return (tu as any).worst_case_cents;
  if (tu.outcomes.length === 0) return -tu.total_cost_cents;
  return Math.min(...tu.outcomes.map(o => o.estimated_price_cents)) - tu.total_cost_cents;
}

function ValidationBadge({ tracking }: { tracking?: TheoryTracking }) {
  if (!tracking) return null;

  const statusConfig: Record<string, { label: string; className: string; title: string }> = {
    profitable: {
      label: "Validated",
      className: "border-green-800 bg-green-950 text-green-500",
      title: `Real profit: ${formatDollars(tracking.real_profit_cents ?? 0)} (${tracking.attempts} checks)`,
    },
    near_miss: {
      label: `-${formatDollars(tracking.gap_cents)}`,
      className: "border-yellow-800 bg-yellow-950 text-amber-500",
      title: `Near miss: need ${formatDollars(tracking.gap_cents)} cheaper inputs (${tracking.attempts} checks)`,
    },
    invalidated: {
      label: "Invalid",
      className: "border-red-800 bg-red-950 text-red-500",
      title: `Gap: ${formatDollars(tracking.gap_cents)} from profitable (${tracking.attempts} checks)${tracking.cooldown_until ? ` \u2014 on cooldown` : ""}`,
    },
    no_listings: {
      label: "No data",
      className: "border-border bg-secondary text-muted-foreground",
      title: `No listings available to validate (${tracking.attempts} checks)`,
    },
    pending: {
      label: "Pending",
      className: "border-border bg-card text-muted-foreground/50",
      title: "Not yet validated",
    },
  };

  const config = statusConfig[tracking.status] ?? statusConfig.pending;
  return (
    <Badge variant="outline" className={`ml-1.5 cursor-help text-[0.65rem] ${config.className}`} title={config.title}>
      {config.label}
    </Badge>
  );
}

export function TradeUpTable({ tradeUps, sort, order, onSort, onNavigateSkin, onNavigateCollection }: Props) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [priceDetailKey, setPriceDetailKey] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<number | null>(null);
  const [verifyResults, setVerifyResults] = useState<Map<number, VerifyResult>>(new Map());
  const [priceOverrides, setPriceOverrides] = useState<Map<number, { total_cost_cents: number; profit_cents: number; roi_percentage: number }>>(new Map());
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

  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [buyResult, setBuyResult] = useState<Map<string, { success: boolean; error?: string }>>(new Map());

  const handleBuyDMarket = useCallback(async (listingId: string, priceCents: number) => {
    if (!confirm(`Buy DMarket item for ${formatDollars(priceCents)}?`)) return;
    setBuyingId(listingId);
    try {
      const res = await fetch("/api/buy/dmarket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId, expectedPriceCents: priceCents }),
      });
      const data = await res.json();
      setBuyResult(prev => new Map(prev).set(listingId, data));
    } catch (err: any) {
      setBuyResult(prev => new Map(prev).set(listingId, { success: false, error: err.message }));
    } finally {
      setBuyingId(null);
    }
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
                className={`cursor-pointer hover:bg-muted ${tu.listing_status === 'stale' ? 'opacity-55 border-l-[3px] border-l-red-500' : tu.listing_status === 'partial' ? 'border-l-[3px] border-l-yellow-500' : ''}`}
                onClick={() => handleExpand(tu.id)}
              >
                <td className="px-3.5 py-2.5 border-b border-border/70">{expandedId === tu.id ? "\u25BC" : "\u25B6"}</td>
                <td className="px-3.5 py-2.5 border-b border-border/70">
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
                </td>
                <td className="px-3.5 py-2.5 border-b border-border/70">
                  <span className={`font-semibold ${tu.profit_cents >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {formatDollars(tu.profit_cents)}
                  </span>
                </td>
                <td className="px-3.5 py-2.5 border-b border-border/70">
                  <span className={`inline-block px-2 py-0.5 rounded font-semibold text-[0.8rem] ${tu.roi_percentage >= 0 ? "bg-green-500/15 text-green-500" : "bg-red-500/15 text-red-500"}`}>
                    {tu.roi_percentage.toFixed(1)}%
                  </span>
                </td>
                <td className="px-3.5 py-2.5 border-b border-border/70">
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
                <td className="px-3.5 py-2.5 border-b border-border/70">{formatDollars(tu.total_cost_cents)}</td>
                <td className="px-3.5 py-2.5 border-b border-border/70">{formatDollars(tu.expected_value_cents)}</td>
                <td className="px-3.5 py-2.5 border-b border-border/70">
                  <span className={`font-semibold ${best >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {formatDollars(best)}
                  </span>
                </td>
                <td className="px-3.5 py-2.5 border-b border-border/70">
                  <span className={`font-semibold ${worst >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {formatDollars(worst)}
                  </span>
                </td>
                <td className="px-3.5 py-2.5 border-b border-border/70">
                  <span className="text-[0.8rem] text-foreground/60">
                    {(tu as any).outcome_count || tu.outcomes.length} possible
                  </span>
                  {tu.is_theoretical && <ValidationBadge tracking={tu.tracking} />}
                </td>
              </tr>
              {expandedId === tu.id && (
                <tr key={`${tu.id}-expanded`}>
                  <td colSpan={10} className="p-0 bg-card">
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
                        buyingId={buyingId}
                        buyResult={buyResult}
                        onBuyDMarket={handleBuyDMarket}
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
