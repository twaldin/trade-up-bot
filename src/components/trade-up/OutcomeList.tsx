import { useState, useEffect } from "react";
import type { TradeUp } from "../../../shared/types.js";
import { formatDollars, condAbbr, csfloatSearchUrl } from "../../utils/format.js";
import { PriceDetailsPanel } from "./PriceDetailsPanel.js";

interface OutcomeListProps {
  tu: TradeUp;
  priceDetailKey: string | null;
  onTogglePriceDetail: (key: string | null) => void;
  onNavigateSkin?: (skinName: string) => void;
}

interface OutcomeStats {
  listings: number;
  sales: number;
  sources: string[];
}

export function OutcomeList({ tu, priceDetailKey, onTogglePriceDetail, onNavigateSkin }: OutcomeListProps) {
  const [stats, setStats] = useState<Map<string, OutcomeStats>>(new Map());

  // Fetch outcome skin stats on mount
  useEffect(() => {
    const skinNames = [...new Set(tu.outcomes.map(o => o.skin_name))];
    if (skinNames.length === 0) return;

    // Batch fetch stats for all outcome skins
    fetch(`/api/outcome-stats?skins=${encodeURIComponent(skinNames.join("||"))}`)
      .then(r => r.json())
      .then(data => {
        const map = new Map<string, OutcomeStats>();
        for (const [name, s] of Object.entries(data.stats || {})) {
          map.set(name, s as OutcomeStats);
        }
        setStats(map);
      })
      .catch(() => { /* non-critical */ });
  }, [tu.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const sorted = tu.outcomes.slice().sort((a, b) => b.probability - a.probability);

  return (
    <div>
      <h4 className="text-[0.8rem] text-muted-foreground mb-2 uppercase tracking-wide">
        Possible Outcomes ({tu.outcomes.length})
      </h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
        {sorted.map((outcome, i) => {
          const detailKey = `${outcome.skin_name}:${outcome.predicted_condition}`;
          const showDetails = priceDetailKey === detailKey;
          const delta = outcome.estimated_price_cents - tu.total_cost_cents;
          const skinStats = stats.get(outcome.skin_name);

          return (
            <div
              key={i}
              className={`rounded-md border px-2.5 py-2 text-[0.78rem] cursor-pointer transition-colors ${
                showDetails ? "bg-accent border-border" : "bg-muted/50 border-border/50 hover:bg-muted"
              }`}
              onClick={(e) => { e.stopPropagation(); onTogglePriceDetail(showDetails ? null : detailKey); }}
            >
              {/* Row 1: Skin name + probability */}
              <div className="flex justify-between items-start gap-1 mb-1">
                <a
                  href={csfloatSearchUrl(outcome.skin_name, outcome.predicted_condition)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground/90 no-underline hover:text-blue-400 leading-tight text-[0.75rem] truncate"
                  onClick={(e) => e.stopPropagation()}
                >
                  {outcome.skin_name}
                </a>
                <span className="text-blue-400 font-semibold shrink-0 text-[0.72rem]">
                  {(outcome.probability * 100).toFixed(1)}%
                </span>
              </div>

              {/* Row 2: Condition + Price + Delta */}
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground text-[0.7rem]">
                  {condAbbr(outcome.predicted_condition)} {outcome.predicted_float.toFixed(4)}
                </span>
                <div className="flex items-center gap-1.5">
                  {outcome.sell_marketplace && outcome.sell_marketplace !== "csfloat" && (
                    <span className="px-1 py-0 text-[0.55rem] font-semibold rounded text-white" style={{ backgroundColor: outcome.sell_marketplace === "dmarket" ? "#4f8cff" : "#f5a623" }}>
                      {outcome.sell_marketplace === "dmarket" ? "DM" : "SP"}
                    </span>
                  )}
                  <span className="text-foreground/80 text-[0.75rem]">{formatDollars(outcome.estimated_price_cents)}</span>
                  <span className={`text-[0.7rem] font-semibold ${delta >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {delta >= 0 ? "+" : ""}{formatDollars(delta)}
                  </span>
                </div>
              </div>

              {/* Row 3: Data quality indicators */}
              {skinStats && (
                <div className="flex gap-2 mt-1 text-[0.65rem] text-muted-foreground/60">
                  {skinStats.listings > 0 && <span>{skinStats.listings} listings</span>}
                  {skinStats.sales > 0 && <span>{skinStats.sales} sales</span>}
                  {skinStats.sources.length > 0 && <span>{skinStats.sources.join(", ")}</span>}
                </div>
              )}

              {/* Navigate button */}
              {onNavigateSkin && (
                <button
                  className="mt-1 text-[0.65rem] text-muted-foreground/50 hover:text-blue-400 transition-colors"
                  onClick={(e) => { e.stopPropagation(); onNavigateSkin(outcome.skin_name); }}
                >
                  View data →
                </button>
              )}

              {/* Price details panel */}
              {showDetails && (
                <div className="mt-2 border-t border-border/50 pt-2">
                  <PriceDetailsPanel skinName={outcome.skin_name} condition={outcome.predicted_condition} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
