import { useState } from "react";
import type { TradeUp, TradeUpInput } from "../../shared/types.js";

interface Props {
  tradeUps: TradeUp[];
  sort: string;
  order: "asc" | "desc";
  onSort: (column: string) => void;
}

function formatDollars(cents: number): string {
  const val = cents / 100;
  return val >= 0 ? `$${val.toFixed(2)}` : `-$${Math.abs(val).toFixed(2)}`;
}

function SortIndicator({ column, sort, order }: { column: string; sort: string; order: string }) {
  if (sort !== column) return null;
  return <span className="sort-indicator">{order === "desc" ? "\u25BC" : "\u25B2"}</span>;
}

/** CSFloat URL helpers */
function csfloatListingUrl(listingId: string): string {
  return `https://csfloat.com/item/${listingId}`;
}

function csfloatSearchUrl(skinName: string, condition?: string): string {
  const query = condition ? `${skinName} (${condition})` : skinName;
  return `https://csfloat.com/search?market_hash_name=${encodeURIComponent(query)}`;
}

/** Summarize inputs like "5x R8 Amber Fade, 3x Deagle Heat Treated, 2x AK Red Laminate" */
function summarizeInputs(inputs: TradeUpInput[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const input of inputs) {
    counts.set(input.skin_name, (counts.get(input.skin_name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));
}

/** Calculate chance to profit: sum probabilities of outcomes that beat the cost */
function chanceToProfit(tu: TradeUp): number {
  return tu.outcomes.reduce((sum, o) =>
    sum + (o.estimated_price_cents > tu.total_cost_cents ? o.probability : 0), 0
  );
}

/** Best case: most expensive outcome minus cost */
function bestCase(tu: TradeUp): number {
  if (tu.outcomes.length === 0) return -tu.total_cost_cents;
  const maxOutcome = Math.max(...tu.outcomes.map(o => o.estimated_price_cents));
  return maxOutcome - tu.total_cost_cents;
}

/** Worst case: cheapest outcome minus cost */
function worstCase(tu: TradeUp): number {
  if (tu.outcomes.length === 0) return -tu.total_cost_cents;
  const minOutcome = Math.min(...tu.outcomes.map(o => o.estimated_price_cents));
  return minOutcome - tu.total_cost_cents;
}

/** Short condition abbreviation */
function condAbbr(condition: string): string {
  const map: Record<string, string> = {
    "Factory New": "FN",
    "Minimal Wear": "MW",
    "Field-Tested": "FT",
    "Well-Worn": "WW",
    "Battle-Scarred": "BS",
  };
  return map[condition] ?? condition;
}

function OutcomeChart({ tu }: { tu: TradeUp }) {
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
}

export function TradeUpTable({ tradeUps, sort, order, onSort }: Props) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

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
          {tradeUps.map((tu) => (
            <>
              <tr
                key={tu.id}
                className="expandable"
                onClick={() => setExpandedId(expandedId === tu.id ? null : tu.id)}
              >
                <td>{expandedId === tu.id ? "\u25BC" : "\u25B6"}</td>
                <td>
                  <span style={{ fontSize: "0.8rem", color: "#aaa" }}>
                    {summarizeInputs(tu.inputs).map((item, i) => (
                      <span key={i}>
                        {i > 0 && ", "}
                        {item.count}x{" "}
                        <a
                          href={csfloatSearchUrl(item.name)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="skin-link"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {item.name}
                        </a>
                      </span>
                    ))}
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
                    const chance = chanceToProfit(tu);
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
                  <span className={bestCase(tu) >= 0 ? "profit-positive" : "profit-negative"}>
                    {formatDollars(bestCase(tu))}
                  </span>
                </td>
                <td>
                  <span className={worstCase(tu) >= 0 ? "profit-positive" : "profit-negative"}>
                    {formatDollars(worstCase(tu))}
                  </span>
                </td>
                <td>
                  <span style={{ fontSize: "0.8rem", color: "#aaa" }}>
                    {tu.outcomes.length} possible
                  </span>
                </td>
              </tr>
              {expandedId === tu.id && (
                <tr key={`${tu.id}-expanded`} className="expanded-row">
                  <td colSpan={10}>
                    {/* Outcome distribution chart */}
                    <OutcomeChart tu={tu} />
                    <div className="expanded-content">
                      <div className="expanded-section">
                        <h4>Inputs ({tu.inputs.length})</h4>
                        <ul>
                          {tu.inputs.map((input, i) => (
                            <li key={i}>
                              <span>
                                <a
                                  href={csfloatListingUrl(input.listing_id)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="skin-link"
                                >
                                  {input.skin_name}
                                </a>{" "}
                                <span className="condition">
                                  ({condAbbr(input.condition)}{input.float_value > 0 ? `, ${input.float_value.toFixed(4)}` : ""})
                                </span>
                              </span>
                              <span className="price">{formatDollars(input.price_cents)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="expanded-section">
                        <h4>Possible Outcomes</h4>
                        <ul>
                          {tu.outcomes
                            .slice()
                            .sort((a, b) => b.probability - a.probability)
                            .map((outcome, i) => (
                            <li key={i}>
                              <span>
                                <a
                                  href={csfloatSearchUrl(outcome.skin_name, outcome.predicted_condition)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="skin-link"
                                >
                                  {outcome.skin_name}
                                </a>{" "}
                                <span className="condition">
                                  ({condAbbr(outcome.predicted_condition)}, {outcome.predicted_float.toFixed(4)})
                                </span>
                                {" "}
                                <span className="probability">
                                  {(outcome.probability * 100).toFixed(1)}%
                                </span>
                              </span>
                              <span className="price">
                                {formatDollars(outcome.estimated_price_cents)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}
