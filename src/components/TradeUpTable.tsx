import { useState, useEffect, useCallback, memo } from "react";
import type { TradeUp, TradeUpInput, TheoryTracking } from "../../shared/types.js";
import { formatDollars, condAbbr, timeAgo, csfloatListingUrl, csfloatSearchUrl, listingUrl, listingSource, sourceLabel, sourceColor } from "../utils/format.js";

interface PriceDetails {
  cached_price: { price: number; source: string } | null;
  price_data: { source: string; median_price_cents: number; min_price_cents: number; volume: number; updated_at: string }[];
  listings: { price_cents: number; float_value: number; created_at: string }[];
  recent_sales: { price_cents: number; float_value: number; sold_at: string }[];
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
  return <span className="sort-indicator">{order === "desc" ? "\u25BC" : "\u25B2"}</span>;
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
  return tu.outcomes.reduce((sum, o) =>
    sum + (o.estimated_price_cents > tu.total_cost_cents ? o.probability : 0), 0
  );
}

function bestCase(tu: TradeUp): number {
  if (tu.outcomes.length === 0) return -tu.total_cost_cents;
  const maxOutcome = Math.max(...tu.outcomes.map(o => o.estimated_price_cents));
  return maxOutcome - tu.total_cost_cents;
}

function worstCase(tu: TradeUp): number {
  if (tu.outcomes.length === 0) return -tu.total_cost_cents;
  const minOutcome = Math.min(...tu.outcomes.map(o => o.estimated_price_cents));
  return minOutcome - tu.total_cost_cents;
}

