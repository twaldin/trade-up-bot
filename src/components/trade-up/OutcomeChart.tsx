import { useState, memo } from "react";
import type { TradeUp } from "../../../shared/types.js";
import { formatDollars } from "../../utils/format.js";

interface OutcomeChartProps {
  tu: TradeUp;
}

export const OutcomeChart = memo(function OutcomeChart({ tu }: OutcomeChartProps) {
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
    <div className="px-5 pt-4 pb-2">
      <div className="flex items-center justify-between mb-2.5">
        <h4 className="text-[0.8rem] text-muted-foreground uppercase tracking-wide m-0">Outcome Distribution</h4>
        <div className="flex items-center gap-2 text-[0.75rem] text-muted-foreground">
          <span>${binSize} bins</span>
          <input
            type="range"
            min="10"
            max="500"
            step="10"
            value={binSize}
            onChange={e => setBinSize(parseInt(e.target.value))}
            onClick={e => e.stopPropagation()}
            className="w-[120px] h-1 appearance-none bg-border rounded-sm outline-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:cursor-pointer"
          />
        </div>
      </div>
      <div className="relative">
        {/* Bars */}
        <div className="flex items-end h-[120px] border-b border-border">
          {bins.map((bin, i) => {
            const barHeight = maxBinProb > 0 ? (bin.probability / maxBinProb) * 100 : 0;
            const barWidthPct = 100 / bins.length;
            const midProfit = (bin.lo + bin.hi) / 2;
            const isPositive = midProfit >= 0;
            const probPct = (bin.probability * 100);
            const rangeLabel = bin.isEdge === "lo"
              ? `\u2264 ${formatDollars(bin.hi)}`
              : bin.isEdge === "hi"
                ? `\u2265 ${formatDollars(bin.lo)}`
                : `${formatDollars(bin.lo)} to ${formatDollars(bin.hi)}`;
            const tooltip = `${rangeLabel}\n${probPct.toFixed(1)}% chance\n${bin.skins.join(", ")}`;

            return (
              <div
                key={i}
                className="flex items-end justify-center h-full"
                style={{ width: `${barWidthPct}%` }}
              >
                <div
                  className={`w-full rounded-t transition-opacity cursor-default flex items-start justify-center hover:opacity-75 ${
                    bin.probability === 0
                      ? ""
                      : isPositive
                        ? "bg-green-500/50 border border-green-500/70 border-b-0"
                        : "bg-red-500/40 border border-red-500/60 border-b-0"
                  }`}
                  style={{
                    height: `${Math.max(barHeight, bin.probability > 0 ? 6 : 0)}%`,
                    marginLeft: `${gap / 2}px`,
                    marginRight: `${gap / 2}px`,
                  }}
                  title={tooltip}
                >
                  {bin.probability > 0 && (
                    <span className="text-[0.65rem] text-foreground/80 mt-0.5 pointer-events-none whitespace-nowrap">
                      {probPct >= 1 ? `${probPct.toFixed(0)}%` : `${probPct.toFixed(1)}%`}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* X-axis tick labels */}
        <div className="flex">
          {bins.map((bin, i) => {
            const mid = (bin.lo + bin.hi) / 2;
            const label = bin.isEdge === "lo"
              ? `\u2264${formatDollars(bin.hi)}`
              : bin.isEdge === "hi"
                ? `\u2265${formatDollars(bin.lo)}`
                : formatDollars(bin.lo);
            return (
              <div key={i} className="text-[0.62rem] text-center pt-0.5 overflow-hidden text-ellipsis whitespace-nowrap" style={{ width: `${100 / bins.length}%` }}>
                <span className={mid >= 0 ? "text-green-600/70" : "text-red-600/70"}>
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex justify-between text-[0.72rem] text-muted-foreground pt-1">
        <span>EV: <strong style={{ color: tu.expected_value_cents - cost >= 0 ? "#22c55e" : "#ef4444" }}>{formatDollars(tu.expected_value_cents - cost)}</strong></span>
        <span className="text-muted-foreground/70">&larr; Loss | Profit &rarr;</span>
        <span>{tu.outcomes.length} outcomes in {bins.filter(b => b.probability > 0).length} bins</span>
      </div>
    </div>
  );
});
