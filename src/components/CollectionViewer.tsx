import { useState, useEffect } from "react";
import { formatDollars } from "../utils/format.js";
import { DataViewer } from "./DataViewer.js";
import { TradeUpTable } from "./TradeUpTable.js";
import { Button } from "@shared/components/ui/button.js";
import { Badge } from "@shared/components/ui/badge.js";
import type { TradeUp, TradeUpInput, TradeUpOutcome } from "../../shared/types.js";

interface Props {
  collectionName: string;
  onBack: () => void;
  onNavigateCollection: (name: string) => void;
}

const RARITY_TABS = [
  { value: "all", label: "All Skins", color: "" },
  { value: "Covert", label: "Covert", color: "bg-red-500 text-red-950" },
  { value: "Classified", label: "Classified", color: "bg-pink-500 text-pink-950" },
  { value: "Restricted", label: "Restricted", color: "bg-purple-500 text-purple-950" },
  { value: "Mil-Spec", label: "Mil-Spec", color: "bg-blue-500 text-blue-950" },
  { value: "Industrial Grade", label: "Industrial", color: "bg-sky-400 text-sky-950" },
  { value: "Consumer Grade", label: "Consumer", color: "bg-gray-400 text-gray-950" },
  { value: "knife_glove", label: "Knife/Glove", color: "bg-yellow-500 text-yellow-950" },
];

export function CollectionViewer({ collectionName, onBack, onNavigateCollection }: Props) {
  const [knifePool, setKnifePool] = useState<{ knifeTypes: string[]; gloveTypes: string[]; finishCount: number } | null>(null);
  const [tradeUps, setTradeUps] = useState<TradeUp[]>([]);
  const [tradeUpTotal, setTradeUpTotal] = useState(0);
  const [tradeUpsLoading, setTradeUpsLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [skinRarity, setSkinRarity] = useState("all");
  const [tuSort, setTuSort] = useState("profit");
  const [tuOrder, setTuOrder] = useState<"asc" | "desc">("desc");
  const [section, setSection] = useState<"tradeups" | "skins">("tradeups");

  // Fetch collection metadata
  useEffect(() => {
    setLoading(true);
    fetch(`/api/collection/${encodeURIComponent(collectionName)}`)
      .then(r => r.json())
      .then(data => {
        setKnifePool(data.knifePool || null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [collectionName]);

  // Fetch trade-ups for this collection via the main trade-ups API (with collection filter)
  useEffect(() => {
    setTradeUpsLoading(true);
    const params = new URLSearchParams({
      collection: collectionName,
      sort: tuSort,
      order: tuOrder,
      per_page: "50",
    });
    fetch(`/api/trade-ups?${params}`, { credentials: "include" })
      .then(r => r.json())
      .then(data => {
        setTradeUps(data.trade_ups || []);
        setTradeUpTotal(data.total || 0);
      })
      .catch(() => {})
      .finally(() => setTradeUpsLoading(false));
  }, [collectionName, tuSort, tuOrder]);

  const handleTuSort = (column: string) => {
    if (tuSort === column) {
      setTuOrder(tuOrder === "desc" ? "asc" : "desc");
    } else {
      setTuSort(column);
      setTuOrder("desc");
    }
  };

  const profitable = tradeUps.filter(t => t.profit_cents > 0);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Button variant="outline" size="sm" onClick={onBack}>
          ← Back
        </Button>
        <h2 className="text-lg font-semibold text-foreground">{collectionName}</h2>
      </div>

      {loading ? (
        <div className="py-10 text-center text-muted-foreground animate-pulse">Loading...</div>
      ) : (
        <>
          {/* Summary bar */}
          <div className="flex items-center gap-4 px-3 py-2 bg-muted/50 border border-border rounded-md text-sm text-muted-foreground mb-4">
            <span>{tradeUpTotal} trade-ups</span>
            {profitable.length > 0 && (
              <>
                <span className="text-green-500">{profitable.length} profitable</span>
                <span>Best: <span className="text-green-500 font-medium">{formatDollars(Math.max(...profitable.map(t => t.profit_cents)))}</span></span>
              </>
            )}
            {knifePool && (knifePool.knifeTypes.length > 0 || knifePool.gloveTypes.length > 0) && (
              <span className="flex items-center gap-1.5">
                {knifePool.knifeTypes.map(k => (
                  <Badge key={k} variant="outline" className="text-[0.65rem] bg-blue-400/10 text-blue-400 border-blue-400/20 py-0">{k}</Badge>
                ))}
                {knifePool.gloveTypes.map(g => (
                  <Badge key={g} variant="outline" className="text-[0.65rem] bg-fuchsia-400/10 text-fuchsia-400 border-fuchsia-400/20 py-0">{g}</Badge>
                ))}
              </span>
            )}
          </div>

          {/* Section tabs */}
          <div className="flex items-center gap-6 border-b border-border mb-4">
            <button
              className={`pb-2 text-sm font-medium border-b-2 -mb-px transition-colors cursor-pointer ${
                section === "tradeups" ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setSection("tradeups")}
            >
              Trade-Ups ({tradeUpTotal})
            </button>
            <button
              className={`pb-2 text-sm font-medium border-b-2 -mb-px transition-colors cursor-pointer ${
                section === "skins" ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setSection("skins")}
            >
              Skins
            </button>
          </div>

          {section === "tradeups" && (
            <>
              {tradeUpsLoading ? (
                <div className="py-8 text-center text-muted-foreground animate-pulse">Loading trade-ups...</div>
              ) : tradeUps.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">No trade-ups found involving this collection.</div>
              ) : (
                <TradeUpTable
                  tradeUps={tradeUps}
                  sort={tuSort}
                  order={tuOrder}
                  onSort={handleTuSort}
                  onNavigateCollection={onNavigateCollection}
                  tier="pro"
                />
              )}
            </>
          )}

          {section === "skins" && (
            <>
              {/* Rarity tabs */}
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                {RARITY_TABS.map(t => (
                  <button
                    key={t.value}
                    className={`px-3 py-1 text-xs font-medium rounded-full transition-colors cursor-pointer ${
                      skinRarity === t.value
                        ? (t.color || "bg-foreground text-background")
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => setSkinRarity(t.value)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <DataViewer
                key={`${collectionName}-${skinRarity}`}
                onNavigateCollection={onNavigateCollection}
                collectionFilter={collectionName}
                initialRarity={skinRarity === "all" ? "" : skinRarity}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