const PriceDetailsPanel = memo(function PriceDetailsPanel({ skinName, condition }: { skinName: string; condition: string }) {
  const [data, setData] = useState<PriceDetails | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setData(null);
    fetch(`/api/price-details?skin_name=${encodeURIComponent(skinName)}&condition=${encodeURIComponent(condition)}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [skinName, condition]);

  if (loading) return <div className="price-details-panel">Loading...</div>;
  if (!data) return <div className="price-details-panel">No data</div>;

  return (
    <div className="price-details-panel" onClick={e => e.stopPropagation()}>
      {data.cached_price && (
        <div className="price-detail-row price-detail-used">
          <span>Used: <strong>{formatDollars(data.cached_price.price)}</strong></span>
          <span className="price-detail-source">{data.cached_price.source}</span>
        </div>
      )}
      {data.price_data.map((pd, i) => (
        <div key={i} className="price-detail-row">
          <span>{pd.source}: {formatDollars(pd.median_price_cents || pd.min_price_cents)}</span>
          <span className="price-detail-meta">{pd.volume > 0 ? `${pd.volume} vol` : ""} {timeAgo(pd.updated_at)}</span>
        </div>
      ))}
      {data.listings.length > 0 && (
        <div className="price-detail-row">
          <span>Listing floor: {formatDollars(data.listings[0].price_cents)}</span>
          <span className="price-detail-meta">{data.listings.length} listings</span>
        </div>
      )}
      {data.recent_sales.length > 0 && (
        <div className="price-detail-row">
          <span>Recent sale: {formatDollars(data.recent_sales[0].price_cents)}</span>
          <span className="price-detail-meta">{timeAgo(data.recent_sales[0].sold_at)}</span>
        </div>
      )}
    </div>
  );
});

const OutcomeChart = memo(function OutcomeChart({ tu }: { tu: TradeUp }) {
  const [binSize, setBinSize] = useState(50);

  if (tu.outcomes.length === 0) return null;

  const cost = tu.total_cost_cents;

  // Compute profit for each outcome
  const profits = tu.outcomes.map(o => ({
    profit: o.estimated_price_cents - cost,
    probability: o.probability,
    name: o.skin_name,
  }));

  const minProfit = Math.min(...profits.map(p => p.profit));
  const maxProfit = Math.max(...profits.map(p => p.profit));

  // Build histogram bins — cap at MAX_BINS to prevent horizontal blowout
  const MAX_BINS = 20;
  const binCents = binSize * 100;
  let binStart = Math.floor(minProfit / binCents) * binCents;
  let binEnd = Math.ceil(maxProfit / binCents) * binCents;

  // If range would produce too many bins, clamp and use edge bins for outliers
  const rawBinCount = Math.round((binEnd - binStart) / binCents);
  let clampedLo = binStart;
  let clampedHi = binEnd;
  if (rawBinCount > MAX_BINS) {
    // Find the central range that covers most probability mass
    // Sort profits by value, find P10 and P90 by probability weight
    const sorted = [...profits].sort((a, b) => a.profit - b.profit);
    let cumProb = 0;
    let p10 = sorted[0].profit;
    let p90 = sorted[sorted.length - 1].profit;
    for (const p of sorted) {
      cumProb += p.probability;
      if (cumProb >= 0.05 && p10 === sorted[0].profit) p10 = p.profit;
      if (cumProb >= 0.95 && p90 === sorted[sorted.length - 1].profit) p90 = p.profit;
    }
    // Expand P10/P90 by 1 bin for breathing room, ensure 0 is included
    clampedLo = Math.floor(Math.min(p10, 0) / binCents) * binCents - binCents;
    clampedHi = Math.ceil(Math.max(p90, 0) / binCents) * binCents + binCents;
    // Still cap if the clamped range is too wide
    if ((clampedHi - clampedLo) / binCents > MAX_BINS - 2) {
      const mid = (clampedLo + clampedHi) / 2;
      const halfRange = ((MAX_BINS - 2) / 2) * binCents;
      clampedLo = Math.floor((mid - halfRange) / binCents) * binCents;
      clampedHi = Math.ceil((mid + halfRange) / binCents) * binCents;
    }
  }

  interface Bin {
    lo: number;
    hi: number;
    probability: number;
    skins: string[];
    isEdge?: "lo" | "hi"; // collapsed outlier bin
  }

  const bins: Bin[] = [];
  // Add low outlier bin if we clamped
  const hasLoOutlier = clampedLo > binStart;
  const hasHiOutlier = clampedHi < binEnd;
  if (hasLoOutlier) {
    bins.push({ lo: binStart, hi: clampedLo, probability: 0, skins: [], isEdge: "lo" });
  }
  for (let lo = clampedLo; lo < clampedHi; lo += binCents) {
    bins.push({ lo, hi: lo + binCents, probability: 0, skins: [] });
  }
  if (hasHiOutlier) {
    bins.push({ lo: clampedHi, hi: binEnd, probability: 0, skins: [], isEdge: "hi" });
  }
  if (bins.length === 0) {
    bins.push({ lo: binStart, hi: binStart + binCents, probability: 0, skins: [] });
  }

  // Assign outcomes to bins
  for (const p of profits) {
    const bin = bins.find(b => p.profit >= b.lo && p.profit < b.hi)
      ?? bins[bins.length - 1];
    bin.probability += p.probability;
    if (!bin.skins.includes(p.name)) bin.skins.push(p.name);
  }

  const maxBinProb = Math.max(...bins.map(b => b.probability));
  const gap = 2; // px gap between bars

  return (
    <div className="outcome-chart">
      <div className="outcome-chart-header">
        <h4>Outcome Distribution</h4>
        <div className="outcome-chart-slider">
          <span>${binSize} bins</span>
          <input
            type="range"
            min="10"
            max="500"
            step="10"
            value={binSize}
            onChange={e => setBinSize(parseInt(e.target.value))}
            onClick={e => e.stopPropagation()}
          />
        </div>
      </div>
      <div className="outcome-chart-area">
        {/* Bars */}
        <div className="outcome-chart-bars">
          {bins.map((bin, i) => {
            const barHeight = maxBinProb > 0 ? (bin.probability / maxBinProb) * 100 : 0;
            const barWidthPct = 100 / bins.length;
            const midProfit = (bin.lo + bin.hi) / 2;
            const isPositive = midProfit >= 0;
            const probPct = (bin.probability * 100);
            const rangeLabel = bin.isEdge === "lo"
              ? `≤ ${formatDollars(bin.hi)}`
              : bin.isEdge === "hi"
                ? `≥ ${formatDollars(bin.lo)}`
                : `${formatDollars(bin.lo)} to ${formatDollars(bin.hi)}`;
            const tooltip = `${rangeLabel}\n${probPct.toFixed(1)}% chance\n${bin.skins.join(", ")}`;

            return (
              <div
                key={i}
                className="outcome-chart-col"
                style={{ width: `${barWidthPct}%` }}
              >
                <div
                  className={`outcome-chart-bar ${isPositive ? "bar-positive" : "bar-negative"} ${bin.probability === 0 ? "bar-empty" : ""}`}
                  style={{
                    height: `${Math.max(barHeight, bin.probability > 0 ? 6 : 0)}%`,
                    marginLeft: `${gap / 2}px`,
                    marginRight: `${gap / 2}px`,
                  }}
                  title={tooltip}
                >
                  {bin.probability > 0 && (
                    <span className="outcome-chart-bar-label">
                      {probPct >= 1 ? `${probPct.toFixed(0)}%` : `${probPct.toFixed(1)}%`}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* X-axis tick labels */}
        <div className="outcome-chart-ticks">
          {bins.map((bin, i) => {
            const mid = (bin.lo + bin.hi) / 2;
            const label = bin.isEdge === "lo"
              ? `≤${formatDollars(bin.hi)}`
              : bin.isEdge === "hi"
                ? `≥${formatDollars(bin.lo)}`
                : formatDollars(bin.lo);
            return (
              <div key={i} className="outcome-chart-tick" style={{ width: `${100 / bins.length}%` }}>
                <span className={mid >= 0 ? "tick-positive" : "tick-negative"}>
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="outcome-chart-legend">
        <span>EV: <strong style={{ color: tu.expected_value_cents - cost >= 0 ? "#22c55e" : "#ef4444" }}>{formatDollars(tu.expected_value_cents - cost)}</strong></span>
        <span style={{ color: "#666" }}>← Loss | Profit →</span>
        <span>{tu.outcomes.length} outcomes in {bins.filter(b => b.probability > 0).length} bins</span>
      </div>
    </div>
  );
});

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

function ValidationBadge({ tracking }: { tracking?: TheoryTracking }) {
  if (!tracking) return null;

  const statusConfig: Record<string, { label: string; cls: string; title: string }> = {
    profitable: {
      label: "Validated",
      cls: "validation-profitable",
      title: `Real profit: ${formatDollars(tracking.real_profit_cents ?? 0)} (${tracking.attempts} checks)`,
    },
    near_miss: {
      label: `-${formatDollars(tracking.gap_cents)}`,
      cls: "validation-near-miss",
      title: `Near miss: need ${formatDollars(tracking.gap_cents)} cheaper inputs (${tracking.attempts} checks)`,
    },
    invalidated: {
      label: "Invalid",
      cls: "validation-invalidated",
      title: `Gap: ${formatDollars(tracking.gap_cents)} from profitable (${tracking.attempts} checks)${tracking.cooldown_until ? ` — on cooldown` : ""}`,
    },
    no_listings: {
      label: "No data",
      cls: "validation-no-listings",
      title: `No listings available to validate (${tracking.attempts} checks)`,
    },
    pending: {
      label: "Pending",
      cls: "validation-pending",
      title: "Not yet validated",
    },
  };

  const config = statusConfig[tracking.status] ?? statusConfig.pending;
  return (
    <span className={`validation-badge ${config.cls}`} title={config.title}>
      {config.label}
    </span>
  );
}

export function TradeUpTable({ tradeUps, sort, order, onSort, onNavigateSkin, onNavigateCollection }: Props) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [priceDetailKey, setPriceDetailKey] = useState<string | null>(null); // "skinName:condition"
  const [verifying, setVerifying] = useState<number | null>(null);
  const [verifyResults, setVerifyResults] = useState<Map<number, VerifyResult>>(new Map());

  const handleVerify = useCallback(async (tuId: number) => {
    setVerifying(tuId);
    try {
      const res = await fetch(`/api/verify-trade-up/${tuId}`, { method: "POST" });
      if (res.ok) {
        const data: VerifyResult = await res.json();
        setVerifyResults(prev => new Map(prev).set(tuId, data));
      }
    } catch {
      // silently fail
    } finally {
      setVerifying(null);
    }
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
    <div className="table-container">
      <table>
        <thead>
          <tr>
            <th style={{ width: 30 }}></th>
            <th>Inputs</th>
            {columns.map((col) => (
              <th key={col.key} onClick={() => onSort(col.key)}>
                {col.label}
                <SortIndicator column={col.key} sort={sort} order={order} />
              </th>
            ))}
            <th>Outcomes</th>
          </tr>
        </thead>
        <tbody>
          {tradeUps.map((tu) => {
            const chance = chanceToProfit(tu);
            const best = bestCase(tu);
            const worst = worstCase(tu);
            const inputSummary = summarizeInputs(tu.inputs);
            return (
            <>
              <tr
                key={tu.id}
                className={`expandable${tu.listing_status === 'stale' ? ' row-stale' : tu.listing_status === 'partial' ? ' row-partial' : ''}`}
                onClick={() => setExpandedId(expandedId === tu.id ? null : tu.id)}
              >
                <td>{expandedId === tu.id ? "\u25BC" : "\u25B6"}</td>
                <td>
                  <span style={{ fontSize: "0.8rem", color: "#aaa" }}>
                    {inputSummary.map((item, i) => (
                      <span key={i}>
                        {i > 0 && ", "}
                        {item.count}x{" "}
                        <a
                          href={csfloatSearchUrl(item.name, tu.is_theoretical ? item.condition : undefined)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="skin-link"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {item.name}
                        </a>
                        {onNavigateSkin && (
                          <button
                            className="data-link-btn"
                            title={`View ${item.name} data`}
                            onClick={(e) => { e.stopPropagation(); onNavigateSkin(item.name); }}
                          >&#x1F4CA;</button>
                        )}
                      </span>
                    ))}
                    {onNavigateCollection && (() => {
                      const cols = [...new Set(tu.inputs.map(i => i.collection_name))];
                      return (
                        <span className="collection-tags">
                          {cols.map((col, i) => (
                            <button
                              key={i}
                              className="collection-tag"
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
                      <span className="listing-badge stale" title="All input listings gone">
                        {tu.missing_inputs}/{tu.inputs.length} missing
                      </span>
                    )}
                    {tu.listing_status === 'partial' && (
                      <span className="listing-badge partial" title="Some input listings gone">
                        {tu.missing_inputs}/{tu.inputs.length} missing
                      </span>
                    )}
                    {(tu.peak_profit_cents ?? 0) > 0 && tu.profit_cents <= 0 && (
                      <span className="listing-badge was-profitable" title={`Was profitable: ${formatDollars(tu.peak_profit_cents!)}`}>
                        was {formatDollars(tu.peak_profit_cents!)}
                      </span>
                    )}
                  </span>
                </td>
                <td>
                  <span className={tu.profit_cents >= 0 ? "profit-positive" : "profit-negative"}>
                    {formatDollars(tu.profit_cents)}
                  </span>
                </td>
                <td>
                  <span className={`roi-badge ${tu.roi_percentage >= 0 ? "positive" : "negative"}`}>
                    {tu.roi_percentage.toFixed(1)}%
                  </span>
                </td>
                <td>
                  {(() => {
                    const cls = chance >= 0.5 ? "chance-high" : chance >= 0.3 ? "chance-mid" : "chance-low";
                    return (
                      <span className={`chance-badge ${cls}`}>
                        {(chance * 100).toFixed(0)}%
                      </span>
                    );
                  })()}
                </td>
                <td>{formatDollars(tu.total_cost_cents)}</td>
                <td>{formatDollars(tu.expected_value_cents)}</td>
                <td>
                  <span className={best >= 0 ? "profit-positive" : "profit-negative"}>
                    {formatDollars(best)}
                  </span>
                </td>
                <td>
                  <span className={worst >= 0 ? "profit-positive" : "profit-negative"}>
                    {formatDollars(worst)}
                  </span>
                </td>
                <td>
                  <span style={{ fontSize: "0.8rem", color: "#aaa" }}>
                    {tu.outcomes.length} possible
                  </span>
                  {tu.is_theoretical && <ValidationBadge tracking={tu.tracking} />}
                </td>
              </tr>
              {expandedId === tu.id && (
                <tr key={`${tu.id}-expanded`} className="expanded-row">
                  <td colSpan={10}>
                    {/* Outcome distribution chart */}
                    <OutcomeChart tu={tu} />
                    {/* Status info bar for stale/partial/revived trade-ups */}
                    {((tu.peak_profit_cents ?? 0) > 0 || tu.listing_status !== 'active') && (
                      <div className="tradeup-status-bar">
                        {tu.listing_status === 'stale' && (
                          <div className="status-info status-stale">
                            <strong>Stale</strong> — All {tu.missing_inputs ?? tu.inputs.length} input listings gone
                            {tu.preserved_at && <span className="status-meta"> (since {timeAgo(tu.preserved_at)})</span>}
                            . Waiting for replacement listings. Auto-purges after 7 days.
                          </div>
                        )}
                        {tu.listing_status === 'partial' && (
                          <div className="status-info status-partial">
                            <strong>Partial</strong> — {tu.missing_inputs}/{tu.inputs.length} input listings missing
                            {tu.preserved_at && <span className="status-meta"> (since {timeAgo(tu.preserved_at)})</span>}
                          </div>
                        )}
                        {(tu.peak_profit_cents ?? 0) > 0 && tu.profit_cents <= 0 && tu.listing_status === 'active' && (
                          <div className="status-info status-revived">
                            <strong>Revived</strong> — Was {formatDollars(tu.peak_profit_cents!)} profit, now {formatDollars(tu.profit_cents)}. Replacement listings cost {formatDollars(Math.abs(tu.profit_cents))} more than needed to break even.
                          </div>
                        )}
                        {(tu.peak_profit_cents ?? 0) > 0 && tu.profit_cents > 0 && tu.peak_profit_cents! > tu.profit_cents && (
                          <div className="status-info status-declined">
                            <strong>Declined</strong> — Peak was {formatDollars(tu.peak_profit_cents!)}, now {formatDollars(tu.profit_cents)}
                          </div>
                        )}
                        {/* Input replacement diff */}
                        {tu.previous_inputs && tu.previous_inputs.replaced.length > 0 && (
                          <div className="input-diff">
                            <div className="input-diff-header">
                              <strong>Replaced Inputs</strong>
                              <span className="status-meta">
                                {" "}cost {formatDollars(tu.previous_inputs.old_cost_cents)} → {formatDollars(tu.total_cost_cents)}
                                {" "}({formatDollars(tu.total_cost_cents - tu.previous_inputs.old_cost_cents)} change)
                              </span>
                            </div>
                            {tu.previous_inputs.replaced.map((r, i) => (
                              <div key={i} className="input-diff-row">
                                <div className="input-diff-old">
                                  <span className="diff-label">OLD</span>
                                  <a
                                    href={listingUrl(r.old.listing_id, r.old.skin_name, r.old.condition, r.old.float_value)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="skin-link"
                                    onClick={e => e.stopPropagation()}
                                  >{r.old.skin_name}</a>
                                  <span className="condition">({condAbbr(r.old.condition)}, {r.old.float_value.toFixed(4)})</span>
                                  <span className="price">{formatDollars(r.old.price_cents)}</span>
                                </div>
                                {r.new && (
                                  <div className="input-diff-new">
                                    <span className="diff-label">NEW</span>
                                    <a
                                      href={listingUrl(r.new.listing_id, r.new.skin_name, r.new.condition, r.new.float_value)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="skin-link"
                                      onClick={e => e.stopPropagation()}
                                    >{r.new.skin_name}</a>
                                    <span className="condition">({condAbbr(r.new.condition)}, {r.new.float_value.toFixed(4)})</span>
                                    <span className="price">{formatDollars(r.new.price_cents)}</span>
                                    <span className={r.new.price_cents <= r.old.price_cents ? "diff-cheaper" : "diff-costlier"}>
                                      ({r.new.price_cents <= r.old.price_cents ? "" : "+"}{formatDollars(r.new.price_cents - r.old.price_cents)})
                                    </span>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    <div className="expanded-content">
                      <div className="expanded-section">
                        <h4>
                          Inputs ({tu.inputs.length})
                          {!tu.is_theoretical && (
                            <button
                              className="verify-btn"
                              onClick={(e) => { e.stopPropagation(); handleVerify(tu.id); }}
                              disabled={verifying === tu.id}
                              title="Check if all inputs are still listed"
                            >
                              {verifying === tu.id ? "Checking..." : "Verify"}
                            </button>
                          )}
                          {verifyResults.has(tu.id) && (() => {
                            const vr = verifyResults.get(tu.id)!;
                            const activeCount = vr.inputs.filter(i => i.status === "active").length;
                            const unavailCount = vr.inputs.filter(i => i.status === "sold" || i.status === "delisted").length;
                            const errorCount = vr.inputs.filter(i => i.status === "error").length;
                            if (errorCount === vr.inputs.length) return <span className="verify-warn" title="Rate limited — try again later">Rate limited</span>;
                            if (vr.all_active && !vr.any_price_changed) return <span className="verify-ok" title="All inputs verified active">{activeCount}/{vr.inputs.length} active</span>;
                            if (vr.all_active && vr.any_price_changed) return <span className="verify-warn" title="Some prices changed">{activeCount}/{vr.inputs.length} price changed</span>;
                            if (vr.any_unavailable) return <span className="verify-bad" title={`${unavailCount} sold/delisted`}>{unavailCount}/{vr.inputs.length} missing</span>;
                            if (errorCount > 0) return <span className="verify-warn" title={`${errorCount} couldn't be checked (rate limited)`}>{activeCount}/{vr.inputs.length} checked</span>;
                            return null;
                          })()}
                        </h4>
                        {tu.type === "staircase" && tu.inputs.length > 10 ? (() => {
                          // Group staircase inputs into stage-1 trade-ups (chunks of inputs.length / 5)
                          const chunkSize = Math.round(tu.inputs.length / 5);
                          const stages: typeof tu.inputs[] = [];
                          for (let s = 0; s < 5; s++) {
                            stages.push(tu.inputs.slice(s * chunkSize, (s + 1) * chunkSize));
                          }
                          return (
                            <div className="staircase-stages">
                              {stages.map((stage, si) => {
                                const stageCost = stage.reduce((s, inp) => s + inp.price_cents, 0);
                                return (
                                  <div key={si} className="staircase-stage">
                                    <div className="staircase-stage-header">
                                      Stage 1 Trade-Up #{si + 1} ({stage.length} Classified → 1 Covert) — {formatDollars(stageCost)}
                                    </div>
                                    <ul>
                                      {stage.map((input, i) => {
                                        const isTheory = input.listing_id.startsWith("theory") || input.listing_id === "theoretical";
                                        return (
                                          <li key={i}>
                                            <span>
                                              <a
                                                href={isTheory ? csfloatSearchUrl(input.skin_name, input.condition) : listingUrl(input.listing_id, input.skin_name, input.condition, input.float_value)}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="skin-link"
                                              >
                                                {input.skin_name}
                                              </a>
                                              {!isTheory && input.source && input.source !== "csfloat" && (
                                                <span className="source-badge" style={{ backgroundColor: sourceColor(input.source) }}>{sourceLabel(input.source)}</span>
                                              )}
                                              {onNavigateSkin && (
                                                <button
                                                  className="data-link-btn"
                                                  title={`View ${input.skin_name} data`}
                                                  onClick={(e) => { e.stopPropagation(); onNavigateSkin(input.skin_name); }}
                                                >&#x1F4CA;</button>
                                              )}{" "}
                                              {isTheory && <span className="theory-badge">theory</span>}
                                              <span className="condition">
                                                ({condAbbr(input.condition)}{input.float_value > 0 ? `, ${input.float_value.toFixed(4)}` : ""})
                                              </span>
                                            </span>
                                            <span className="price">{formatDollars(input.price_cents)}</span>
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })() : (
                        <ul>
                          {tu.inputs.map((input, i) => {
                            const isTheory = input.listing_id.startsWith("theory") || input.listing_id === "theoretical";
                            const vr = verifyResults.get(tu.id);
                            const inputStatus = vr?.inputs.find(v => v.listing_id === input.listing_id);
                            return (
                              <li key={i} className={inputStatus?.status === "sold" ? "input-sold" : inputStatus?.status === "delisted" ? "input-delisted" : ""}>
                                <span>
                                  <a
                                    href={isTheory ? csfloatSearchUrl(input.skin_name, input.condition) : listingUrl(input.listing_id, input.skin_name, input.condition, input.float_value)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="skin-link"
                                  >
                                    {input.skin_name}
                                  </a>
                                  {!isTheory && input.source && input.source !== "csfloat" && (
                                    <span className="source-badge" style={{ backgroundColor: sourceColor(input.source) }}>{sourceLabel(input.source)}</span>
                                  )}
                                  {!isTheory && listingSource(input.listing_id) === "dmarket" && (
                                    <button
                                      className="buy-btn"
                                      disabled={buyingId === input.listing_id || buyResult.has(input.listing_id)}
                                      title={buyResult.get(input.listing_id)?.success ? "Purchased!" : buyResult.get(input.listing_id)?.error ?? "Buy on DMarket"}
                                      onClick={(e) => { e.stopPropagation(); handleBuyDMarket(input.listing_id, input.price_cents); }}
                                    >
                                      {buyingId === input.listing_id ? "..." : buyResult.get(input.listing_id)?.success ? "OK" : buyResult.get(input.listing_id) ? "ERR" : "BUY"}
                                    </button>
                                  )}
                                  {onNavigateSkin && (
                                    <button
                                      className="data-link-btn"
                                      title={`View ${input.skin_name} data`}
                                      onClick={(e) => { e.stopPropagation(); onNavigateSkin(input.skin_name); }}
                                    >&#x1F4CA;</button>
                                  )}{" "}
                                  {isTheory && <span className="theory-badge">theory</span>}
                                  <span className="condition">
                                    ({condAbbr(input.condition)}{input.float_value > 0 ? `, ${input.float_value.toFixed(4)}` : ""})
                                  </span>
                                  {inputStatus && inputStatus.status === "active" && <span className="status-active" title="Still listed">&#10003;</span>}
                                  {inputStatus && inputStatus.status === "sold" && <span className="status-sold" title={`Sold ${inputStatus.sold_at ? timeAgo(inputStatus.sold_at) : ""}`}>SOLD</span>}
                                  {inputStatus && inputStatus.status === "delisted" && <span className="status-delisted" title="Removed from market">GONE</span>}
                                  {inputStatus && inputStatus.price_changed && inputStatus.current_price && (
                                    <span className="status-price-change" title={`Price changed: was ${formatDollars(inputStatus.original_price)}, now ${formatDollars(inputStatus.current_price)}`}>
                                      {formatDollars(inputStatus.current_price)}
                                    </span>
                                  )}
                                </span>
                                <span className="price">{formatDollars(input.price_cents)}</span>
                              </li>
                            );
                          })}
                        </ul>
                        )}
                      </div>
                      <div className="expanded-section">
                        <h4>Possible Outcomes</h4>
                        <ul>
                          {tu.outcomes
                            .slice()
                            .sort((a, b) => b.probability - a.probability)
                            .map((outcome, i) => {
                            const detailKey = `${outcome.skin_name}:${outcome.predicted_condition}`;
                            const showDetails = priceDetailKey === detailKey;
                            return (
                            <li key={i} className="outcome-item">
                              <div className="outcome-row">
                                <span>
                                  <a
                                    href={csfloatSearchUrl(outcome.skin_name, outcome.predicted_condition)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="skin-link"
                                  >
                                    {outcome.skin_name}
                                  </a>
                                  {onNavigateSkin && (
                                    <button
                                      className="data-link-btn"
                                      title={`View ${outcome.skin_name} data`}
                                      onClick={(e) => { e.stopPropagation(); onNavigateSkin(outcome.skin_name); }}
                                    >&#x1F4CA;</button>
                                  )}{" "}
                                  <span className="condition">
                                    ({condAbbr(outcome.predicted_condition)}, {outcome.predicted_float.toFixed(4)})
                                  </span>
                                  {" "}
                                  <span className="probability">
                                    {(outcome.probability * 100).toFixed(1)}%
                                  </span>
                                </span>
                                <span className="outcome-prices">
                                  <span className="price">
                                    {formatDollars(outcome.estimated_price_cents)}
                                  </span>
                                  {outcome.sell_marketplace && outcome.sell_marketplace !== "csfloat" && (
                                    <span className={`source-badge source-${outcome.sell_marketplace}`} title={`Sell on ${outcome.sell_marketplace}`}>
                                      {outcome.sell_marketplace === "dmarket" ? "DM" : outcome.sell_marketplace === "skinport" ? "SP" : outcome.sell_marketplace}
                                    </span>
                                  )}
                                  {(() => {
                                    const delta = outcome.estimated_price_cents - tu.total_cost_cents;
                                    return (
                                      <span className={delta >= 0 ? "outcome-gain" : "outcome-loss"}>
                                        {delta >= 0 ? "+" : ""}{formatDollars(delta)}
                                      </span>
                                    );
                                  })()}
                                  <button
                                    className="price-info-btn"
                                    onClick={(e) => { e.stopPropagation(); setPriceDetailKey(showDetails ? null : detailKey); }}
                                    title="View price sources"
                                  >
                                    i
                                  </button>
                                </span>
                              </div>
                              {showDetails && (
                                <PriceDetailsPanel skinName={outcome.skin_name} condition={outcome.predicted_condition} />
                              )}
                            </li>
                            );
                          })}
                        </ul>
                      </div>
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
