import { useState, useEffect, useCallback } from "react";
import { DataViewer } from "./DataViewer.js";
import { TradeUpTable } from "./TradeUpTable.js";
import { FilterBar, EMPTY_FILTERS, filtersToParams } from "./FilterBar.js";
import type { Filters } from "./FilterBar.js";
import { Button } from "@shared/components/ui/button.js";
import { Badge } from "@shared/components/ui/badge.js";
import type { TradeUp } from "../../shared/types.js";

interface Props {
  collectionName: string;
  onBack: () => void;
  onNavigateCollection: (name: string) => void;
}

const TU_TYPE_TABS = [
  { value: "all", label: "All", color: "" },
  { value: "covert_knife", label: "Knife/Gloves", color: "border-yellow-500/40 bg-yellow-500/10 text-yellow-500" },
  { value: "classified_covert", label: "Covert", color: "border-red-500/40 bg-red-500/10 text-red-500" },
  { value: "restricted_classified", label: "Classified", color: "border-pink-500/40 bg-pink-500/10 text-pink-500" },
  { value: "milspec_restricted", label: "Restricted", color: "border-purple-500/40 bg-purple-500/10 text-purple-500" },
  { value: "industrial_milspec", label: "Mil-Spec", color: "border-blue-500/40 bg-blue-500/10 text-blue-500" },
  { value: "consumer_industrial", label: "Industrial", color: "border-sky-400/40 bg-sky-400/10 text-sky-400" },
];

const RARITY_TABS = [
  { value: "all", label: "All Skins", color: "" },
  { value: "Covert", label: "Covert", color: "border-red-500/40 bg-red-500/10 text-red-500" },
  { value: "Classified", label: "Classified", color: "border-pink-500/40 bg-pink-500/10 text-pink-500" },
  { value: "Restricted", label: "Restricted", color: "border-purple-500/40 bg-purple-500/10 text-purple-500" },
  { value: "Mil-Spec", label: "Mil-Spec", color: "border-blue-500/40 bg-blue-500/10 text-blue-500" },
  { value: "Industrial Grade", label: "Industrial", color: "border-sky-400/40 bg-sky-400/10 text-sky-400" },
  { value: "Consumer Grade", label: "Consumer", color: "border-gray-400/40 bg-gray-400/10 text-gray-400" },
  { value: "knife_glove", label: "Knife/Glove", color: "border-yellow-500/40 bg-yellow-500/10 text-yellow-500" },
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
  const [tuType, setTuType] = useState("all");
  const [tuPage, setTuPage] = useState(1);
  const [section, setSection] = useState<"tradeups" | "skins">("tradeups");
  const [filters, setFilters] = useState<Filters>({ ...EMPTY_FILTERS });

  useEffect(() => {
    setLoading(true);
    fetch(`/api/collection/${encodeURIComponent(collectionName)}`)
      .then(r => r.json())
      .then(data => setKnifePool(data.knifePool || null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [collectionName]);

  // Fetch trade-ups with collection filter + type + filters
  useEffect(() => {
    setTradeUpsLoading(true);
    const params = filtersToParams(filters);
    params.set("collection", collectionName);
    params.set("sort", tuSort);
    params.set("order", tuOrder);
    params.set("page", String(tuPage));
    params.set("per_page", "50");
    params.set("include_stale", "true");
    if (tuType !== "all") params.set("type", tuType);

    fetch(`/api/trade-ups?${params}`, { credentials: "include" })
      .then(r => r.json())
      .then(data => {
        setTradeUps(data.trade_ups || []);
        setTradeUpTotal(data.total || 0);
      })
      .catch(() => {})
      .finally(() => setTradeUpsLoading(false));
  }, [collectionName, tuSort, tuOrder, tuType, tuPage, filters]);

  const handleTuSort = (column: string) => {
    if (tuSort === column) setTuOrder(tuOrder === "desc" ? "asc" : "desc");
    else { setTuSort(column); setTuOrder("desc"); }
    setTuPage(1);
  };

  const handleFiltersChange = useCallback((f: Filters) => {
    setFilters(f);
    setTuPage(1);
  }, []);

  const totalPages = Math.ceil(tradeUpTotal / 50);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <Button variant="outline" size="sm" onClick={onBack}>← Back</Button>
        <h2 className="text-lg font-semibold text-foreground">{collectionName}</h2>
        {knifePool && (
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

      {loading ? (
        <div className="py-10 text-center text-muted-foreground animate-pulse">Loading...</div>
      ) : (
        <>
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
              {/* Type tabs */}
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                {TU_TYPE_TABS.map(t => (
                  <button
                    key={t.value}
                    className={`px-4 py-1.5 text-sm font-medium rounded-full border transition-colors cursor-pointer ${
                      tuType === t.value
                        ? (t.color || "border-foreground/40 bg-foreground/10 text-foreground")
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => { setTuType(t.value); setTuPage(1); }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Filters */}
              <div className="mb-2">
                <FilterBar filters={filters} onFiltersChange={handleFiltersChange} />
              </div>

              {tradeUpsLoading ? (
                <div className="py-8 text-center text-muted-foreground animate-pulse">Loading trade-ups...</div>
              ) : tradeUps.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">No trade-ups found involving this collection.</div>
              ) : (
                <>
                  <TradeUpTable
                    tradeUps={tradeUps}
                    sort={tuSort}
                    order={tuOrder}
                    onSort={handleTuSort}
                    onNavigateCollection={onNavigateCollection}
                    tier="pro"
                  />
                  {totalPages > 1 && (
                    <div className="flex gap-2 justify-center items-center mt-4 text-sm text-muted-foreground">
                      <Button variant="outline" size="sm" disabled={tuPage <= 1} onClick={() => setTuPage(tuPage - 1)}>Prev</Button>
                      <span>Page {tuPage} of {totalPages} ({tradeUpTotal.toLocaleString()} results)</span>
                      <Button variant="outline" size="sm" disabled={tuPage >= totalPages} onClick={() => setTuPage(tuPage + 1)}>Next</Button>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {section === "skins" && (
            <>
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                {RARITY_TABS.map(t => (
                  <button
                    key={t.value}
                    className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors cursor-pointer ${
                      skinRarity === t.value
                        ? (t.color || "border-foreground/40 bg-foreground/10 text-foreground")
                        : "border-transparent text-muted-foreground hover:text-foreground"
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
                outputCollection={skinRarity === "knife_glove" ? collectionName : undefined}
                initialRarity={skinRarity === "all" ? "" : skinRarity === "knife_glove" ? "knife_glove" : skinRarity}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
